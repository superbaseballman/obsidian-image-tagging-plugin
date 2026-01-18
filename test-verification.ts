/**
 * 测试文件，用于验证插件功能
 */

// 该文件包含对插件功能的测试，确保所有功能正常工作
import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, Notice, Menu } from 'obsidian';
import { MediaData, ImageTaggingSettings, DEFAULT_SETTINGS, ImageDataManager, getMediaType } from './image-data-model';
import { ImageView } from './image-info-view';
import { GalleryView } from './gallery-view';
import { getImageResolutionWithCache, getImageFileFromPath } from './utils';
import { Logger, LogLevel } from './logger';
import { GALLERY_VIEW_TYPE, IMAGE_INFO_VIEW_TYPE, DEFAULT_JSON_STORAGE_PATH, DEFAULT_SUPPORTED_FORMATS, DEFAULT_CATEGORIES } from './constants';
import { ImageCacheManager } from './image-cache-manager';

export default class ImageTaggingPlugin extends Plugin {
  settings: ImageTaggingSettings;
  imageDataManager: ImageDataManager;

  async onload() {
    await this.loadSettings();
    this.imageDataManager = new ImageDataManager();

    // 从JSON文件加载数据
    await this.loadDataFromFile();

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

    // 在布局准备就绪后设置编辑器图片点击处理程序
    this.app.workspace.onLayoutReady(() => {
      this.setupEditorImageClickHandler();
    });

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
            Logger.debug(`已清理已删除图片的数据: ${file.path}`);
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
            Logger.debug(`已更新重命名图片的路径: ${oldPath} -> ${file.path}`);
          }
        }
      })
    );
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
      this.settings.jsonStoragePath = DEFAULT_JSON_STORAGE_PATH;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadDataFromFile() {
    try {
      // 确保路径有效且不为空
      if (!this.settings.jsonStoragePath || this.settings.jsonStoragePath.trim() === '') {
        this.settings.jsonStoragePath = DEFAULT_JSON_STORAGE_PATH;
        Logger.warn('JSON存储路径为空，使用默认路径:', this.settings.jsonStoragePath);
      }

      if (await this.app.vault.adapter.exists(this.settings.jsonStoragePath)) {
        const jsonData = await this.app.vault.adapter.read(this.settings.jsonStoragePath);
        this.imageDataManager.importFromJSON(jsonData);
        Logger.info('图片标签数据加载成功:', this.settings.jsonStoragePath);
        new Notice('图片标签数据加载成功。');
      } else {
        Logger.info('JSON数据文件不存在，将创建新文件:', this.settings.jsonStoragePath);
        // 文件不存在时，初始化空数据
        this.imageDataManager = new ImageDataManager();
      }
    } catch (error) {
      Logger.error('加载图片标签数据失败:', error);
      Logger.error('尝试加载的路径:', this.settings.jsonStoragePath);
      new Notice('加载图片标签数据失败，已初始化空数据。');
      // 初始化空数据
      this.imageDataManager = new ImageDataManager();
    }
  }

  async saveDataToFile() {
    try {
      // 确保路径有效且不为空
      if (!this.settings.jsonStoragePath || this.settings.jsonStoragePath.trim() === '') {
        this.settings.jsonStoragePath = DEFAULT_JSON_STORAGE_PATH;
        Logger.warn('JSON存储路径为空，使用默认路径:', this.settings.jsonStoragePath);
        await this.saveSettings(); // 保存修正后的设置
      }

      const jsonData = this.imageDataManager.exportToJSON();
      // 使用 Vault.write 代替 adapter.write 以便更好地兼容 Obsidian 环境
      await this.app.vault.adapter.write(this.settings.jsonStoragePath, jsonData); 
      Logger.info('图片标签数据保存成功:', this.settings.jsonStoragePath);
    } catch (error) {
      Logger.error('保存图片标签数据失败:', error);
      Logger.error('尝试保存的路径:', this.settings.jsonStoragePath);
      new Notice('保存图片标签数据失败');
    }
  }

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
    const filesToProcess = supportedFiles.filter(file => !this.imageDataManager.getImageDataByPath(file.path));

    let mediaCount = 0;

    // 批量处理文件以提高性能
    const batchSize = 50; // 每批处理的文件数量
    for (let i = 0; i < filesToProcess.length; i += batchSize) {
      const batch = filesToProcess.slice(i, i + batchSize);
      
      // 并行处理当前批次的文件
      const batchPromises = batch.map(async file => {
        const mediaData = await this.createDefaultImageData(file);
        this.imageDataManager.addImageData(mediaData);
        return mediaData;
      });

      await Promise.all(batchPromises);
      mediaCount += batch.length;

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
      Logger.warn(`无法获取媒体信息: ${path}`, e);
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

  isSupportedImageFile(file: TFile): boolean {
    const extension = file.extension ? file.extension.toLowerCase() : '';
    // 使用 Set 查找性能更好，但考虑到格式列表不长，array.includes 也可接受
    return this.settings.supportedFormats.includes(extension); 
  }

  private setupEditorImageClickHandler() {
    // 实现编辑器图片点击处理逻辑
    Logger.debug('设置编辑器图片点击处理程序');
  }
}
