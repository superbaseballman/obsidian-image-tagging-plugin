import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, Menu, FileSystemAdapter } from 'obsidian';
import { MediaData, ImageTaggingSettings, DEFAULT_SETTINGS, ImageDataManager, getMediaType } from './models/image-data-model';
import { DataMigration } from './services/data-migration';
import { ImageView } from './views/image-info-view';
import { GalleryView } from './views/gallery-view';
import { getImageResolutionWithCache, getImageFileFromPath, getMediaDurationWithCache } from './utils/utils';
import { getFileMd5 } from './utils/file-hash';
import { SqliteStore } from './services/sqlite-store';
import { Logger, LogLevel } from './utils/logger';
import { GALLERY_VIEW_TYPE, IMAGE_INFO_VIEW_TYPE, DEFAULT_JSON_STORAGE_PATH, DEFAULT_SUPPORTED_FORMATS, DEFAULT_CATEGORIES, SQLITE_STORAGE_PATH } from './constants';

// 导入样式
import '../styles.css';

// 删除确认宽限期：Obsidian 有时会把「改名 / 移动」拆成 delete + create 两个事件，
// 在该时间段内若出现内容 MD5 相同的新文件，则保留原记录（id / 标签 / 描述不变）。
const PENDING_DELETE_GRACE_MS = 20000;

interface Listener {
  (this: Document, ev: Event): void;
}

export default class ImageTaggingPlugin extends Plugin {
  settings: ImageTaggingSettings;
  imageDataManager: ImageDataManager;
  dataReady: Promise<void>;
  private sqliteStore: SqliteStore;
  private saveQueue: Promise<void> = Promise.resolve();
  // 删除宽限期内的记录（key 为记录 id）：外部改名常被拆分为 delete + create，
  // 期间若出现内容 MD5 相同的文件则认领该记录，保证 id / 标签 / 描述不丢失。
  private pendingDeleted = new Map<string, { record: MediaData; timer: number }>();

