import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, Vault } from 'obsidian';
import { ImageData, ImageTaggingSettings, DEFAULT_SETTINGS, ImageDataManager } from './image-data-model';
import { ImageView, IMAGE_INFO_VIEW_TYPE } from './image-info-view';
import { GalleryView, GALLERY_VIEW_TYPE } from './gallery-view';

// 导入样式
import './styles.css';

export default class ImageTaggingPlugin extends Plugin {
  settings: ImageTaggingSettings;
  imageDataManager: ImageDataManager;

  async onload() {
    await this.loadSettings();
    this.imageDataManager = new ImageDataManager();

    // 从JSON文件加载数据
    await this.loadDataFromFile();

    // 添加设置选项卡
    this.addSettingTab(new ImageTaggingSettingTab(this.app, this));

    // 注册视图
    this.registerView(
      GALLERY_VIEW_TYPE,
      (leaf) => new GalleryView(leaf, this.settings, this.imageDataManager)
    );
    this.registerView(
      IMAGE_INFO_VIEW_TYPE,
      (leaf) => new ImageView(leaf, this.imageDataManager)
    );

    // 添加命令
    this.addCommand({
      id: 'open-gallery-view',
      name: '打开图片图库',
      callback: () => {
        this.openGalleryView();
      }
    });

    this.addCommand({
      id: 'open-image-info-panel',
      name: '打开图片信息面板',
      callback: () => {
        this.openImageInfoPanel();
      }
    });

    this.addCommand({
      id: 'scan-all-images',
      name: '扫描库中的所有图片',
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

        if (file && this.isSupportedImageFile(file)) {

          // 当打开支持的图片文件时，更新右侧信息面板

          this.updateImageInfoPanel(file);

        }

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
          imageData = this.createDefaultImageData(file);
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
  private async createDefaultImageData(file: TFile): Promise<ImageData> {
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
    
    try {
      // 尝试获取图片分辨率
      const fileUrl = this.app.vault.getResourcePath(file);
      const loadImage = (src: string): Promise<{width: number, height: number} | null> => {
        return new Promise((resolve) => {
          const tempImg = new Image();
          tempImg.onload = () => resolve({ width: tempImg.width, height: tempImg.height });
          tempImg.onerror = () => resolve(null);
          tempImg.src = src;
        });
      };
      
      const dimensions = await loadImage(fileUrl);
      if (dimensions) {
        width = dimensions.width;
        height = dimensions.height;
        resolution = `${width}x${height}`;
      }
    } catch (e) {
      console.warn(`无法获取图片分辨率: ${path}`, e);
    }
    
    return {
      id: `img_${Date.now()}_${path}`,
      path: path,
      title: name,
      tags: [],
      date: new Date().toISOString(),
      size: size,
      resolution: resolution,
      format: extension.toUpperCase(),
      description: '',
      originalName: file.name,
      lastModified: lastModified,
      width: width,
      height: height,
      fileSize: stat.size
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
    const cleanPath = imagePath.trim();
    if (!cleanPath || cleanPath.includes('://')) {
        // 排除空路径或外部 URL
        return null;
    }
    
    // 1. 尝试使用完整的/绝对路径或当前 Obsidian API 可以直接解析的路径
    let file = this.app.vault.getAbstractFileByPath(cleanPath);
    // 运行时可能无法使用 TFile 符号（打包/类型移除），使用更稳健的检查
    if (file && (file as any).path) {
      return file as any;
    }

    // 2. 处理相对路径 (./ 或 ../)
    // 即使路径不是以 './' 或 '../' 开头，它也可能是相对于当前文件路径的。
    if (activeFile.parent) {
        // 使用 resolveLinkpath 方法来处理相对路径（Obsidian API 内部提供）
        // 虽然它主要用于 Wikilink，但对于路径解析在内部也是有效的辅助手段
        const resolvedPath = this.app.metadataCache.getFirstLinkpathMatch(cleanPath, activeFile.path);
        
        if (resolvedPath) {
            file = this.app.vault.getAbstractFileByPath(resolvedPath);
            if (file && (file as any).path) {
              return file as any;
            }
        }
    } else {
         // 如果 activeFile 在根目录，且路径不是绝对路径，
         // 理论上 getAbstractFileByPath(cleanPath) 在步骤 1 应该能处理。
    }

    // 3. 尝试在整个 Vault 中查找匹配的文件名 (作为兼容性回退)
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
    new Notice('开始扫描图片文件...');
    
    let allFiles = this.app.vault.getFiles();
    
    // 如果设置了扫描文件夹路径，则只扫描该文件夹中的文件
    if (this.settings.scanFolderPath && this.settings.scanFolderPath.trim() !== '') {
      const folderPath = this.normalizePath(this.settings.scanFolderPath);
      allFiles = allFiles.filter(file => this.isFileInFolder(file.path, folderPath));
    }
    
    let imageCount = 0;
    
    for (const file of allFiles) {
      if (this.isSupportedImageFile(file)) {
        const existingData = this.imageDataManager.getImageDataByPath(file.path);
        if (!existingData) {
          // 如果不存在，则创建默认数据
          const imageData = await this.createDefaultImageData(file);
          this.imageDataManager.addImageData(imageData);
          imageCount++;
        }
      }
    }
    
    if (imageCount > 0) {
      await this.saveDataToFile();
    }
    new Notice(`扫描完成！新增了 ${imageCount} 个图片记录`);
  }

  private normalizePath(path: string): string {
    // 标准化路径，确保以 '/' 结尾以便正确匹配
    let normalized = path.replace(/\\/g, '/');
    if (!normalized.endsWith('/')) {
      normalized += '/';
    }
    return normalized;
  }

  private isFileInFolder(filePath: string, folderPath: string): boolean {
    // 检查文件是否在指定文件夹中
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    return normalizedFilePath.startsWith(folderPath);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
      await leaf.setViewState({ type: IMAGE_INFO_VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
    
    // 如果当前有打开的图片文件，更新视图
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && this.isSupportedImageFile(activeFile)) {
      const view = leaf.view as ImageView;
      await view.updateForFile(activeFile);
    }
  }

  async updateImageInfoPanel(file: TFile | null) {
    const leaves = this.app.workspace.getLeavesOfType(IMAGE_INFO_VIEW_TYPE);
    
    for (const leaf of leaves) {
      const view = leaf.view as ImageView;
      await view.updateForFile(file);
    }
  }

  isSupportedImageFile(file: TFile): boolean {

    const extension = file.extension ? file.extension.toLowerCase() : '';

    // 使用 Set 查找性能更好，但考虑到格式列表不长，array.includes 也可接受

    return this.settings.supportedFormats.includes(extension); 

  }



  // 清理失效的图片数据

  async cleanupInvalidImages() {

    const removedCount = this.imageDataManager.cleanupInvalidImages(this.app, this.settings.scanFolderPath);

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

      .setName('扫描指定文件夹')

      .setDesc('指定要扫描图片的文件夹路径（留空则扫描整个库）')

      .addText(text => text

        .setPlaceholder('例如：Attachments/images')

        .setValue(this.plugin.settings.scanFolderPath)

        .onChange(async (value) => {

          this.plugin.settings.scanFolderPath = value;

          await this.plugin.saveSettings();

        }));

  }

}