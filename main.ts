import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import { MediaData, ImageTaggingSettings, DEFAULT_SETTINGS, ImageDataManager, getMediaType } from './image-data-model';
import { ImageView, IMAGE_INFO_VIEW_TYPE } from './image-info-view';
import { GalleryView, GALLERY_VIEW_TYPE } from './gallery-view';
import { getImageResolutionWithCache, getImageFileFromPath } from './utils';

// 导入样式
import './styles.css';

interface Listener {
  (this: Document, ev: Event): any;
}

export default class ImageTaggingPlugin extends Plugin {
  settings: ImageTaggingSettings;
  imageDataManager: ImageDataManager;

  async onload() {
    await this.loadSettings();
    this.imageDataManager = new ImageDataManager();

    // 从JSON文件加载数据
    await this.loadDataFromFile();

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

      // 构造自定义菜单
      const menu = new Menu();
      menu.addItem((item: any) => {
        item.setTitle('显示媒体信息').setIcon('image').onClick(async () => {
          // 尝试获取图片 src
          const src = imgEl!.getAttribute('src');
          if (!src) return;
          // 解析 src，找到 vault 内的图片文件
          let file: any = null;
          // Obsidian 通常图片 src 以 app:// 或 vault 路径开头
          if (src.startsWith('app://')) {
            // 通过 Obsidian API 查找 TFile
            const files = this.app.vault.getFiles();
            file = files.find(f => (this.app.vault.getResourcePath(f) === src));
          } else {
            // 可能是相对路径
            file = this.app.vault.getAbstractFileByPath(src);
          }
          if (file && this.isSupportedImageFile(file)) {
            // 打开 image-info-view 并显示该图片
            await this.openImageInfoPanel();
            await this.updateImageInfoPanel(file);
          } else {
            new Notice('未找到媒体文件或不支持的媒体格式');
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

    // 注册文件打开事件，用于显示图片信息
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // 当打开文件时，更新右侧信息面板
        // ImageView内部会检查是否为支持的图片文件
        this.updateImageInfoPanel(file);
      })
    );



    // 注册文件删除事件，用于清理失效的图片数据
this.registerEvent(

      this.app.vault.on('delete', (file) => {

        if (file && this.isSupportedImageFile(file as TFile)) {

          // 检查是否有对应的图片数据

          const imageData = this.imageDataManager.getImageDataByPath(file.path);

          if (imageData) {

            // 从数据管理器中移除对应的记录

            this.imageDataManager.removeImageData(imageData.id);

            // 保存更改到文件

            this.saveDataToFile();

            console.log(`已清理已删除图片的数据: ${file.path}`);

          }

        }

      })

    );



        // 注册文件重命名事件，用于更新图片路径

    this.registerEvent(

      this.app.vault.on('rename', (file, oldPath) => {

        if (file && this.isSupportedImageFile(file as TFile)) {

          // 检查是否有对应的图片数据

          const imageData = this.imageDataManager.getImageDataByPath(oldPath);

          if (imageData) {

            // 更新图片数据中的路径信息

            imageData.path = file.path;

            // 重新添加到数据管理器

            this.imageDataManager.addImageData(imageData);

            // 保存更改到文件

            this.saveDataToFile();

            console.log(`已更新重命名图片的路径: ${oldPath} -> ${file.path}`);

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
      this.app.workspace.on('editor-menu', (menu: Menu, editor: any, view: any) => {
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
          }
        } catch (err) {
          // 忽略错误以免影响原生菜单
          console.error('editor-menu 处理出错:', err);
        }
      })
    );

    // 注册文档事件监听器，用于处理所有窗口中的图片右键菜单
    this.registerDocument(document);

    this.app.workspace.on("window-open", (workspaceWindow: any, window: any) => {
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
            (leaf.view as any).contentEl.removeEventListener('click', clickEventHandler);
            (leaf.view as any).contentEl.addEventListener('click', clickEventHandler);
          }
        })
      );
      
      // 为当前已打开的编辑器添加监听器
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.view && (leaf.view as any).contentEl) {
          (leaf.view as any).contentEl.addEventListener('click', clickEventHandler);
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
        let imageData = this.imageDataManager.getImageDataByPath(file.path);
        
        if (!imageData) {
          // 如果不存在，则创建默认数据
          imageData = await this.createDefaultImageData(file);
          this.imageDataManager.addImageData(imageData);
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

      } else if (mediaType === 'video') {

        // 对于视频，可以尝试获取时长等信息（暂时保持未知）

        resolution = '视频文件';

      } else if (mediaType === 'audio') {

        // 对于音频，可以尝试获取时长等信息（暂时保持未知）

        resolution = '音频文件';

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

      id: `media_${Date.now()}_${path}`,

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
      console.error(`提取图片路径时出错 (${activeFile.path}):`, error);
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
      console.warn('Failed to decode URI component:', imagePath, e);
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
    // 清理视图
    this.app.workspace.detachLeavesOfType(GALLERY_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(IMAGE_INFO_VIEW_TYPE);
}

  async loadSettings() {

    // 加载保存的设置，如果不存在则使用默认设置

    const loadedData = await this.loadData();

    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);

    

    // 确保jsonStoragePath不为空

    if (!this.settings.jsonStoragePath) {

      this.settings.jsonStoragePath = DEFAULT_SETTINGS.jsonStoragePath;

    }

  }



  /**

   * 确保文件路径的目录存在，如果不存在则创建

   * @param filePath 文件路径

   */

  async ensureDirectoryExists(filePath: string) {

    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

    if (dirPath && !(await this.app.vault.adapter.exists(dirPath))) {

      // 递归创建目录

      const pathParts = dirPath.split('/');

      let currentPath = '';

      

      for (const part of pathParts) {

        if (part) {  // 跳过空字符串（如路径开头的斜杠）

          currentPath += (currentPath ? '/' : '') + part;

          if (!(await this.app.vault.adapter.exists(currentPath))) {

            await this.app.vault.adapter.mkdir(currentPath);

            console.log(`创建目录: ${currentPath}`);

          }

        }

      }

    }

  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadDataFromFile() {

    try {

      // 确保路径有效且不为空

      if (!this.settings.jsonStoragePath || this.settings.jsonStoragePath.trim() === '') {

        this.settings.jsonStoragePath = DEFAULT_SETTINGS.jsonStoragePath;

        console.warn('JSON存储路径为空，使用默认路径:', this.settings.jsonStoragePath);

      }



      if (await this.app.vault.adapter.exists(this.settings.jsonStoragePath)) {

        const jsonData = await this.app.vault.adapter.read(this.settings.jsonStoragePath);

        this.imageDataManager.importFromJSON(jsonData);

        console.log('图片标签数据加载成功:', this.settings.jsonStoragePath);

        new Notice('图片标签数据加载成功。');

      } else {

        console.log('JSON数据文件不存在，将创建新文件:', this.settings.jsonStoragePath);

        // 确保目录存在

        await this.ensureDirectoryExists(this.settings.jsonStoragePath);

        // 文件不存在时，初始化空数据

        this.imageDataManager = new ImageDataManager();

      }

    } catch (error) {

      console.error('加载图片标签数据失败:', error);

      console.error('尝试加载的路径:', this.settings.jsonStoragePath);

      new Notice('加载图片标签数据失败，已初始化空数据。');

      // 初始化空数据

      this.imageDataManager = new ImageDataManager();

    }

  }

  async saveDataToFile() {

    try {

      // 确保路径有效且不为空

      if (!this.settings.jsonStoragePath || this.settings.jsonStoragePath.trim() === '') {

        this.settings.jsonStoragePath = DEFAULT_SETTINGS.jsonStoragePath;

        console.warn('JSON存储路径为空，使用默认路径:', this.settings.jsonStoragePath);

        await this.saveSettings(); // 保存修正后的设置

      }



      // 确保目录存在

      await this.ensureDirectoryExists(this.settings.jsonStoragePath);



      const jsonData = this.imageDataManager.exportToJSON();

      // 使用 Vault.write 代替 adapter.write 以便更好地兼容 Obsidian 环境

      await this.app.vault.adapter.write(this.settings.jsonStoragePath, jsonData); 

      // 注意：使用 adapter.write 避免了触发文件事件，是存储插件私有数据的好方法

      console.log('图片标签数据保存成功:', this.settings.jsonStoragePath);

    } catch (error) {

      console.error('保存图片标签数据失败:', error);

      console.error('尝试保存的路径:', this.settings.jsonStoragePath);

      new Notice('保存图片标签数据失败');

    }

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

    

    let mediaCount = 0;

    

    for (const file of allFiles) {

      if (this.isSupportedImageFile(file)) {

        const existingData = this.imageDataManager.getImageDataByPath(file.path);

        if (!existingData) {

          // 如果不存在，则创建默认数据

          const mediaData = await this.createDefaultImageData(file);

          this.imageDataManager.addImageData(mediaData);

          mediaCount++;

        }

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
                // 打开图片信息面板并显示该图片的信息
                this.openImageInfoPanel();
                this.updateImageInfoPanel(file);
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



    const removedCount = this.imageDataManager.cleanupInvalidImages(this.app, this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);



    await this.saveDataToFile();



    new Notice(`清理完成！移除了 ${removedCount} 个失效的图片数据记录。`);



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
      .setName('JSON 存储路径')
      .setDesc('用于存储图片标签数据的 JSON 文件路径')
      .addText(text => text
        .setPlaceholder('.obsidian/image-tags.json')
        .setValue(this.plugin.settings.jsonStoragePath)
        .onChange(async (value) => {
          this.plugin.settings.jsonStoragePath = value;
          await this.plugin.saveSettings();
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

    new Setting(containerEl)

      .setName('导入时自动添加标签')

      .setDesc('当新图片添加到库中时，是否自动创建标签数据项')

      .addToggle(toggle => toggle

        .setValue(this.plugin.settings.autoTagOnImport)

        .onChange(async (value) => {

          this.plugin.settings.autoTagOnImport = value;

          await this.plugin.saveSettings();

        }));


    new Setting(containerEl)

      .setName('导入时自动添加的标签')

      .setDesc('当启用自动添加标签时，为新图片添加的默认标签（多个标签用逗号分隔）')

      .addText(text => text

        .setPlaceholder('例如：未整理,新图片')

        .setValue(this.plugin.settings.autoTagOnImportValue)

        .onChange(async (value) => {

          this.plugin.settings.autoTagOnImportValue = value;

          await this.plugin.saveSettings();

        }));



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