  async onload() {
    await this.loadSettings();
    this.imageDataManager = new ImageDataManager(this.settings.recentTags);
    this.sqliteStore = new SqliteStore(this.app, SQLITE_STORAGE_PATH);

    // 恢复布局中的视图可能在此回调完成前打开，先暴露数据就绪状态，避免视图扫描空数据并覆盖已有文件。
    this.dataReady = new Promise<void>((resolve) => {
      this.app.workspace.onLayoutReady(async () => {
          await this.loadDataFromFile();
          await this.autoMigrateLegacyData();
        resolve();
      });
    });

    // 注册图片右键菜单
    this.registerDomEvent(document, 'contextmenu', async (evt: MouseEvent) => {
      // 只处理 markdown 渲染区域的图片
      const target = evt.target as HTMLElement;
      if (!target) return;
      // 兼容 Obsidian 预览和编辑模式下的图片
      let imgEl: HTMLImageElement | null = null;
      if (target.tagName === 'IMG') {
        imgEl = target as HTMLImageElement;
      } else if (target.closest) {
        const found = target.closest('img');
        if (found) imgEl = found as HTMLImageElement;
      }
      if (!imgEl) return;

      // 尝试获取图片 src 并解析为 vault 内的文件
      const src = imgEl.getAttribute('src');
      if (!src) return;
      let file: TFile | null = null;
      if (src.startsWith('app://')) {
        const files = this.app.vault.getFiles();
        file = files.find(f => (this.app.vault.getResourcePath(f) === src)) || null;
      } else {
        const abstractFile = this.app.vault.getAbstractFileByPath(src);
        file = abstractFile instanceof TFile ? abstractFile : null;
      }
      if (!file || !this.isSupportedImageFile(file)) return;

      // 构造自定义菜单
      const menu = new Menu();
      menu.addItem((item) => {
        item.setTitle('显示媒体信息').setIcon('image').onClick(async () => {
          if (!file) return;
          await this.openImageInfoPanel();
          await this.updateImageInfoPanel(file);
        });
      });
      menu.addItem((item) => {
        item.setTitle('在新标签页打开').setIcon('external-link').onClick(async () => {
          if (!file) return;
          const leaf = this.app.workspace.getLeaf('tab');
          await leaf.openFile(file);
        });
      });
      menu.addItem((item) => {
        item.setTitle('用默认软件打开').setIcon('external-link').onClick(async () => {
          if (!file) return;
          const adapter = this.app.vault.adapter;
          if (adapter instanceof FileSystemAdapter) {
            const fullPath = adapter.getFullPath(file.path);
            require('electron').shell.openPath(fullPath);
          } else {
            new Notice('无法获取文件路径');
          }
        });
      });
      // 阻止原生菜单并显示自定义菜单
      evt.preventDefault();
      menu.showAtPosition({x: evt.clientX, y: evt.clientY});
    });
    // 添加设置选项卡
    this.addSettingTab(new ImageTaggingSettingTab(this.app, this));

    // 注册视图
    this.registerView(
      GALLERY_VIEW_TYPE,
      (leaf) => new GalleryView(leaf, this.settings, this.imageDataManager)
    );
    this.registerView(
      IMAGE_INFO_VIEW_TYPE,
      (leaf) => new ImageView(leaf, this.imageDataManager, this.settings)
    );

    // 添加命令
    this.addCommand({
      id: 'open-gallery-view',
      name: '打开媒体图库',
      callback: () => {
        this.openGalleryView();
      }
    });

    // 添加功能区图标
    this.addRibbonIcon('image', '打开媒体图库', (evt: MouseEvent) => {
      this.openGalleryView();
    });

    this.addCommand({
      id: 'open-image-info-panel',
      name: '打开媒体信息面板',
      callback: () => {
        this.openImageInfoPanel();
      }
    });

    this.addCommand({
      id: 'scan-all-images',
      name: '扫描库中的所有媒体文件',
      callback: () => {
        this.scanAllImages();
      }
    });

    this.addCommand({
      id: 'extract-images-from-page',
      name: '从当前页面提取图片',
      callback: async () => {
        await this.extractAndProcessImagesFromPage();
      }
    });

    this.addCommand({
      id: 'migrate-legacy-data',
      name: '迁移旧版本数据文件',
      callback: async () => {
        await this.migrateLegacyData();
      }
    });

    // 注册文件打开事件，用于显示图片信息
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // 当打开文件时，更新右侧信息面板
        // ImageView内部会检查是否为支持的图片文件
        this.updateImageInfoPanel(file);
      })
    );



    // 注册文件删除事件：不立即删除记录，而是进入删除宽限期。
    // Obsidian 常把「外部改名 / 移动」报告为 delete + create 两个事件，
    // 立即删除会让记录（id / 标签 / 描述）在新文件出现前就已丢失。
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file && this.isSupportedImageFile(file as TFile)) {
          const imageData = this.imageDataManager.getImageDataByPath(file.path);
          if (imageData) {
            this.schedulePendingDeletion(imageData, file.path);
          }
        }
      })
    );

    // 注册文件新建事件：若新文件与宽限期内的记录内容 MD5 相同（典型的外部改名场景），
    // 认领并恢复原记录，保证纯改名后 id / 标签 / 描述不丢失。
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file && file instanceof TFile && this.isSupportedImageFile(file)) {
          void this.handleFileCreated(file);
        }
      })
    );

    // 注册文件重命名事件，用于更新图片路径（保留原记录 id）
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file && this.isSupportedImageFile(file as TFile)) {
          const updated = this.imageDataManager.renamePath(oldPath, file.path);
          if (updated) {
            this.saveDataToFile();
            Logger.debug(`已更新重命名图片的路径: ${oldPath} -> ${file.path}`);
          } else {
            // 记录可能已进入删除宽限期，或已是残留的孤儿记录：尝试按内容认领 / 继承
            void this.handleFileCreated(file as TFile);
          }
        }
      })
    );


    // 在布局准备就绪后设置编辑器图片点击处理程序
    this.app.workspace.onLayoutReady(() => {
      this.setupEditorImageClickHandler();
    });

    // 在编辑器的原生右键菜单中加入“查看图片信息”项
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu, editor, view) => {
        try {
          if (!editor) return;
          const cursor = editor.getCursor();
          const line = editor.getLine(cursor.line || 0) as string;
          const ch = cursor.ch || 0;

          // 尝试在当前行中找到图片链接（Markdown/HTML/WikiLink）并且光标位于链接范围内
          const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
          const wikiRegex = /!\[\[\s*([^|\]]+)\s*(?:\|[^\]]*)?\]\]/g;
          const htmlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g;

          let foundPath: string | null = null;

          const findMatch = (regex: RegExp) => {
            let m: RegExpExecArray | null;
            while ((m = regex.exec(line)) !== null) {
              const start = m.index;
              const end = start + m[0].length;
              if (ch >= start && ch <= end) {
                return m[1];
              }
            }
            return null;
          };

          foundPath = findMatch(mdRegex) || findMatch(wikiRegex) || findMatch(htmlRegex);

          if (foundPath) {
            menu.addItem((item) => {
              item
                .setTitle('查看图片信息')
                .setIcon('image')
                .onClick(async () => {
                  // 尝试解析路径并打开图片信息面板
                  const activeFile = view?.file || this.app.workspace.getActiveFile();
                  const file = await this.getImageInfoFromPath(foundPath!, activeFile as TFile);
                  if (file && this.isSupportedImageFile(file as TFile)) {
                    await this.openImageInfoPanel();
                    await this.updateImageInfoPanel(file as TFile);
                  } else {
                    new Notice('未找到图片文件或不支持的图片格式');
                  }
                });
            });
            menu.addSeparator();
            menu.addItem((item) => {
              item
                .setTitle('在新标签页打开')
                .setIcon('external-link')
                .onClick(async () => {
                  const activeFile = view?.file || this.app.workspace.getActiveFile();
                  const file = await this.getImageInfoFromPath(foundPath!, activeFile as TFile);
                  if (file && this.isSupportedImageFile(file as TFile)) {
                    const leaf = this.app.workspace.getLeaf('tab');
                    await leaf.openFile(file);
                  } else {
                    new Notice('未找到图片文件或不支持的图片格式');
                  }
                });
            });
            menu.addItem((item) => {
              item
                .setTitle('用默认软件打开')
                .setIcon('external-link')
                .onClick(async () => {
                  const activeFile = view?.file || this.app.workspace.getActiveFile();
                  const file = await this.getImageInfoFromPath(foundPath!, activeFile as TFile);
                  if (file && this.isSupportedImageFile(file as TFile)) {
                    const adapter = this.app.vault.adapter;
                    if (adapter instanceof FileSystemAdapter) {
                      const fullPath = adapter.getFullPath(file.path);
                      require('electron').shell.openPath(fullPath);
                    } else {
                      new Notice('无法获取文件路径');
                    }
                  } else {
                    new Notice('未找到图片文件或不支持的图片格式');
                  }
                });
            });
          }
        } catch (err) {
          // 忽略错误以免影响原生菜单
          Logger.error('editor-menu 处理出错:', err);
        }
      })
    );

    // 注册文档事件监听器，用于处理所有窗口中的图片右键菜单
    this.registerDocument(document);

    this.app.workspace.on("window-open", (workspaceWindow, window) => {
      this.registerDocument(window.document);
    });
  }

  /**
   * 设置编辑器中的图片点击处理程序
   */
  private setupEditorImageClickHandler() {
    // 监听编辑器内容区域的点击事件
    const clickEventHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // 检查点击的是否为图片元素
      if (target.tagName === 'IMG') {
        event.preventDefault(); // 阻止默认行为
        
        let imagePath = '';
        // 对于 <img> 标签
        imagePath = target.getAttribute('src') || '';
        
        if (imagePath) {
          // 尝试从路径获取实际的文件对象
          const file = getImageFileFromPath(imagePath, this.app);
          if (file && this.isSupportedImageFile(file)) {
            // 打开图片信息面板并显示该图片的信息
            this.openImageInfoPanel();
            this.updateImageInfoPanel(file);
          }
        }
      }
    };

    // 为所有当前和未来的编辑器实例添加事件监听器
    this.app.workspace.onLayoutReady(() => {
      // 监听新打开的编辑器
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', (leaf) => {
          if (leaf && leaf.view && (leaf.view as any).contentEl) {
            const viewContentEl = (leaf.view as any).contentEl as HTMLElement;
            viewContentEl.removeEventListener('click', clickEventHandler);
            viewContentEl.addEventListener('click', clickEventHandler);
          }
        })
      );
      
      // 为当前已打开的编辑器添加监听器
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view && (leaf.view as any).contentEl) {
          const viewContentEl = (leaf.view as any).contentEl as HTMLElement;
          viewContentEl.addEventListener('click', clickEventHandler);
        }
      });
    });
  }

  /**
   * 提取当前活动文件中的图片并处理（创建或更新数据记录）。
   */
  async extractAndProcessImagesFromPage() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice('请在Markdown文件中运行此命令。');
      return;
    }

    const imagePaths = await this.extractImagesFromActiveFile(activeFile);
    new Notice(`从当前页面找到 ${imagePaths.length} 个图片引用`);
    
    let newImagesCount = 0;

    // 为每个找到的图片创建或更新数据记录
    for (const imagePath of imagePaths) {
      // 使用更健壮的方法获取 TFile 对象
      const file = await this.getImageInfoFromPath(imagePath, activeFile);
      
      if (file && this.isSupportedImageFile(file)) {
        const existing = this.imageDataManager.getImageDataByPath(file.path);
        const imageData = await this.ensureImageDataForFile(file);
        if (!existing || existing.id !== imageData.id) {
          newImagesCount++;
        }
      }
    }
    
    if (newImagesCount > 0) {
      await this.saveDataToFile();
      new Notice(`已添加 ${newImagesCount} 个新的图片记录。`);
    } else if (imagePaths.length > 0) {
      new Notice('所有图片记录已存在。');
    }
  }

  /**
   * 从 TFile 对象创建默认的 ImageData 结构。
   */
  private async createDefaultImageData(file: TFile): Promise<MediaData> {
    // 获取文件信息
    const stat = file.stat;
    const path = file.path;
    const name = file.basename;
    const extension = file.extension;
    const size = this.formatFileSize(stat.size);
    const lastModified = stat.mtime;
    
    let resolution = '未知';
    let width = 0;
    let height = 0;
    
    const mediaType = getMediaType(file) || 'image';
    
    try {
      // 对于图片，使用缓存的图片分辨率获取方法
      if (mediaType === 'image') {
        const dimensions = await getImageResolutionWithCache(file, this.app);
        if (dimensions) {
          width = dimensions.width;
          height = dimensions.height;
          resolution = dimensions.resolution;
        }
      } else if (mediaType === 'video' || mediaType === 'audio') {
        // 对于视频和音频文件，获取时长信息
        const duration = await getMediaDurationWithCache(file, this.app);
        resolution = duration ? `${duration}` : (mediaType === 'video' ? '视频文件' : '音频文件');
      }
    } catch (e) {
      console.warn(`无法获取媒体信息: ${path}`, e);
    }
    
    // 根据设置确定标签
    let tags: string[] = [];
    if (this.settings.autoTagOnImport && this.settings.autoTagOnImportValue) {
      // 如果启用了自动标签功能且有自定义标签值，则使用这些标签
      tags = this.settings.autoTagOnImportValue
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    }
    
    return {
      id: await getFileMd5(file, this.app),
      path: path,
      title: name,
      tags: tags,
      date: new Date().toISOString(),
      size: size,
      resolution: resolution,
      format: extension.toUpperCase(),
      description: '',
      originalName: file.name,
      lastModified: lastModified,
      width: width,
      height: height,
      fileSize: stat.size,
      type: mediaType
    };
  }

  private async ensureImageDataForFile(file: TFile): Promise<MediaData> {
    const existing = this.imageDataManager.getImageDataByPath(file.path);
    const currentId = await getFileMd5(file, this.app);
    if (!existing) {
      // 先尝试按内容继承残留记录（改名/移动产生），避免新建空记录丢失标签
      const adopted = this.adoptOrphanRecord(file, currentId);
      if (adopted) return adopted;

      const created = await this.createDefaultImageData(file);
      this.imageDataManager.addImageData(created);
      return this.imageDataManager.getImageDataByPath(file.path) || created;
    }
    if (existing.id === currentId) return existing;

    this.imageDataManager.removeImageData(existing.id);
    const updated: MediaData = { ...existing, id: currentId, path: file.path };
    this.imageDataManager.addImageData(updated);
    return this.imageDataManager.getImageDataByPath(file.path) || updated;
  }

  /**
   * 内容继承：当库中存在「id 与文件内容 MD5 一致、但原路径文件已不存在」的残留记录
   * （典型：插件未运行 / 未触发 rename 事件时的改名、移动），将该记录迁移到新路径，
   * 保留其 id、标签、标题、描述，而不是删除后新建空记录。
   * @returns 被继承的记录；无可继承对象或属于真实双拷贝时返回 undefined
   */
  private adoptOrphanRecord(file: TFile, contentMd5: string): MediaData | undefined {
    if (this.imageDataManager.getImageDataByPath(file.path)) return undefined;
    const orphan = this.imageDataManager.getImageDataByContentId(contentMd5);
    if (!orphan) return undefined;

    // 若同内容的另一份拷贝仍真实存在，则属于双拷贝而非改名，不应合并
    const orphanFile = this.app.vault.getAbstractFileByPath(orphan.path);
    if (orphanFile instanceof TFile) return undefined;

    const stat = file.stat;
    const record = this.imageDataManager.renamePath(orphan.path, file.path);
    if (!record) return undefined;
    record.title = file.basename;
    record.originalName = file.name;
    record.lastModified = stat.mtime;
    record.fileSize = stat.size;
    record.size = this.formatFileSize(stat.size);
    Logger.debug(`已按内容继承原记录（改名/移动）: ${orphan.path} -> ${file.path}`);
    return record;
  }

  // ===== 删除宽限期与内容认领：让“纯改名”保留原 id 与标签 =====

  /**
   * 把待删除记录移出内存并进入宽限期；若宽限期内出现内容相同（MD5 一致）的新文件
   * （Obsidian 将外部改名报告为 delete + create），会通过 tryAdoptPendingDeleted 恢复记录。
   * 宽限期结束仍未认领则确认删除并落盘。
   */
  private schedulePendingDeletion(imageData: MediaData, deletedPath: string): void {
    this.imageDataManager.removeImageData(imageData.id);

    const existing = this.pendingDeleted.get(imageData.id);
    if (existing) window.clearTimeout(existing.timer);

    const timer = window.setTimeout(() => {
      this.pendingDeleted.delete(imageData.id);
      this.saveDataToFile();
      Logger.debug(`已确认删除媒体数据: ${deletedPath}`);
    }, PENDING_DELETE_GRACE_MS);

    this.pendingDeleted.set(imageData.id, { record: imageData, timer });
  }

  /**
   * 新文件出现 / 改名但无路径记录时统一入口：
   * 1) 若处于删除宽限期（delete 事件先行）→ 按内容 MD5 认领原记录；
   * 2) 否则若库中存在同内容的孤儿记录 → 按内容继承（保留 id / 标签 / 描述）。
   */
  private async handleFileCreated(file: TFile): Promise<void> {
    if (this.imageDataManager.getImageDataByPath(file.path)) return;
    if (await this.tryAdoptPendingDeleted(file)) return;

    const contentMd5 = await getFileMd5(file, this.app);
    const adopted = this.adoptOrphanRecord(file, contentMd5);
    if (adopted) {
      await this.saveDataToFile();
    }
  }

  /**
   * 在删除宽限期内查找与新文件内容 MD5 一致的记录并认领，保留原 id / 标签 / 描述。
   * @returns 是否成功认领
   */
  private async tryAdoptPendingDeleted(file: TFile): Promise<boolean> {
    if (this.pendingDeleted.size === 0) return false;
    if (this.imageDataManager.getImageDataByPath(file.path)) return false;

    const contentMd5 = await getFileMd5(file, this.app);
    for (const [id, entry] of this.pendingDeleted) {
      if (!this.isIdDerivedFromMd5(entry.record.id, contentMd5)) continue;

      window.clearTimeout(entry.timer);
      this.pendingDeleted.delete(id);

      const stat = file.stat;
      const adopted: MediaData = {
        ...entry.record,
        path: file.path,
        title: file.basename,
        originalName: file.name,
        lastModified: stat.mtime,
        fileSize: stat.size,
        size: this.formatFileSize(stat.size),
      };
      this.imageDataManager.addImageData(adopted);
      await this.saveDataToFile();
      Logger.debug(`检测到相同内容的新文件，已保留原记录并更新路径: ${file.path}`);
      return true;
    }
    return false;
  }

  // 记录 id 是否为某内容 MD5 派生（id 形如 md5 或 md5-<后缀>）
  private isIdDerivedFromMd5(recordId: string, contentMd5: string): boolean {
    return recordId === contentMd5 || recordId.startsWith(`${contentMd5}-`);
  }

  /**
   * 从指定的 Markdown 文件中提取所有图片链接。
   */
  async extractImagesFromActiveFile(activeFile: TFile): Promise<string[]> {
    try {
      const fileContent = await this.app.vault.read(activeFile);
      const imagePaths: string[] = [];
      
      // 1. 标准 Markdown 图片：![alt text](image_path)
      const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
      
      // 2. HTML <img> 标签：<img ... src="image_path" ...>
      const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/g;
      
      // 3. Obsidian 维基链接图片：![[path/to/Image.png|别名]] 或 ![[path/to/Image.png]]
      const robustWikilinkRegex = /!\[\[\s*([^|\]]+)\s*(?:\|[^\]]*)?\]\]/g;

      let match;

      // 匹配 Markdown 语法
      while ((match = markdownImageRegex.exec(fileContent)) !== null) {
        imagePaths.push(match[1].trim());
      }
      
      // 匹配 HTML img 标签
      while ((match = htmlImageRegex.exec(fileContent)) !== null) {
        imagePaths.push(match[1].trim());
      }

      // 匹配 Obsidian 维基链接
      while ((match = robustWikilinkRegex.exec(fileContent)) !== null) {
        imagePaths.push(match[1].trim()); 
      }
      
      // 去除重复路径
      return Array.from(new Set(imagePaths));
    } catch (error) {
      Logger.error(`提取图片路径时出错 (${activeFile.path}):`, error);
      new Notice('错误：提取图片链接失败。');
      return [];
    }
  }
  
  /**
 * 根据图片路径字符串查找对应的 TFile 对象，支持相对路径。
 * * @param imagePath 图片链接字符串 (可能来自 Markdown 或 HTML)
 * @param activeFile 当前活动的 Markdown 文件，用于解析相对路径
 */
