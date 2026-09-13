import { App, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, Notice, Menu, FileSystemAdapter } from 'obsidian';
import { MediaData, ImageTaggingSettings, DEFAULT_SETTINGS, ImageDataManager, getMediaType } from './models/image-data-model';
import { DataMigration } from './services/data-migration';
import { ImageView } from './views/image-info-view';
import { GalleryView } from './views/gallery-view';
import { FolderSuggestModal, VaultFileSuggestModal } from './views/suggest-modals';
import { getImageResolutionWithCache, getImageFileFromPath, getMediaDurationWithCache, formatFileSize } from './utils/utils';
import { getFileMd5 } from './utils/file-hash';
import { SqliteStore } from './services/sqlite-store';
import { Logger, LogLevel } from './utils/logger';
import { isDesktopApp, openFileWithDefaultApp, getElectronDialog, getNodeFs, getPathSeparator, getVaultBasePath } from './utils/platform';
import { GALLERY_VIEW_TYPE, IMAGE_INFO_VIEW_TYPE, DEFAULT_JSON_STORAGE_PATH, DEFAULT_SUPPORTED_FORMATS, DEFAULT_CATEGORIES, SQLITE_STORAGE_PATH } from './constants';
import { isFileInScanFolders, normalizeFolderPath } from './utils/folders';

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
    // 先用默认设置同步初始化，避免插件启用被设置读取（磁盘 I/O）阻塞；
    // 设置随后异步加载并「原地合并」进同一对象，保证此前注册的视图 / 命令持有的引用不失效。
    this.settings = Object.assign({}, DEFAULT_SETTINGS) as ImageTaggingSettings;
    const settingsReady = this.loadSettings();

    this.imageDataManager = new ImageDataManager(this.settings.recentTags);
    this.sqliteStore = new SqliteStore(this.app, SQLITE_STORAGE_PATH);

    // 数据就绪：等设置 → 等布局就绪 → 等首屏空闲后再读取数据。
    // 把 sql.js 初始化与数据库读取移出启动关键路径，减少启用插件时的卡顿；
    // 视图与文件事件都 await 它，避免在数据未就绪时误建空记录覆盖已有数据。
    this.dataReady = this.initializeData(settingsReady);

    // 图片右键菜单统一由下方 registerDocument(...) / window-open 注册的委托监听器处理
    // （见 onImageContextMenu），此处不再重复注册 document 级 contextmenu：
    // 既减少启动时的监听器数量，也避免同一次右键弹出两个菜单。
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
          void (async () => {
            await this.dataReady;
            const imageData = this.imageDataManager.getImageDataByPath(file.path);
            if (imageData) {
              this.schedulePendingDeletion(imageData, file.path);
            }
          })();
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
          void (async () => {
            await this.dataReady;
            const updated = this.imageDataManager.renamePath(oldPath, file.path);
            if (updated) {
              if (!this.isFileInScanFolder(file.path)) {
                // 文件被移出扫描目录：不再纳入图库管理，进入删除宽限期
                // （20s 内若移回扫描目录且内容一致，可经 handleFileCreated 恢复原记录）
                Logger.warn(`[移出扫描目录] ${oldPath} 已移出扫描目录，记录进入删除宽限期`);
                this.schedulePendingDeletion(updated, oldPath);
              } else {
                this.saveDataToFile();
                Logger.debug(`已更新重命名图片的路径: ${oldPath} -> ${file.path}`);
              }
            } else {
              // 记录可能已进入删除宽限期，或已是残留的孤儿记录：尝试按内容认领 / 继承
              await this.handleFileCreated(file as TFile);
            }
          })();
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
                    if (!openFileWithDefaultApp(this.app, file as TFile)) {
                      new Notice(isDesktopApp() ? '无法获取文件路径' : '移动端不支持用默认软件打开');
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
   * 启动时的数据初始化：设置加载 → 布局就绪 → 首屏空闲 → 读取数据。
   *
   * 关键点：把「设置读取 / sql.js 初始化 / 数据库读取」从插件启用的同步路径上移走，
   * 让界面先完成渲染，减少启动卡顿（移动端效果尤其明显）。
   * 期间视图与文件事件回调都会 await this.dataReady，行为与之前一致。
   */
  private async initializeData(settingsReady: Promise<void>): Promise<void> {
    try {
      await settingsReady;
      await this.waitForLayoutReady();
      await this.waitForIdle();
      await this.loadDataFromFile();
      await this.autoMigrateLegacyData();
      await this.normalizeDuplicateContentRecords();
    } catch (error) {
      Logger.error('初始化媒体标签数据失败:', error);
    }
  }

  /** 等待工作区布局就绪（若已就绪则立即 resolve） */
  private waitForLayoutReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.app.workspace.onLayoutReady(() => resolve());
    });
  }

  /** 等待浏览器空闲，让首屏渲染先完成；不支持 requestIdleCallback 时退化为 setTimeout */
  private waitForIdle(): Promise<void> {
    return new Promise<void>((resolve) => {
      const idleWindow = window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
      };
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleWindow.requestIdleCallback(() => resolve(), { timeout: 1500 });
      } else {
        window.setTimeout(resolve, 0);
      }
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
    await this.dataReady;
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.extension !== 'md') {
      new Notice('请在Markdown文件中运行此命令。');
      return;
    }

    const imagePaths = await this.extractImagesFromActiveFile(activeFile);
    new Notice(`从当前页面找到 ${imagePaths.length} 个图片引用`);
    
    let newImagesCount = 0;
    let skippedCount = 0;

    // 为每个找到的图片创建或更新数据记录
    for (const imagePath of imagePaths) {
      // 使用更健壮的方法获取 TFile 对象
      const file = await this.getImageInfoFromPath(imagePath, activeFile);
      
      if (file && this.isSupportedImageFile(file)) {
        // 不在扫描目录内的媒体不纳入图库记录（仅处理扫描目录内文件）
        if (!this.isFileInScanFolder(file.path)) {
          skippedCount++;
          continue;
        }
        const existing = this.imageDataManager.getImageDataByPath(file.path);
        const imageData = await this.ensureImageDataForFile(file);
        if (imageData && (!existing || existing.id !== imageData.id)) {
          newImagesCount++;
        }
      }
    }
    
    if (newImagesCount > 0 || skippedCount > 0) {
      if (newImagesCount > 0) {
        await this.saveDataToFile();
      }
      const parts: string[] = [];
      if (newImagesCount > 0) parts.push(`已添加 ${newImagesCount} 个新的图片记录`);
      if (skippedCount > 0) parts.push(`跳过 ${skippedCount} 个不在扫描目录内的图片`);
      new Notice(parts.join('；'));
    } else if (imagePaths.length > 0) {
      new Notice('所有图片记录已存在。');
    }
  }

  /**
   * 从 TFile 对象创建默认的 ImageData 结构。
   */
  private async createDefaultImageData(file: TFile, contentId?: string): Promise<MediaData> {
    // 获取文件信息
    const stat = file.stat;
    const path = file.path;
    const name = file.basename;
    const extension = file.extension;
    const size = formatFileSize(stat.size);
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
      id: contentId || await getFileMd5(file, this.app),
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

  /**
   * 确保 file 在数据中拥有「一条且仅一条」记录（同一内容只保留一条记录，id = 内容 MD5）。
   *
   * 返回值的含义：
   * - 返回记录：file 已获得 / 已更新对应记录（新建、内容变化更新，或按内容继承改名 / 移动后的原记录）；
   * - 返回 undefined：file 的内容与另一现存文件的记录完全相同（重复拷贝），该内容已被登记，
   *   不单独建记录 —— 同内容数据直接合并，不再产生 md5-2 派生 id。
   */
  async ensureImageDataForFile(file: TFile): Promise<MediaData | undefined> {
    const currentId = await getFileMd5(file, this.app);
    const existing = this.imageDataManager.getImageDataByPath(file.path);

    // 路径上已有记录
    if (existing) {
      if (existing.id === currentId) return existing;

      // 路径内容被替换为新内容：先移除旧内容记录，再为当前路径登记新内容
      const contentOwner = this.imageDataManager.getImageDataByContentId(currentId);
      if (contentOwner && contentOwner.path !== file.path) {
        const ownerFile = this.app.vault.getAbstractFileByPath(contentOwner.path);
        if (ownerFile instanceof TFile) {
          // 新内容已由另一现存文件登记：标签取并集，由当前路径接管记录（同内容唯一）
          contentOwner.tags = Array.from(new Set([...(contentOwner.tags || []), ...(existing.tags || [])]));
        }
        this.imageDataManager.removeImageData(contentOwner.id);
      }
      this.imageDataManager.removeImageData(existing.id);

      const updated: MediaData = { ...existing, id: currentId, path: file.path };
      this.imageDataManager.addImageData(updated);
      return this.imageDataManager.getImageDataByPath(file.path) || updated;
    }

    // 路径上无记录：先检查删除宽限期（Obsidian 常把外部改名拆成 delete + create，
    // 若 delete 已把带标签的原记录移入宽限期而 create/rename 尚未到达，扫描/建记录时
    // 内存中将找不到它 —— 直接认领可避免误建一条空记录把原标签顶掉）。
    if (this.pendingDeleted.size > 0) {
      for (const [pendingId, entry] of this.pendingDeleted) {
        if (!this.isIdDerivedFromMd5(entry.record.id, currentId)) continue;

        window.clearTimeout(entry.timer);
        this.pendingDeleted.delete(pendingId);
        const pendingRecord = entry.record;
        const stat = file.stat;

        // 若同内容当前已由另一现存文件登记：标签并入该记录即可（同内容唯一）
        const registered = this.imageDataManager.getImageData(currentId);
        const registeredFile = registered ? this.app.vault.getAbstractFileByPath(registered.path) : null;
        if (registered && registeredFile instanceof TFile) {
          registered.tags = Array.from(new Set([...(registered.tags || []), ...(pendingRecord.tags || [])]));
          Logger.warn(`[改名继承] 内容已由 ${registered.path} 登记，标签并入后沿用该记录（原 ${pendingRecord.path} 的 ${pendingRecord.tags.length} 个标签已保留）`);
          return registered;
        }

        // 接管宽限期记录：迁移到当前路径并保留原 id（规整为内容 MD5）与标签
        this.imageDataManager.removeImageData(currentId);
        const adopted: MediaData = {
          ...pendingRecord,
          id: currentId,
          path: file.path,
          title: file.basename,
          originalName: file.name,
          lastModified: stat.mtime,
          fileSize: stat.size,
          size: formatFileSize(stat.size),
        };
        this.imageDataManager.addImageData(adopted);
        Logger.warn(`[改名继承] 认领删除宽限期内的原记录: ${pendingRecord.path} -> ${file.path}（保留 ${pendingRecord.tags.length} 个标签）`);
        return adopted;
      }
    }

    // 路径上无记录：先按内容查找可能存在的同内容记录
    const byContent = this.imageDataManager.getImageDataByContentId(currentId);
    if (byContent) {
      const byContentFile = this.app.vault.getAbstractFileByPath(byContent.path);
      if (byContentFile instanceof TFile) {
        // 该内容已被另一现存文件登记：本文件属于重复拷贝，直接合并（不单独建记录）
        return undefined;
      }
      // 原文件已不存在（改名 / 移动遗留的孤儿记录）：迁移到当前路径并保留 id / 标签 / 描述
      const stat = file.stat;
      const record = this.imageDataManager.renamePath(byContent.path, file.path);
      if (record) {
        if (record.id !== currentId && !this.imageDataManager.getImageData(currentId)) {
          // 规整历史派生 id，保证同内容记录的 id 就是内容 MD5
          this.imageDataManager.removeImageData(record.id);
          record.id = currentId;
          this.imageDataManager.addImageData(record);
        }
        record.title = file.basename;
        record.originalName = file.name;
        record.lastModified = stat.mtime;
        record.fileSize = stat.size;
        record.size = formatFileSize(stat.size);
        Logger.debug(`已按内容继承原记录（改名/移动）: ${byContent.path} -> ${file.path}`);
        return this.imageDataManager.getImageDataByPath(file.path) || record;
      }
    }

    // 全新内容：以内容 MD5 创建记录
    Logger.warn(`[新建记录] ${file.path} 未找到可继承/认领的同内容记录，将创建新记录 (md5=${currentId})。若此文件由改名产生且原记录仍存在，请反馈此日志。`);
    const created = await this.createDefaultImageData(file, currentId);
    this.imageDataManager.addImageData(created);
    return this.imageDataManager.getImageDataByPath(file.path) || created;
  }

  // ===== 删除宽限期与内容认领：让“纯改名”保留原 id 与标签 =====

  /**
   * 把待删除记录移出内存并进入宽限期；若宽限期内出现内容相同（MD5 一致）的新文件
   * （Obsidian 将外部改名报告为 delete + create），会在 ensureImageDataForFile /
   * handleFileCreated 中按内容认领恢复记录，保留原 id / 标签 / 描述。
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
   * 等待数据就绪后交由 ensureImageDataForFile 完成新建 / 按内容继承 / 宽限期认领 / 同内容合并去重。
   * 不在扫描目录内的文件直接忽略：不扫描 / 不建记录（扫描目录为空 = 扫描整个库，不限制）。
   */
  private async handleFileCreated(file: TFile): Promise<void> {
    await this.dataReady;
    if (this.imageDataManager.getImageDataByPath(file.path)) return;
    // 不在扫描目录内的文件不纳入图库管理
    if (!this.isFileInScanFolder(file.path)) {
      Logger.debug(`忽略扫描目录外的媒体文件: ${file.path}`);
      return;
    }
    const ensured = await this.ensureImageDataForFile(file);
    if (ensured) {
      await this.saveDataToFile();
    }
  }

  /**
   * 判断文件路径是否在当前扫描目录设置范围内。
   * 未配置扫描目录（空）表示扫描整个库，恒返回 true。
   */
  private isFileInScanFolder(filePath: string): boolean {
    return isFileInScanFolders(filePath, this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);
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
    // 原地合并：onload 中已用默认值初始化 this.settings，视图 / 命令持有的是同一对象引用，
    // 后续设置加载完成无需重新注册即可生效。
    Object.assign(this.settings, DEFAULT_SETTINGS, loadedData || {});
    if (!this.settings.jsonStoragePath) {
      this.settings.jsonStoragePath = DEFAULT_SETTINGS.jsonStoragePath;
    }
    // 修正历史数据中可能缺失 / 类型错误的字段，避免后续 .split / .map 报错
    if (!Array.isArray(this.settings.scanMultipleFolderPaths)) {
      this.settings.scanMultipleFolderPaths = [];
    }
    if (!Array.isArray(this.settings.supportedFormats) || this.settings.supportedFormats.length === 0) {
      this.settings.supportedFormats = [...DEFAULT_SUPPORTED_FORMATS];
    }
    if (!Array.isArray(this.settings.recentTags)) {
      this.settings.recentTags = [];
    }
    if (!Array.isArray(this.settings.categories) || this.settings.categories.length === 0) {
      this.settings.categories = [...DEFAULT_CATEGORIES];
    }
    // 设置异步加载完成，把最近标签同步给已创建的数据管理器
    this.imageDataManager?.setRecentTags(this.settings.recentTags);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * 规整扫描文件夹设置：归一化路径、去重、去空，并同步旧字段 scanFolderPath 以保持兼容。
   */
  async saveScanFolderSettings(): Promise<void> {
    const folders = (this.settings.scanMultipleFolderPaths || [])
      .map(path => normalizeFolderPath(path))
      .filter((path, index, arr) => path.length > 0 && arr.indexOf(path) === index);
    this.settings.scanMultipleFolderPaths = folders;
    this.settings.scanFolderPath = folders.join(';');
    await this.saveSettings();
  }

  /**
   * 通过文件夹选择器添加扫描文件夹。
   * 选择库根目录等价于「不限制范围」，此时清空列表。
   */
  async addScanFolder(folder: TFolder): Promise<void> {
    if (!folder || folder.isRoot()) {
      this.settings.scanMultipleFolderPaths = [];
      await this.saveScanFolderSettings();
      return;
    }

    const normalized = normalizeFolderPath(folder.path);
    const current = this.settings.scanMultipleFolderPaths || [];
    if (!current.includes(normalized)) {
      this.settings.scanMultipleFolderPaths = [...current, normalized];
    }
    await this.saveScanFolderSettings();
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

  /**
   * 规整历史遗留的同内容派生记录（id 形如 md5-<后缀>）：同一内容只保留一条记录并合并标签，
   * 避免同内容因派生 id 拆分成多条导致标签分散 / 数据不合并。
   */
  private async normalizeDuplicateContentRecords(): Promise<void> {
    // 快速路径：没有任何形如 md5-<后缀> 的派生记录时直接跳过，避免每次启动都全量遍历合并
    if (!this.imageDataManager.hasDerivedContentIds()) return;

    const merged = this.imageDataManager.mergeDerivedContentRecords((path) => {
      const f = this.app.vault.getAbstractFileByPath(path);
      return f instanceof TFile;
    });
    if (merged > 0) {
      await this.saveDataToFile();
      Logger.info(`已规整 ${merged} 条同内容重复记录`);
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

  /**
   * 导出全部标签数据为 JSON。
   * 桌面端：走系统「另存为」对话框；移动端：写入库内文件（Obsidian 沙箱内无系统文件选择器）。
   */
  async exportJson(): Promise<void> {
    try {
      const json = this.imageDataManager.exportToJSON();
      const dialog = getElectronDialog();
      const fs = getNodeFs();

      if (dialog && fs) {
        const basePath = getVaultBasePath(this.app);
        const defaultPath = basePath
          ? `${basePath}${getPathSeparator()}image-tags-export.json`
          : 'image-tags-export.json';
        const result = await dialog.showSaveDialog({
          title: '导出 JSON 数据',
          defaultPath,
          filters: [{ name: 'JSON 文件', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return;

        fs.writeFileSync(result.filePath, json, 'utf8');
        new Notice(`JSON 数据已导出：${result.filePath}`);
        return;
      }

      // 移动端 / 无 Electron 能力：导出到库根目录下的文件
      const targetPath = await this.createUniqueVaultPath('image-tags-export.json');
      await this.app.vault.adapter.write(targetPath, json);
      new Notice(`JSON 数据已导出到库内文件：${targetPath}`);
    } catch (error) {
      Logger.error('导出 JSON 数据失败:', error);
      new Notice('导出 JSON 数据失败，请查看控制台。');
    }
  }

  /**
   * 导入 JSON 数据。
   * 桌面端：系统「打开文件」对话框；移动端：库内文件选择器。
   */
  async importJsonFromDialog(): Promise<void> {
    try {
      const dialog = getElectronDialog();
      const fs = getNodeFs();

      if (dialog && fs) {
        const result = await dialog.showOpenDialog({
          title: '选择 JSON 数据',
          properties: ['openFile'],
          filters: [{ name: 'JSON 文件', extensions: ['json'] }]
        });
        if (result.canceled || result.filePaths.length === 0) return;

        const jsonData = fs.readFileSync(result.filePaths[0], 'utf8') as string;
        await this.applyImportedJson(jsonData);
        return;
      }

      // 移动端 / 无 Electron 能力：从库内挑选 JSON 文件
      new VaultFileSuggestModal(this.app, 'json', async (file) => {
        try {
          const jsonData = await this.app.vault.read(file);
          await this.applyImportedJson(jsonData);
        } catch (error) {
          Logger.error('导入 JSON 数据失败:', error);
          new Notice('导入 JSON 数据失败，请确认文件格式正确。');
        }
      }).open();
    } catch (error) {
      Logger.error('导入 JSON 数据失败:', error);
      new Notice('导入 JSON 数据失败，请确认文件格式正确。');
    }
  }

  /** 解析并合并导入的 JSON 数据，随后落库 */
  private async applyImportedJson(jsonData: string): Promise<void> {
    const records = await DataMigration.loadDataWithMigrationForApp(jsonData, this.app);
    this.imageDataManager.importRecords(records);
    await this.sqliteStore.save(this.imageDataManager.getAllImageData());
    new Notice(`已导入 ${records.length} 条 JSON 数据。`);
  }

  /** 在库根目录下生成不冲突的文件名（用于移动端导出） */
  private async createUniqueVaultPath(fileName: string): Promise<string> {
    const adapter = this.app.vault.adapter;
    const dotIndex = fileName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
    const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
    let candidate = fileName;
    let index = 1;
    while (await adapter.exists(candidate)) {
      candidate = `${baseName}-${index}${extension}`;
      index += 1;
      if (index > 1000) break;
    }
    return candidate;
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
    await this.dataReady;

    new Notice('开始扫描媒体文件...');

    let allFiles = this.app.vault.getFiles();

    // 如果设置了扫描文件夹路径，则只扫描这些文件夹中的文件（未配置=扫描整个库）
    allFiles = allFiles.filter(file => this.isFileInScanFolder(file.path));

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

        return { changed: !existing ? !!mediaData : (mediaData ? existing.id !== mediaData.id : false) };
      });

      const results = await Promise.all(batchPromises);
      mediaCount += results.filter(result => result.changed).length;

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
                if (!openFileWithDefaultApp(this.app, file)) {
                  new Notice(isDesktopApp() ? '无法获取文件路径' : '移动端不支持用默认软件打开');
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
    await this.dataReady;

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

      .setDesc('仅扫描所选文件夹中的媒体文件；未添加任何文件夹时扫描整个库（可添加多个）');

    // 用文件夹选择器代替手写路径：桌面端与移动端行为一致，也不会写错路径
    const scanFolderListEl = containerEl.createDiv({ cls: 'image-tagging-folder-list' });

    const renderScanFolders = () => {
      scanFolderListEl.empty();
      const folders = this.plugin.settings.scanMultipleFolderPaths || [];

      if (folders.length === 0) {
        scanFolderListEl.createDiv({
          cls: 'image-tagging-folder-empty',
          text: '当前未限制范围，将扫描整个库'
        });
        return;
      }

      folders.forEach((folderPath) => {
        const itemEl = scanFolderListEl.createDiv({ cls: 'image-tagging-folder-item' });
        itemEl.createSpan({ cls: 'image-tagging-folder-path', text: folderPath });
        const removeButton = itemEl.createEl('button', {
          cls: 'image-tagging-folder-remove',
          text: '移除'
        });
        removeButton.addEventListener('click', async (evt) => {
          evt.preventDefault();
          this.plugin.settings.scanMultipleFolderPaths =
            (this.plugin.settings.scanMultipleFolderPaths || []).filter(p => p !== folderPath);
          await this.plugin.saveScanFolderSettings();
          renderScanFolders();
        });
      });
    };

    new Setting(containerEl)
      .setClass('image-tagging-folder-actions')
      .addButton(button => button
        .setButtonText('添加文件夹')
        .setTooltip('从库中选择一个文件夹加入扫描范围')
        .setCta()
        .onClick(() => {
          new FolderSuggestModal(this.app, async (folder) => {
            await this.plugin.addScanFolder(folder);
            renderScanFolders();
          }).open();
        }))
      .addButton(button => button
        .setButtonText('清空并扫描整库')
        .onClick(async () => {
          this.plugin.settings.scanMultipleFolderPaths = [];
          await this.plugin.saveScanFolderSettings();
          renderScanFolders();
        }));

    renderScanFolders();

  }

}