async getImageInfoFromPath(imagePath: string, activeFile: TFile): Promise<TFile | null> {
    // 解码URI编码的路径，处理包含空格的路径
    let decodedPath = imagePath.trim();
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch (e) {
      // 如果解码失败，使用原始路径
      Logger.warn('Failed to decode URI component:', imagePath, e);
    }
    
    const cleanPath = decodedPath;
    if (!cleanPath || cleanPath.includes('://')) {
        // 排除空路径或外部 URL
        return null;
    }

    // 使用 Obsidian 的标准链接解析方法
    const file = this.app.metadataCache.getFirstLinkpathDest(cleanPath, activeFile.path);
    
    if (file instanceof TFile) {
        return file;
    }

    // 兼容性回退：尝试在整个 Vault 中查找匹配的文件名
    if (!cleanPath.includes('/') && !cleanPath.includes('\\')) {
        const matchingFile = this.app.vault.getFiles().find(f => 
            f.name === cleanPath || 
            f.path.endsWith(cleanPath) // 匹配文件名或完整路径的后缀
        );
        if (matchingFile) {
            return matchingFile;
        }
    }
    
    return null;
}

  onunload() {
    this.app.workspace.detachLeavesOfType(GALLERY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IMAGE_INFO_VIEW_TYPE);
    // 清理删除宽限期计时器，避免卸载后仍触发保存
    for (const [, entry] of this.pendingDeleted) {
      window.clearTimeout(entry.timer);
    }
    this.pendingDeleted.clear();
    void this.sqliteStore?.close();
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
    if (!this.settings.jsonStoragePath) {
      this.settings.jsonStoragePath = DEFAULT_SETTINGS.jsonStoragePath;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadDataFromFile() {
    try {
      const jsonPaths = [this.settings.jsonStoragePath, '.obsidian/image-tag.json', 'image-tag.json', '旧版本image-tag.json']
        .filter((path, index, paths) => path && paths.indexOf(path) === index);
      const sourcePath = await this.findExistingPath(jsonPaths);

      const sqliteRecords = await this.sqliteStore.load();
      if (sqliteRecords.length > 0 || !sourcePath) {
        this.imageDataManager.importRecords(sqliteRecords);
        Logger.info('SQLite 媒体标签数据加载成功:', SQLITE_STORAGE_PATH);
        return;
      }

      if (sourcePath) {
        const jsonData = await this.app.vault.adapter.read(sourcePath);
        const records = await DataMigration.loadDataWithMigrationForApp(jsonData, this.app);
        this.imageDataManager.importRecords(records);
        await this.sqliteStore.save(this.imageDataManager.getAllImageData());
        await this.app.vault.adapter.remove(sourcePath);
        Logger.info(`JSON 数据已迁移至 SQLite 并删除来源文件: ${sourcePath}`);
      } else {
        this.imageDataManager.importRecords([]);
        await this.sqliteStore.save([]);
      }
    } catch (error) {
      Logger.error('加载 SQLite 媒体标签数据失败:', error);
      new Notice('加载媒体标签数据失败，已初始化空数据。');
      this.imageDataManager.importRecords([]);
    }
  }

  private async findExistingPath(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      if (await this.app.vault.adapter.exists(path)) return path;
    }
    return null;
  }

  /**
   * 自动检测并迁移旧版本数据文件（如果当前数据为空且存在旧版本文件）
   */
  async autoMigrateLegacyData() {
    // JSON 到 SQLite 的迁移已在 loadDataFromFile 中完成，保留入口以兼容旧命令。
    return;
    /*
    try {
      // 检查当前数据是否为空
      const currentData = this.imageDataManager.getAllImageData();
      
      if (currentData.length === 0) {
        // 当前数据为空，检查是否存在旧版本数据文件
        const legacyFilePaths = [
          '.obsidian/image-tag.json',  // 常见的旧版本路径
          'image-tag.json',           // 可能的相对路径
          '旧版本image-tag.json'      // 根据用户提供的文件名
        ];
        
        for (const legacyPath of legacyFilePaths) {
          if (await this.app.vault.adapter.exists(legacyPath)) {
            Logger.info(`检测到旧版本数据文件: ${legacyPath}，开始自动迁移...`);
            new Notice('检测到旧版本数据文件，正在自动迁移...');
            
            // 使用数据迁移工具迁移数据
            const success = await DataMigration.migrateLegacyFile(this.app, legacyPath);
            
            if (success) {
              // 重新加载数据以确保更新
              await this.loadDataFromFile();
              new Notice('旧版本数据已自动迁移完成！');
              Logger.info('自动数据迁移成功');
              return; // 迁移成功后退出
            }
          }
        }
      }
    } catch (error) {
      Logger.warn('自动检测旧版本数据时发生错误:', error);
      // 静默处理错误，不影响插件正常加载
    }
    */
  }

  /**
   * 迁移旧版本数据文件
   */
  async migrateLegacyData() {
    try {
      if (await this.app.vault.adapter.exists(SQLITE_STORAGE_PATH)) {
        new Notice('SQLite 数据已存在，无需迁移。');
        return;
      }
      await this.loadDataFromFile();
      new Notice('旧 JSON 数据迁移完成。');
    } catch (error) {
      Logger.error('迁移旧版本数据失败:', error);
      new Notice('迁移旧版本数据时发生错误，请查看控制台了解详细信息。');
    }
  }

  async exportJson(): Promise<void> {
    try {
      const electron = require('electron');
      const dialog = electron.remote?.dialog || electron.dialog;
      const basePath = (this.app.vault.adapter as any).getBasePath?.() || '';
      const defaultPath = basePath
        ? `${basePath}${require('path').sep}image-tags-export.json`
        : 'image-tags-export.json';
      const result = await dialog.showSaveDialog({
        title: '导出 JSON 数据',
        defaultPath,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return;

      require('fs').writeFileSync(result.filePath, this.imageDataManager.exportToJSON(), 'utf8');
      new Notice(`JSON 数据已导出：${result.filePath}`);
    } catch (error) {
      Logger.error('导出 JSON 数据失败:', error);
      new Notice('导出 JSON 数据失败，请查看控制台。');
    }
  }

  async importJsonFromDialog(): Promise<void> {
    try {
      const electron = require('electron');
      const dialog = electron.remote?.dialog || electron.dialog;
      const result = await dialog.showOpenDialog({
        title: '选择 JSON 数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      });
      if (result.canceled || result.filePaths.length === 0) return;

      const jsonData = require('fs').readFileSync(result.filePaths[0], 'utf8');
      const records = await DataMigration.loadDataWithMigrationForApp(jsonData, this.app);
      this.imageDataManager.importRecords(records);
      await this.sqliteStore.save(this.imageDataManager.getAllImageData());
      new Notice(`已导入 ${records.length} 条 JSON 数据。`);
    } catch (error) {
      Logger.error('导入 JSON 数据失败:', error);
      new Notice('导入 JSON 数据失败，请确认文件格式正确。');
    }
  }

  async saveDataToFile() {
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await this.sqliteStore.save(this.imageDataManager.getAllImageData());
        Logger.info('SQLite 媒体标签数据保存成功:', SQLITE_STORAGE_PATH);
      } catch (error) {
        Logger.error('保存 SQLite 媒体标签数据失败:', error);
        new Notice('保存媒体标签数据失败');
      }
    });
    await this.saveQueue;

  }

    /**

     * 扫描 Vault 中的所有图片，并为新图片创建数据记录。

     */

    async scanAllImages() {

  

      new Notice('开始扫描媒体文件...');

  

      let allFiles = this.app.vault.getFiles();

  

      // 处理文件夹路径：优先使用新的多文件夹设置，如果为空则使用旧的单文件夹设置

      let folderPathsToUse: string[] = [];

  

      // 检查是否有新的多个文件夹路径设置

      if (this.settings.scanMultipleFolderPaths && this.settings.scanMultipleFolderPaths.length > 0) {

        folderPathsToUse = this.settings.scanMultipleFolderPaths.map(path => this.normalizePath(path));

      } else if (this.settings.scanFolderPath && this.settings.scanFolderPath.trim() !== '') {

        // 如果新的设置为空，但旧设置有值，则使用旧设置

        folderPathsToUse = [this.normalizePath(this.settings.scanFolderPath)];

      }

  

      // 如果设置了扫描文件夹路径，则只扫描这些文件夹中的文件

      if (folderPathsToUse.length > 0) {

        allFiles = allFiles.filter(file => this.isFileInFolder(file.path, folderPathsToUse));

      }

  

      // 过滤出支持的媒体文件

      const supportedFiles = allFiles.filter(file => this.isSupportedImageFile(file));

  

      // 检查哪些文件还没有数据记录

      const filesToProcess = supportedFiles;

  

      let mediaCount = 0;

  

      // 批量处理文件以提高性能

      const batchSize = 50; // 每批处理的文件数量

      for (let i = 0; i < filesToProcess.length; i += batchSize) {

        const batch = filesToProcess.slice(i, i + batchSize);

        

        // 并行处理当前批次的文件

        const batchPromises = batch.map(async file => {

          const existing = this.imageDataManager.getImageDataByPath(file.path);
          const mediaData = await this.ensureImageDataForFile(file);

          return { mediaData, changed: !existing || existing.id !== mediaData.id };

        });

  

        await Promise.all(batchPromises);

        mediaCount += (await Promise.all(batchPromises)).filter(result => result.changed).length;

  

        // 更新通知，显示进度

        if (i + batchSize < filesToProcess.length) {

          new Notice(`正在扫描... 已处理 ${i + batch.length}/${filesToProcess.length} 个文件`);

        }

      }

  

      if (mediaCount > 0) {

        await this.saveDataToFile();

      }

  

      new Notice(`扫描完成！新增了 ${mediaCount} 个媒体记录`);

  }

  private normalizePath(path: string): string {
    // 标准化路径，确保以 '/' 结尾以便正确匹配
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    return normalized;
  }

  private isFileInFolder(filePath: string, folderPaths: string[]): boolean {
    // 检查文件是否在任意一个指定的文件夹中
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    return folderPaths.some(folderPath => normalizedFilePath.startsWith(folderPath));
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * 监听文档中的元素事件
   * @param el HTML元素
   * @param event 事件类型
   * @param selector CSS选择器
   * @param listener 事件监听器
   * @param options 选项
   */
  onElement(
    el: Document,
    event: keyof HTMLElementEventMap,
    selector: string,
    listener: Listener,
    options?: { capture?: boolean }
  ) {
    // 替换jQuery风格的on/off为标准DOM API
    const delegatedListener = (e: Event) => {
      const target = e.target as Element;
      if (target.matches(selector)) {
        listener.call(el, e);
      }
    };
    
    el.addEventListener(event, delegatedListener, options);
    return () => el.removeEventListener(event, delegatedListener, options);
  }

  /**
   * 注册文档事件监听器
   * @param document 要监听的文档
   */
  registerDocument(document: Document) {
    this.register(
      this.onElement(
        document,
        "contextmenu" as keyof HTMLElementEventMap,
        "img",
        this.onImageContextMenu.bind(this)
      )
    );
  }

  /**
   * 处理图片右键菜单
   * @param event 鼠标事件
   */
  onImageContextMenu(event: MouseEvent) {
    event.preventDefault();
    const target = event.target as HTMLImageElement;
    
    if (target.localName === 'img') {
      const imgPath = target.getAttribute('src') || '';
      if (imgPath) {
        const file = getImageFileFromPath(imgPath, this.app);
        if (file && this.isSupportedImageFile(file)) {
          const menu = new Menu();
          menu.addItem((item) => {
            item
              .setTitle('查看图片信息')
              .setIcon('image')
              .onClick(() => {
                this.openImageInfoPanel();
                this.updateImageInfoPanel(file);
              });
          });
          menu.addSeparator();
          menu.addItem((item) => {
            item
              .setTitle('在新标签页打开')
              .setIcon('external-link')
              .onClick(async () => {
                const leaf = this.app.workspace.getLeaf('tab');
                await leaf.openFile(file);
              });
          });
          menu.addItem((item) => {
            item
              .setTitle('用默认软件打开')
              .setIcon('external-link')
              .onClick(async () => {
                const adapter = this.app.vault.adapter;
                if (adapter instanceof FileSystemAdapter) {
                  const fullPath = adapter.getFullPath(file.path);
                  require('electron').shell.openPath(fullPath);
                } else {
                  new Notice('无法获取文件路径');
                }
              });
          });
          menu.showAtPosition({ x: event.pageX, y: event.pageY });
        }
      }
    }
  }

  async openGalleryView() {
    const { workspace } = this.app;

    // 总是创建一个新的标签页
    const leaf = workspace.getLeaf(true);
    await leaf.setViewState({ type: GALLERY_VIEW_TYPE, active: true });

    const view = leaf.view;
    if (view instanceof GalleryView) {
      await view.initialize();
    }

    workspace.revealLeaf(leaf);
  }

  async openImageInfoPanel() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(IMAGE_INFO_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: IMAGE_INFO_VIEW_TYPE, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      
      // 如果当前有打开的文件，更新视图
      // 确保视图是ImageView类型的实例后再调用updateForFile方法
      if (leaf.view instanceof ImageView) {
        const activeFile = this.app.workspace.getActiveFile();
        const view = leaf.view as ImageView;
        await view.updateForFile(activeFile);
      }
    }
  }

  async updateImageInfoPanel(file: TFile | null) {
    const leaves = this.app.workspace.getLeavesOfType(IMAGE_INFO_VIEW_TYPE);
    
    for (const leaf of leaves) {
      // 确保视图是ImageView类型的实例后再调用updateForFile方法
      if (leaf.view instanceof ImageView) {
        const view = leaf.view as ImageView;
        await view.updateForFile(file);
      }
    }
  }

  isSupportedImageFile(file: TFile): boolean {
    const extension = file.extension ? file.extension.toLowerCase() : '';
    // 使用 Set 查找性能更好，但考虑到格式列表不长，array.includes 也可接受
    return this.settings.supportedFormats.includes(extension); 
  }



  // 清理失效的图片数据



  async cleanupInvalidImages() {



    const removedData = this.imageDataManager.cleanupInvalidImages(this.app, this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);



    await this.saveDataToFile();



    new Notice(`清理完成！移除了 ${removedData.length} 个失效的图片数据记录。`);



  }

}



class ImageTaggingSettingTab extends PluginSettingTab {
  plugin: ImageTaggingPlugin;

  constructor(app: App, plugin: ImageTaggingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName('旧 JSON 数据路径')
      .setDesc('当前数据存储在 .obsidian/image-tags.db，可从本地文件选择旧 JSON 进行迁移')
      .addButton(button => button
        .setButtonText('选择并迁移')
        .onClick(async () => {
          await this.plugin.importJsonFromDialog();
        }))
      .addButton(button => button
        .setButtonText('导出 JSON')
        .onClick(async () => {
          await this.plugin.exportJson();
        }));

    new Setting(containerEl)
      .setName('支持的图片格式')
      .setDesc('插件将处理的图片文件格式，用逗号分隔')
      .addText(text => text
        .setPlaceholder('jpg,jpeg,png,gif,webp,svg')
        .setValue(this.plugin.settings.supportedFormats.join(','))
        .onChange(async (value) => {
          this.plugin.settings.supportedFormats = value
            .split(',')
            .map(ext => ext.trim().toLowerCase())
            .filter(ext => ext.length > 0);
          await this.plugin.saveSettings();
        }));

    let autoTagValueSetting: Setting;

    new Setting(containerEl)

      .setName('导入时自动添加标签')

      .setDesc('当新图片添加到库中时，是否自动创建标签数据项')

      .addToggle(toggle => toggle

        .setValue(this.plugin.settings.autoTagOnImport)

        .onChange(async (value) => {

          this.plugin.settings.autoTagOnImport = value;
          autoTagValueSetting.settingEl.toggle(value);

          await this.plugin.saveSettings();

        }));


    autoTagValueSetting = new Setting(containerEl)

      .setName('导入时自动添加的标签')

      .setClass('subsetting')

      .setDesc('当启用自动添加标签时，为新图片添加的默认标签（多个标签用逗号分隔）')

      .addText(text => text

        .setPlaceholder('例如：未整理,新图片')

        .setValue(this.plugin.settings.autoTagOnImportValue)

        .onChange(async (value) => {

          this.plugin.settings.autoTagOnImportValue = value;

          await this.plugin.saveSettings();

        }));

    autoTagValueSetting.settingEl.toggle(this.plugin.settings.autoTagOnImport);



    new Setting(containerEl)

      .setName('扫描指定文件夹')

      .setDesc('指定要扫描图片的文件夹路径，多个路径用分号(;)分隔（留空则扫描整个库）')

      .addText(text => text

        .setPlaceholder('例如：Attachments/images;Pictures')

        .setValue(this.plugin.settings.scanFolderPath)

        .onChange(async (value) => {

          // 保存到旧字段以保持兼容性
          this.plugin.settings.scanFolderPath = value;
          
          // 同时更新新字段
          if (value.trim() !== '') {
            this.plugin.settings.scanMultipleFolderPaths = value
              .split(';')
              .map(path => path.trim())
              .filter(path => path.length > 0);
          } else {
            this.plugin.settings.scanMultipleFolderPaths = [];
          }
          
          await this.plugin.saveSettings();

        }));
    

  }

}