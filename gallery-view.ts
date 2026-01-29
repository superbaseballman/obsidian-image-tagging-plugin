import { ItemView, WorkspaceLeaf, Notice, TFile, App } from 'obsidian';
import { MediaData, ImageTaggingSettings, ImageDataManager, getMediaType } from './image-data-model';
import { getImageResolutionWithCache, getImageTaggingPlugin, getSafeImagePath, preloadImageInfo } from './utils';
import { Logger } from './logger';
import { GALLERY_VIEW_TYPE, CSS_CLASSES } from './constants';

// 图库视图类

export class GalleryView extends ItemView {

  settings: ImageTaggingSettings;

  imageDataManager: ImageDataManager;

  currentFilter: string = '';



  currentCategory: string = '全部图片';



  categories: string[] = [];

  

  selectedTags: string[] = []; // 存储当前选择的标签

  selectedImages: string[] = []; // 存储当前选中的图片ID
  
  lastSelectedImageId: string | null = null; // 存储最后选中的图片ID，用于Shift连续选择



  constructor(leaf: WorkspaceLeaf, settings: ImageTaggingSettings, imageDataManager: ImageDataManager) {

    super(leaf);

    this.settings = settings;

    this.imageDataManager = imageDataManager;
    
    // 从设置中加载分类导航
    this.categories = [...(settings.categories || ['全部图片', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术'])];
  }

  getViewType(): string {
    return GALLERY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '媒体图库';
  }

  getIcon(): string {
    return 'gallery';
  }

  async onOpen() {
    this.containerEl.empty();
    this.createView();
    await this.refreshData();
  }

  async onClose() {
    // 无需特殊处理
  }

  private createView() {
    this.containerEl.empty();
    
    // 创建主容器
    const galleryContainer = this.containerEl.createEl('div', { cls: 'image-gallery-container' });
    
    // 创建顶部搜索栏

    const header = galleryContainer.createEl('div', { cls: 'gallery-header' });

    const searchContainer = header.createEl('div', { cls: 'gallery-search-container' });

    const searchInput = searchContainer.createEl('input', {

      cls: 'gallery-search-input',

      placeholder: '搜索媒体或标签...',

      type: 'text'

    });

    // 创建清除按钮

    const clearButton = searchContainer.createEl('span', {

      cls: 'search-clear-button',

      text: '×'

    });

    // 为清除按钮添加点击事件

    clearButton.addEventListener('click', () => {

      searchInput.value = '';

      this.currentFilter = '';

      this.selectedTags = []; // 清空选中的标签

      this.renderImages();

      this.updatePopularTags(); // 更新标签显示

    });
    
    // 创建主内容区域
    const contentContainer = galleryContainer.createEl('div', { cls: 'gallery-content' });
    
    // 左侧边栏
    const sidebar = contentContainer.createEl('div', { cls: 'gallery-sidebar' });
    
    // 分类导航
    const categoriesSection = sidebar.createEl('div', { cls: 'gallery-categories' });
    categoriesSection.createEl('h4', { text: '分类导航' });
    const categoriesList = categoriesSection.createEl('ul', { cls: 'categories-list' });
    
    // 添加分类项

    this.categories.forEach((category, index) => {

      const li = this.createCategoryElement(categoriesList, category, category === '全部图片');

      li.addEventListener('click', () => {

        this.currentCategory = category;

        // 移除所有活动状态

        categoriesList.querySelectorAll('.category-item').forEach(item => {

          item.removeClass('active');

        });

        // 添加当前活动状态

        li.addClass('active');

        this.renderImages();

      });

    });



    // 添加添加新分类的输入框和按钮

    const addCategoryContainer = sidebar.createEl('div', { cls: 'add-category-container' });

    const addCategoryInput = addCategoryContainer.createEl('input', {

      cls: 'add-category-input',

      type: 'text',

      placeholder: '添加新分类...'

    });

    const addCategoryBtn = addCategoryContainer.createEl('button', {

      cls: 'add-category-btn',

      text: '添加'

    });



    addCategoryBtn.addEventListener('click', () => {

      this.addNewCategory(addCategoryInput, categoriesList);

    });



    addCategoryInput.addEventListener('keypress', (e) => {

      if (e.key === 'Enter') {

        this.addNewCategory(addCategoryInput, categoriesList);

      }

    });
    
    // 热门标签

    const tagsSection = sidebar.createEl('div', { cls: 'gallery-tags' });

    tagsSection.createEl('h4', { text: '热门标签' });

    const tagsContainer = tagsSection.createEl('div', { cls: 'tags-cloud' });
    
    // 图片统计信息
    const statsSection = sidebar.createEl('div', { cls: 'gallery-stats' });
    statsSection.createEl('h4', { text: '统计信息' });
    const statsContainer = statsSection.createEl('div', { cls: 'stats-grid' });
    
    statsContainer.createEl('div', { cls: 'stat-item' }).innerHTML = `
      <div class="stat-value" id="total-images">0</div>
      <div class="stat-label">总图片数</div>
    `;
    
    statsContainer.createEl('div', { cls: 'stat-item' }).innerHTML = `
      <div class="stat-value" id="total-tags">0</div>
      <div class="stat-label">标签总数</div>
    `;
    
    statsContainer.createEl('div', { cls: 'stat-item' }).innerHTML = `
      <div class="stat-value" id="total-categories-stat">0</div>
      <div class="stat-label">分类数</div>
    `;
    
    // 右侧主内容区
    const mainContent = contentContainer.createEl('div', { cls: 'gallery-main' });
    
    // 工具栏
    const toolbar = mainContent.createEl('div', { cls: 'gallery-toolbar' });
    toolbar.createEl('h3', { text: '图片图库' });
    
    const toolbarControls = toolbar.createEl('div', { cls: 'toolbar-controls' });
    
    // 排序下拉菜单
    const sortContainer = toolbarControls.createEl('div', { cls: 'sort-container' });
    sortContainer.createEl('select', { 
      cls: 'sort-select' 
    }).innerHTML = `
      <option value="name">按名称</option>
      <option value="date">按日期</option>
      <option value="size">按大小</option>
      <option value="tags">按标签数</option>
    `;
    
    // 刷新按钮
    const refreshButton = toolbarControls.createEl('button', {
      cls: 'refresh-button',
      text: '刷新'
    });
    refreshButton.addEventListener('click', async () => {
      await this.refreshGallery();
    });
    
    // 主要网格
    const gridContainer = mainContent.createEl('div', { cls: 'gallery-grid-container' });
    this.imageGrid = gridContainer.createEl('div', { cls: 'gallery-grid' });
    
    // 添加事件监听器
    this.addEventListeners();
    
    // 初始化统计数据
    this.updateStats();
  }

  private addEventListeners() {

    // 搜索功能

    const searchInput = this.containerEl.querySelector('.gallery-search-input') as HTMLInputElement;

    if (searchInput) {

      searchInput.addEventListener('input', (e) => {

        this.currentFilter = (e.target as HTMLInputElement).value.toLowerCase();

        // 如果搜索框内容包含逗号分隔的标签，则更新selectedTags

        if (this.currentFilter.includes(',')) {

          this.selectedTags = this.currentFilter.split(',')

            .map(tag => tag.trim())

            .filter(tag => tag.length > 0);

        } else if (this.currentFilter.trim() === '') {

          this.selectedTags = [];

        }

        this.renderImages();

      });

    }

    

    // 排序功能

    const sortSelect = this.containerEl.querySelector('.sort-select') as HTMLSelectElement;

    if (sortSelect) {

      sortSelect.addEventListener('change', () => {

        this.renderImages();

      });

    }

  }

  private imageGrid: HTMLElement;

  private async refreshData() {
    // 从插件实例获取最新数据
    let plugin = getImageTaggingPlugin(this.app);
    
    // 如果直接获取失败，尝试通过 workspace 获取
    if (!plugin) {
      // 遍历已加载的插件尝试找到当前插件
      const allPlugins = (this.app as any).plugins.plugins;
      if (allPlugins) {
        for (const [id, pluginInstance] of Object.entries(allPlugins)) {
          if (id === 'image-tagging-obsidian') {
            plugin = pluginInstance as any;
            break;
          }
        }
      }
    }
    
    if (plugin && plugin.imageDataManager) {
      // 更新本地引用的数据管理器
      this.imageDataManager = plugin.imageDataManager;
    }
    
    // 重新加载并渲染数据
    this.renderImages();
    
    // 更新统计信息
    this.updateStats();
    
    // 更新热门标签
    this.updatePopularTags();
  }

  private async refreshGallery() {
    // 尝试多次获取插件实例，因为有时可能由于加载时机问题无法立即获取
    let plugin = getImageTaggingPlugin(this.app);
    
    // 如果直接获取失败，尝试通过 workspace 获取
    if (!plugin) {
      // 遍历已加载的插件尝试找到当前插件
      const allPlugins = (this.app as any).plugins.plugins;
      if (allPlugins) {
        for (const [id, pluginInstance] of Object.entries(allPlugins)) {
          if (id === 'image-tagging-obsidian') {
            plugin = pluginInstance as any;
            break;
          }
        }
      }
    }
    
    if (!plugin) {
      new Notice('无法获取插件实例，刷新失败');
      console.error('Failed to get plugin instance in refreshGallery');
      return;
    }

    // 确保使用插件实例的数据管理器
    const imageDataManager = plugin.imageDataManager;
    this.imageDataManager = imageDataManager;

    // 清理无效媒体数据（删除不存在的或不在指定扫描路径内的媒体记录）
    const removedCount = imageDataManager.cleanupInvalidImages(this.app, this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);
    
    // 刷新媒体数据（根据设置扫描媒体）
    await this.scanImagesBasedOnSettings();

    // 确保在扫描后再次使用插件实例的数据管理器
    this.imageDataManager = plugin.imageDataManager;

    // 直接通过插件实例保存数据，确保保存的是最新数据
    await plugin.saveDataToFile();

    // 重新渲染
    this.renderImages();

    // 获取最终的媒体计数用于通知
    const finalCount = imageDataManager.getAllImageData().length;
    new Notice(`图库已刷新，清理了 ${removedCount} 个无效媒体记录，当前共有 ${finalCount} 个媒体项目`);
  }

  private async scanImagesBasedOnSettings() {

    // 获取插件实例
    let plugin = getImageTaggingPlugin(this.app);
    
    // 如果直接获取失败，尝试通过 workspace 获取
    if (!plugin) {
      // 遍历已加载的插件尝试找到当前插件
      const allPlugins = (this.app as any).plugins.plugins;
      if (allPlugins) {
        for (const [id, pluginInstance] of Object.entries(allPlugins)) {
          if (id === 'image-tagging-obsidian') {
            plugin = pluginInstance as any;
            break;
          }
        }
      }
    }
    
    if (!plugin || !plugin.imageDataManager) {
      new Notice('无法获取插件数据管理器，扫描失败');
      console.error('Failed to get plugin or imageDataManager in scanImagesBasedOnSettings');
      return;
    }

    // 使用插件实例的数据管理器
    const imageDataManager = plugin.imageDataManager;

    new Notice('开始扫描媒体文件...');

    // 获取所有文件
    let allFiles = this.app.vault.getFiles();

    // 处理文件夹路径：优先使用新的多文件夹设置，如果为空则使用旧的单文件夹设置
    let folderPathsToUse: string[] = [];

    // 检查是否有新的多个文件夹路径设置
    if (this.settings.scanMultipleFolderPaths && this.settings.scanMultipleFolderPaths.length > 0) {
      folderPathsToUse = this.settings.scanMultipleFolderPaths.map(path => this.normalizePath(path));
    } else if (this.settings.scanFolderPath && this.settings.scanFolderPath.trim() !== '') {
      // 如果新的设置为空，但旧的设置有值，则使用旧设置
      folderPathsToUse = [this.normalizePath(this.settings.scanFolderPath)];
    }

    // 如果设置了扫描文件夹路径，则只扫描这些文件夹中的文件
    if (folderPathsToUse.length > 0) {
      allFiles = allFiles.filter(file => this.isFileInFolder(file.path, folderPathsToUse));
    }

    let mediaCount = 0;

    // 获取当前支持的媒体格式
    const supportedFormats = this.settings.supportedFormats || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'mp4', 'avi', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg'];

    for (const file of allFiles) {
      // 检查是否为支持的媒体格式
      if (supportedFormats.includes(file.extension.toLowerCase())) {
        const existingData = imageDataManager.getImageDataByPath(file.path);
        if (!existingData) {
          // 如果不存在，则创建默认数据
          const newData = await this.createImageDataFromFile(file);
          imageDataManager.addImageData(newData);
          mediaCount++;
        }
      }
    }

    if (mediaCount > 0) {
      // 直接使用插件实例保存数据，确保数据一致性
      await plugin.saveDataToFile();
      new Notice(`扫描完成！新增了 ${mediaCount} 个媒体记录`);
    } else {
      new Notice('扫描完成！没有发现新的媒体文件');
    }
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

  private async saveDataToFile() {
    // 保存数据到文件
    let plugin = getImageTaggingPlugin(this.app);
    
    // 如果直接获取失败，尝试通过 workspace 获取
    if (!plugin) {
      // 遍历已加载的插件尝试找到当前插件
      const allPlugins = (this.app as any).plugins.plugins;
      if (allPlugins) {
        for (const [id, pluginInstance] of Object.entries(allPlugins)) {
          if (id === 'image-tagging-obsidian') {
            plugin = pluginInstance as any;
            break;
          }
        }
      }
    }
    
    if (plugin) {
      await plugin.saveDataToFile();
    }
  }

private async createImageDataFromFile(file: TFile, id?: string): Promise<MediaData> {

    // 如果没有提供ID，则生成一个新的ID

    const imageId = id || this.generateId();

    

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

        // 对于视频，暂时保持默认分辨率

        resolution = '视频文件';

      } else if (mediaType === 'audio') {

        // 对于音频，暂时保持默认分辨率

        resolution = '音频文件';

      }

        } catch (e) {

          Logger.warn(`无法获取媒体信息: ${path}`, e);

        }

    

    // 从插件获取设置并根据设置确定标签

    const plugin = getImageTaggingPlugin(this.app);

    let tags: string[] = [];

    if (plugin && plugin.settings.autoTagOnImport && plugin.settings.autoTagOnImportValue) {

      // 如果启用了自动标签功能且有自定义标签值，则使用这些标签

      tags = plugin.settings.autoTagOnImportValue

        .split(',')

        .map((tag: string) => tag.trim())

        .filter((tag: string) => tag.length > 0);

    }

    

    // 创建媒体数据对象

    const imageData: MediaData = {

      id: imageId,

      path: path,

      title: name,

      tags: tags, // 使用根据设置确定的标签

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



    return imageData;

  }

  private generateId(): string {
    // 生成一个唯一的ID
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private loadData() {
    // 从数据管理器加载数据
    this.renderImages();
  }

  private renderImages() {
    if (!this.imageGrid) return;
    
    // 获取所有图片数据
    let images = this.imageDataManager.getAllImageData();
    
    // 过滤掉路径无效的图片
    images = images.filter(image => image.path);
    
    // 应用分类过滤
    if (this.currentCategory && this.currentCategory !== '全部图片') {
      images = images.filter(image => 
        image.tags.includes(this.currentCategory) || 
        image.title.includes(this.currentCategory)
      );
    }
    
    // 应用搜索过滤 - 支持多标签搜索（用逗号分隔的标签）

    if (this.currentFilter) {

      const filter = this.currentFilter.toLowerCase();

      // 检查是否是标签搜索（包含逗号分隔的多个标签）

      const tagFilters = filter.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);

      

      if (tagFilters.length > 1) {

        // 多标签搜索：图片必须包含所有指定标签

        images = images.filter(image => 

          tagFilters.every(tagFilter => 

            image.tags.some(tag => tag.toLowerCase().includes(tagFilter))

          )

        );

      } else {

        // 单标签或普通搜索

        images = images.filter(image => 

          image.title.toLowerCase().includes(filter) ||

          image.description.toLowerCase().includes(filter) ||

          image.tags.some(tag => tag.toLowerCase().includes(filter))

        );

      }

    }
    
    // 应用排序
    const sortSelect = this.containerEl.querySelector('.sort-select') as HTMLSelectElement;
    const sortBy = sortSelect ? sortSelect.value : 'name';
    
    images.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        case 'size':
          // 简单的大小比较，实际应用中需要更复杂的解析
          return b.size.localeCompare(a.size);
        case 'tags':
          return b.tags.length - a.tags.length;
        case 'name':
        default:
          return a.title.localeCompare(b.title);
      }
    });
    
    // 清空网格
    this.imageGrid.empty();
    
    // 渲染图片
    images.forEach(image => {
      // 验证图片路径有效
      if (!image.path) return;
      
      const imageCard = this.imageGrid.createEl('div', { cls: 'image-card' });
      imageCard.dataset.imageId = image.id;
      
      // 生成标签HTML
      let tagsHtml = '';
      image.tags.slice(0, 3).forEach(tag => {
        const colorIndex = this.getTagColorIndex(tag); // 使用哈希值选择颜色
        const colors = ['blue', 'green', 'purple', 'yellow', 'red', 'pink', 'indigo', 'teal'];
        const color = colors[colorIndex];
        tagsHtml += `<span class="image-tag tag-color-${color}">${tag}</span>`;
      });
      
      // 如果标签超过3个，显示更多
      if (image.tags.length > 3) {
        tagsHtml += `<span class="image-tag tag-more">+${image.tags.length - 3}</span>`;
      }
      
      // 使用安全的媒体路径获取方法
      const mediaPath = getSafeImagePath(this.app, image.path);
      
      // 根据媒体类型生成不同的预览元素
      let previewElement = '';
      if (image.type === 'image') {
        previewElement = `<img src="${mediaPath}" alt="${image.title}" class="image-preview">`;
      } else if (image.type === 'video') {
        previewElement = `<video src="${mediaPath}" class="image-preview" controls></video>`;
      } else if (image.type === 'audio') {
        previewElement = `<audio src="${mediaPath}" class="image-preview" controls></audio>`;
      } else {
        previewElement = `<img src="${mediaPath}" alt="${image.title}" class="image-preview">`; // 默认作为图片处理
      }
      
      // 检查图片是否被选中
      const isSelected = this.selectedImages.includes(image.id);
      if (isSelected) {
        imageCard.addClass('selected');
      }
      
      imageCard.innerHTML = `

        <div class="image-card-inner">

          <div class="image-preview-container" data-media-path="${mediaPath}">

            ${previewElement}
            
            <!-- 选中状态指示器 -->
            <div class="image-selection-indicator ${isSelected ? 'selected' : ''}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>

            <div class="image-overlay">

              <div class="image-overlay-content">

                <h4 class="image-title">${image.title}</h4>

                <div class="image-tags-preview">${tagsHtml}</div>

              </div>

            </div>

          </div>

          <div class="image-info-bar">

            <a href="#" class="file-path-link image-path-link" data-path="${image.path}">${image.path.split('/').pop()}</a>

            <span class="image-size">${image.size}</span>

            <span class="image-resolution">${image.resolution}</span>

          </div>

        </div>

      `;
      
      // 添加点击事件处理多选和详情打开
      imageCard.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        
        // 检查是否点击了选中指示器
        const isSelectionIndicator = target.classList.contains('image-selection-indicator') || 
                                    target.closest('.image-selection-indicator');
        
        // 如果按住Shift键点击，进行连续选择操作
        if (e.shiftKey && this.lastSelectedImageId) {
          e.preventDefault();
          e.stopPropagation(); // 阻止事件冒泡，防止打开详情
          
          // 获取所有图片卡片
          const allImageCards = Array.from(this.imageGrid.querySelectorAll('.image-card'));
          const currentIndex = allImageCards.indexOf(imageCard);
          const lastIndex = allImageCards.findIndex(card => 
            card.getAttribute('data-image-id') === this.lastSelectedImageId
          );
          
          if (lastIndex !== -1) {
            // 确定选择范围
            const startIndex = Math.min(currentIndex, lastIndex);
            const endIndex = Math.max(currentIndex, lastIndex);
            
            // 获取范围内的所有图片ID
            const rangeImageIds: string[] = [];
            for (let i = startIndex; i <= endIndex; i++) {
              const card = allImageCards[i] as HTMLElement;
              const id = card.dataset.imageId;
              if (id) rangeImageIds.push(id);
            }
            
            // 如果当前图片未选中，添加到选中列表
            if (!this.selectedImages.includes(image.id)) {
              // 添加范围内的所有图片到选中列表
              rangeImageIds.forEach(id => {
                if (!this.selectedImages.includes(id)) {
                  this.selectedImages.push(id);
                  const card = this.imageGrid.querySelector(`[data-image-id="${id}"]`) as HTMLElement;
                  if (card) {
                    card.addClass('selected');
                    // 更新选中指示器
                    const indicator = card.querySelector('.image-selection-indicator');
                    if (indicator) indicator.addClass('selected');
                  }
                }
              });
            } else {
              // 如果当前图片已选中，从选中列表中移除范围内的所有图片
              rangeImageIds.forEach(id => {
                const index = this.selectedImages.indexOf(id);
                if (index !== -1) {
                  this.selectedImages.splice(index, 1);
                  const card = this.imageGrid.querySelector(`[data-image-id="${id}"]`) as HTMLElement;
                  if (card) {
                    card.removeClass('selected');
                    // 更新选中指示器
                    const indicator = card.querySelector('.image-selection-indicator');
                    if (indicator) indicator.removeClass('selected');
                  }
                }
              });
            }
            
            // 更新最后选中的图片
            this.lastSelectedImageId = image.id;
          }
        }
        // 如果按住Ctrl或Cmd键点击，进行多选操作
        else if (e.ctrlKey || e.metaKey || isSelectionIndicator) {
          e.preventDefault();
          e.stopPropagation(); // 阻止事件冒泡，防止打开详情
          // 切换选中状态
          const index = this.selectedImages.indexOf(image.id);
          if (index > -1) {
            // 如果已选中，则取消选中
            this.selectedImages.splice(index, 1);
            imageCard.removeClass('selected');
            // 更新选中指示器
            const indicator = imageCard.querySelector('.image-selection-indicator');
            if (indicator) indicator.removeClass('selected');
          } else {
            // 如果未选中，则添加到选中列表
            this.selectedImages.push(image.id);
            imageCard.addClass('selected');
            // 更新选中指示器
            const indicator = imageCard.querySelector('.image-selection-indicator');
            if (indicator) indicator.addClass('selected');
          }
          
          // 更新最后选中的图片
          this.lastSelectedImageId = image.id;
          
          // 更新批量操作工具栏
          this.updateBatchOperationToolbar();
          return;
        }
        
        // 如果点击的是路径链接，则打开文件而不是详情
        if (target.classList.contains('file-path-link') || target.classList.contains('image-path-link')) {
          e.preventDefault();
          const path = target.getAttribute('data-path') || image.path;
          this.openImageFile(path);
        } else if (target.classList.contains('image-tag')) {
          // 如果点击的是标签，则不打开详情
          e.stopPropagation();
        } else {
          // 如果没有按Ctrl/Shift键且没有点击标签，则打开详情
          // 但如果当前有选中的图片，先清除选中状态
          if (this.selectedImages.length > 0) {
            this.clearImageSelection();
          }
          this.openImageDetail(image);
        }
      });
      
      // 右键点击用于选择图片（在上下文菜单显示之前）
      imageCard.addEventListener('contextmenu', (e) => {
        // 如果图片未被选中，将其添加到选中列表
        if (!this.selectedImages.includes(image.id)) {
          // 清除之前的选中状态
          this.clearImageSelection();
          // 选中当前图片
          this.selectedImages.push(image.id);
          imageCard.addClass('selected');
          this.updateBatchOperationToolbar();
        }
      });
    });
    
    // 更新统计信息
    this.updateStats();
    
    // 更新热门标签
    this.updatePopularTags();
    
    // 更新批量操作工具栏
    this.updateBatchOperationToolbar();
  }
  
  

  private getTagColorIndex(tag: string): number {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
      const char = tag.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash) % 8;
  }

  private updateStats() {
    const allImages = this.imageDataManager.getAllImageData();
    const totalImages = allImages.length;
    
    // 计算标签总数
    const allTags = new Set<string>();
    allImages.forEach(image => {
      image.tags.forEach(tag => allTags.add(tag));
    });
    const totalTags = allTags.size;
    
    // 计算分类总数（排除"全部图片"分类）
    const totalCategories = this.categories.filter(cat => cat !== '全部图片').length;
    
    // 更新统计显示
    const totalImagesEl = this.containerEl.querySelector('#total-images');
    const totalTagsEl = this.containerEl.querySelector('#total-tags');
    const totalCategoriesEl = this.containerEl.querySelector('#total-categories-stat');
    
    if (totalImagesEl) totalImagesEl.setText(totalImages.toString());
    if (totalTagsEl) totalTagsEl.setText(totalTags.toString());
    if (totalCategoriesEl) totalCategoriesEl.setText(totalCategories.toString());
  }

  private toggleTagSelection(tag: string) {

    const index = this.selectedTags.indexOf(tag);

    if (index > -1) {

      // 如果标签已选中，则取消选择

      this.selectedTags.splice(index, 1);

    } else {

      // 如果标签未选中，则添加到选择列表

      this.selectedTags.push(tag);

    }

    

    // 更新搜索框内容以反映当前选择的标签

    const searchInput = this.containerEl.querySelector('.gallery-search-input') as HTMLInputElement;

    if (searchInput) {

      if (this.selectedTags.length > 0) {

        searchInput.value = this.selectedTags.join(', ');

        this.currentFilter = this.selectedTags.join(', ');

      } else {

        searchInput.value = '';

        this.currentFilter = '';

      }

    }

    

    this.renderImages();

    this.updatePopularTags(); // 重新渲染热门标签以更新选中状态

  }

  

  private updateSelectedTagsDisplay() {

    const selectedTagsList = this.containerEl.querySelector('.selected-tags-list');

    if (!selectedTagsList) return;

    

    selectedTagsList.empty();

    

    this.selectedTags.forEach(tag => {

      const tagElement = selectedTagsList.createEl('span', {

        cls: 'selected-tag-item',

        text: tag

      });

      

      const removeBtn = tagElement.createEl('span', {

        cls: 'remove-selected-tag',

        text: '×'

      });

      

      removeBtn.addEventListener('click', (e) => {

        e.stopPropagation();

        this.removeSelectedTag(tag);

      });

    });

    

    // 如果没有选中的标签，显示提示

    if (this.selectedTags.length === 0) {

      selectedTagsList.createEl('span', {

        cls: 'no-selected-tags',

        text: '未选择标签'

      });

    }

  }

  

  private removeSelectedTag(tag: string) {

    const index = this.selectedTags.indexOf(tag);

    if (index > -1) {

      this.selectedTags.splice(index, 1);

    }

    

    // 更新搜索框内容

    const searchInput = this.containerEl.querySelector('.gallery-search-input') as HTMLInputElement;

    if (searchInput) {

      if (this.selectedTags.length > 0) {

        searchInput.value = this.selectedTags.join(', ');

        this.currentFilter = this.selectedTags.join(', ');

      } else {

        searchInput.value = '';

        this.currentFilter = '';

      }

    }

    

    this.renderImages();

    this.updatePopularTags(); // 重新渲染热门标签以更新选中状态

  }



  private updatePopularTags() {

    const tagsContainer = this.containerEl.querySelector('.tags-cloud');

    if (!tagsContainer) return;

    

    tagsContainer.empty();

    

    // 获取热门标签

    const popularTags = this.imageDataManager.getPopularTags(10);

    

    popularTags.forEach(tagInfo => {

      const tagEl = tagsContainer.createEl('span', { 

        cls: `popular-tag-item ${this.selectedTags.includes(tagInfo.tag) ? 'selected' : ''}`,

        text: `${tagInfo.tag} (${tagInfo.count})`

      });

      

      tagEl.addEventListener('click', (e) => {

        e.stopPropagation(); // 防止事件冒泡

        this.toggleTagSelection(tagInfo.tag);

      });

    });

    

    // 如果热门标签为空，显示提示

    if (popularTags.length === 0) {

      tagsContainer.createEl('div', { 

        cls: 'no-popular-tags',

        text: '暂无标签数据'

      });

    }

    

    // 更新已选标签显示

    this.updateSelectedTagsDisplay();

  }

  private openImageDetail(image: MediaData) {
    // 创建模态框显示媒体详情
    const modal = this.containerEl.createEl('div', { cls: 'image-detail-modal' });
    
    // 使用安全的媒体路径

    const mediaPath = getSafeImagePath(this.app, image.path);
    
    // 根据媒体类型生成不同的预览元素
    let previewElement = '';
    if (image.type === 'image') {
      previewElement = `<img src="${mediaPath}" alt="${image.title}">`;
    } else if (image.type === 'video') {
      previewElement = `<video src="${mediaPath}" controls style="max-width: 100%; max-height: 70vh;"></video>`;
    } else if (image.type === 'audio') {
      previewElement = `<audio src="${mediaPath}" controls style="width: 100%;"></audio>`;
    } else {
      previewElement = `<img src="${mediaPath}" alt="${image.title}">`; // 默认作为图片处理
    }
    
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>${image.title}</h3>
          <span class="modal-close-btn">&times;</span>
        </div>
        <div class="modal-body">
          <div class="modal-image-preview">
            ${previewElement}
          </div>
          <div class="modal-image-info">
            <div class="info-section">
              <label>标题</label>
              <input type="text" class="title-input" value="${image.title}">
            </div>
            <div class="info-section">
              <label>描述</label>
              <textarea class="description-input">${image.description}</textarea>
            </div>
            <div class="info-section tags-section">
              <label>标签</label>
              <div class="current-tags">
                ${image.tags.map(tag => `<span class="current-tag">${tag} <span class="remove-tag" data-tag="${tag}">×</span></span>`).join('')}
              </div>
              <div class="add-tag-container">
                <input type="text" class="new-tag-input" placeholder="添加新标签...">
                <button class="add-tag-btn">添加</button>
              </div>
              <div class="recent-tags-section">
                <label>最近使用</label>
                <div class="recent-tags-list">
                  <!-- 最近使用的标签将在这里显示 -->
                </div>
              </div>
            </div>
            <div class="info-section file-info-section">

              <label>文件信息</label>

              <div class="file-info">

                <p><strong>路径:</strong> <a href="#" class="file-path-link" data-path="${image.path}">${image.path}</a></p>

                <p><strong>大小:</strong> ${image.size}</p>

                <p><strong>格式:</strong> ${image.format}</p>

                <p><strong>分辨率:</strong> ${image.resolution}</p>

                <p><strong>修改时间:</strong> ${new Date(image.lastModified).toLocaleString()}</p>

              </div>

            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-save-btn">保存</button>
          <button class="modal-cancel-btn">取消</button>
        </div>
      </div>
    `;
    
    // 添加事件处理
    const closeBtn = modal.querySelector('.modal-close-btn');
    const cancelBtn = modal.querySelector('.modal-cancel-btn');
    
    const closeModal = () => {
      modal.remove();
    };
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
    
    // 添加标签功能
    const addTagBtn = modal.querySelector('.add-tag-btn');
    const newTagInput = modal.querySelector('.new-tag-input') as HTMLInputElement;
    const currentTagsContainer = modal.querySelector('.current-tags');
    const recentTagsContainer = modal.querySelector('.recent-tags-list') as HTMLElement;
    const suggestionsContainer = modal.querySelector('.tag-suggestions-container') as HTMLElement;
    
    // 显示最近使用的标签
    const recentTags = this.imageDataManager.getRecentTags();
    if (recentTags.length > 0) {
      recentTags.forEach(tag => {
        const recentTagEl = document.createElement('span');
        recentTagEl.className = 'recent-tag-item';
        recentTagEl.textContent = tag;
        
        // 检查当前图片是否已包含此最近使用的标签，如果是，则标记为选中状态
        if (image.tags.includes(tag)) {
          recentTagEl.classList.add('selected');
        }
        
        recentTagEl.addEventListener('click', () => {
          if (!image.tags.includes(tag)) {
            // 添加标签
            image.tags.push(tag);
            
            // 更新当前标签显示
            const newTagEl = document.createElement('span');
            newTagEl.className = 'current-tag';
            newTagEl.innerHTML = `${tag} <span class="remove-tag" data-tag="${tag}">×</span>`;
            
            const removeBtn = newTagEl.querySelector('.remove-tag');
            removeBtn?.addEventListener('click', (e) => {
              const tagValue = (e.target as HTMLElement).dataset.tag;
              if (tagValue) {
                image.tags = image.tags.filter(t => t !== tagValue);
                newTagEl.remove();
                
                // 更新UI状态
                const allRecentTagEls = recentTagsContainer.querySelectorAll('.recent-tag-item');
                for (let i = 0; i < allRecentTagEls.length; i++) {
                  if (allRecentTagEls[i].textContent === tagValue) {
                    allRecentTagEls[i].classList.remove('selected');
                    break;
                  }
                }
              }
            });
            
            currentTagsContainer?.appendChild(newTagEl);
            
            // 更新UI状态
            recentTagEl.classList.add('selected');
          } else {
            // 移除标签
            image.tags = image.tags.filter(t => t !== tag);
            
            // 从当前标签显示中移除
            const currentTagEls = currentTagsContainer?.querySelectorAll('.current-tag') || [];
            for (let i = 0; i < currentTagEls.length; i++) {
              const currentTagEl = currentTagEls[i];
              const tagText = currentTagEl.textContent?.split('×')[0]?.trim();
              if (tagText === tag) {
                currentTagEl.remove();
                break;
              }
            }
            
            // 更新UI状态
            recentTagEl.classList.remove('selected');
          }
        });
        
        recentTagsContainer.appendChild(recentTagEl);
      });
    } else {
      const noRecentTagsEl = recentTagsContainer.createEl('span', { text: '暂无最近使用标签' });
      noRecentTagsEl.addClass('no-recent-tags');
    }
    
    const addTag = () => {
      if (newTagInput && newTagInput.value.trim()) {
        const newTag = newTagInput.value.trim();
        if (!image.tags.includes(newTag)) {
          image.tags.push(newTag);
          
          const newTagEl = document.createElement('span');
          newTagEl.className = 'current-tag';
          newTagEl.innerHTML = `${newTag} <span class="remove-tag" data-tag="${newTag}">×</span>`;
          
          const removeBtn = newTagEl.querySelector('.remove-tag');
          removeBtn?.addEventListener('click', (e) => {
            const tagValue = (e.target as HTMLElement).dataset.tag;
            if (tagValue) {
              image.tags = image.tags.filter(t => t !== tagValue);
              newTagEl.remove();
            }
          });
          
          currentTagsContainer?.appendChild(newTagEl);
        }
        newTagInput.value = '';
      }
    };
    
    addTagBtn?.addEventListener('click', addTag);
    
    newTagInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addTag();
      }
    });
    
    // 移除标签
    modal.querySelectorAll('.remove-tag').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tagValue = (e.target as HTMLElement).dataset.tag;
        if (tagValue) {
          image.tags = image.tags.filter(t => t !== tagValue);
          (e.target as HTMLElement).parentElement?.remove();
        }
      });
    });
    
    // 保存修改

    const saveBtn = modal.querySelector('.modal-save-btn');

    saveBtn?.addEventListener('click', async () => {

      // 更新图片数据

      const titleInput = modal.querySelector('.title-input') as HTMLInputElement;

      const descInput = modal.querySelector('.description-input') as HTMLTextAreaElement;

      

      if (titleInput) image.title = titleInput.value;

      if (descInput) image.description = descInput.value;

      

      // 更新最后修改时间

      image.date = new Date().toISOString();

      

      // 保存到数据管理器

      this.imageDataManager.addImageData(image);

      

      // 保存到文件

      const plugin = getImageTaggingPlugin(this.app);

      if (plugin) {

        await plugin.saveDataToFile();

      }

      

      new Notice(`已保存 ${image.title} 的信息`);

      closeModal();

      this.renderImages(); // 重新渲染

    });



    // 添加路径链接的点击事件

    modal.querySelectorAll('.file-path-link').forEach(link => {

      link.addEventListener('click', (e) => {

        e.preventDefault();

        const path = (e.target as HTMLElement).getAttribute('data-path');

        if (path) {

          this.openImageFile(path);

        }

      });

    });
  }



  private createCategoryElement(parent: HTMLElement, category: string, isActive: boolean): HTMLElement {

    const li = parent.createEl('li', { 

      cls: `category-item ${isActive ? 'active' : ''}`,

      text: category

    });

    

    // 为"全部图片"以外的分类添加删除按钮

    if (category !== '全部图片') {

      const deleteBtn = li.createEl('span', {

        cls: 'delete-category-btn',

        text: '×'

      });

      

      deleteBtn.addEventListener('click', (e) => {

        e.stopPropagation(); // 阻止点击事件冒泡到li元素

        this.deleteCategory(category, parent);

      });

    }

    

    return li;

  }



  private addNewCategory(input: HTMLInputElement, categoriesList: HTMLElement) {
    const newCategory = input.value.trim();
    if (!newCategory) return;
    
    // 检查分类是否已存在
    if (this.categories.includes(newCategory)) {
      new Notice(`分类 "${newCategory}" 已存在！`);
      return;
    }
    
    // 添加新分类到数组
    this.categories.push(newCategory);
    
    // 保存分类到插件设置
    this.saveCategories();

    // 创建新的分类元素
    const newCategoryElement = this.createCategoryElement(categoriesList, newCategory, false);
    newCategoryElement.addEventListener('click', () => {
      this.currentCategory = newCategory;
      // 移除所有活动状态
      categoriesList.querySelectorAll('.category-item').forEach(item => {
        item.removeClass('active');
      });
      // 添加当前活动状态
      newCategoryElement.addClass('active');
      this.renderImages();
    });
    
    // 清空输入框
    input.value = '';
    
    new Notice(`已添加分类 "${newCategory}"`);
  }

  private deleteCategory(category: string, categoriesList: HTMLElement) {
    // 确认删除
    if (confirm(`确定要删除分类 "${category}" 吗？`)) {
      // 从数组中移除分类
      this.categories = this.categories.filter(cat => cat !== category);
      
      // 保存分类到插件设置
      this.saveCategories();
      
      // 如果当前分类被删除，切换到"全部图片"
      if (this.currentCategory === category) {
        this.currentCategory = '全部图片';
        // 重新激活"全部图片"项
        categoriesList.querySelectorAll('.category-item').forEach(item => {
          item.removeClass('active');
        });
        const allImagesItem = Array.from(categoriesList.querySelectorAll('.category-item'))
          .find(item => item.getText() === '全部图片');
        if (allImagesItem) {
          allImagesItem.addClass('active');
        }
      }
      
      // 重新渲染分类列表
      this.renderCategoryList(categoriesList);
      this.renderImages(); // 重新渲染图片
      
      new Notice(`已删除分类 "${category}"`);
    }
  }

  private async saveCategories() {
    try {
      // 获取插件实例
      const plugin = getImageTaggingPlugin(this.app);
      if (plugin) {
        // 更新插件设置中的分类
        plugin.settings.categories = this.categories;
        // 保存设置
        await plugin.saveSettings();
      }
    } catch (error) {
      Logger.error('保存分类失败:', error);
    }
  }

  private renderCategoryList(categoriesList: HTMLElement) {
    // 清空现有分类列表
    categoriesList.empty();
    
    // 重新添加所有分类
    this.categories.forEach((category, index) => {
      const li = this.createCategoryElement(categoriesList, category, category === this.currentCategory);
      li.addEventListener('click', () => {
        this.currentCategory = category;
        // 移除所有活动状态
        categoriesList.querySelectorAll('.category-item').forEach(item => {
          item.removeClass('active');
        });
        // 添加当前活动状态
        li.addClass('active');
        this.renderImages();
      });
    });
  }

  private async openImageFile(path: string) {

    try {

      const file = this.app.vault.getAbstractFileByPath(path);

      if (file && file instanceof TFile) {

        const leaf = this.app.workspace.getLeaf(true);

        await leaf.openFile(file);

      } else {

        new Notice(`找不到文件: ${path}`);

      }

    } catch (error) {

      Logger.error('打开图片文件失败:', error);

      new Notice(`无法打开文件: ${path}`);

    }

  }
  
  /**
   * 更新所有图片预览容器的宽高比
   */
  private async updateImageAspectRatios() {
    const containers = this.containerEl.querySelectorAll('.image-preview-container[data-media-path]');
    
    // 并发处理所有容器，但限制并发数量
    const batchSize = 10;
    for (let i = 0; i < containers.length; i += batchSize) {
      const batch = Array.from(containers).slice(i, i + batchSize);
      await Promise.all(batch.map(container => this.updateContainerAspectRatio(container as HTMLElement)));
    }
  }
  
  // 清除图片选中状态
  private clearImageSelection() {
    this.selectedImages = [];
    this.lastSelectedImageId = null; // 同时清除最后选中的图片ID
    // 移除所有选中状态的图片卡片和选中指示器
    const selectedCards = this.containerEl.querySelectorAll('.image-card.selected');
    selectedCards.forEach(card => {
      card.removeClass('selected');
      // 同时移除选中指示器的选中状态
      const indicator = card.querySelector('.image-selection-indicator');
      if (indicator) indicator.removeClass('selected');
    });
    
    // 更新批量操作工具栏
    this.updateBatchOperationToolbar();
  }
  
  // 更新批量操作工具栏
  private updateBatchOperationToolbar() {
    // 检查容器元素是否已经创建和加载
    if (!this.containerEl) {
      return; // 如果容器元素还没准备好，则直接返回
    }
    
    try {
      // 查找或创建批量操作工具栏
      let batchToolbar = this.containerEl.querySelector('.batch-operation-toolbar');
      
      if (this.selectedImages.length > 0) {
        // 如果有选中的图片，显示批量操作工具栏
        if (!batchToolbar) {
          // 创建批量操作工具栏 - 添加到gallery-main的最后
          const galleryMain = this.containerEl.querySelector('.gallery-main');
          if (galleryMain) {
            batchToolbar = (galleryMain as HTMLElement).createEl('div', { cls: 'batch-operation-toolbar' });
          } else {
            // 最后手段：在容器中创建
            batchToolbar = this.containerEl.createEl('div', { cls: 'batch-operation-toolbar' });
          }
          
          // 添加工具栏内容
          batchToolbar.innerHTML = `
            <div class="batch-toolbar-content">
              <span class="batch-selection-info">已选中 ${this.selectedImages.length} 个项目</span>
              <div class="batch-operation-controls">
                <button class="batch-add-tag-btn">添加标签</button>
                <button class="batch-remove-tag-btn">删除标签</button>
                <button class="batch-clear-selection">清除选择</button>
              </div>
            </div>
          `;
          
          // 添加事件监听器
          const addTagBtn = batchToolbar.querySelector('.batch-add-tag-btn');
          const removeTagBtn = batchToolbar.querySelector('.batch-remove-tag-btn');
          const clearSelectionBtn = batchToolbar.querySelector('.batch-clear-selection');
          
          if (addTagBtn) {
            addTagBtn.addEventListener('click', () => this.showBatchTagModal('add'));
          }
          
          if (removeTagBtn) {
            removeTagBtn.addEventListener('click', () => this.showBatchTagModal('remove'));
          }
          
          if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', () => {
              this.clearImageSelection();
            });
          }
        } else {
          // 如果工具栏已存在，更新选中信息
          const selectionInfo = batchToolbar.querySelector('.batch-selection-info');
          if (selectionInfo) {
            selectionInfo.textContent = `已选中 ${this.selectedImages.length} 个项目`;
          }
        }
        
        // 显示工具栏
        batchToolbar.removeClass('hidden');
      } else {
        // 如果没有选中的图片，隐藏批量操作工具栏
        if (batchToolbar) {
          batchToolbar.addClass('hidden');
        }
    }
  }
  
  // 显示批量标签操作模态框
  private showBatchTagModal(operation: 'add' | 'remove') {
    // 创建模态框
    const modal = this.containerEl.createEl('div', { cls: 'batch-tag-modal' });
    
    const operationText = operation === 'add' ? '添加' : '删除';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>批量${operationText}标签</h3>
          <span class="modal-close-btn">&times;</span>
        </div>
        <div class="modal-body">
          <div class="batch-tag-operation">
            <p>选中的项目: ${this.selectedImages.length} 个</p>
            <div class="tag-input-section">
              <label for="batch-tag-input">${operationText}标签:</label>
              <input type="text" id="batch-tag-input" class="batch-tag-input" placeholder="输入标签，多个标签用逗号分隔">
              <div class="recent-tags-section">
                <label>热门标签:</label>
                <div class="recent-tags-list" id="batch-recent-tags-list"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-cancel-btn">取消</button>
          <button class="modal-confirm-btn">${operationText}</button>
        </div>
      </div>
    `;
    
    // 添加事件监听器
    const closeBtn = modal.querySelector('.modal-close-btn');
    const cancelBtn = modal.querySelector('.modal-cancel-btn');
    const confirmBtn = modal.querySelector('.modal-confirm-btn');
    const tagInput = modal.querySelector('.batch-tag-input') as HTMLInputElement;
    const recentTagsContainer = modal.querySelector('#batch-recent-tags-list') as HTMLElement;
    
    // 填充热门标签
    if (recentTagsContainer) {
      const popularTags = this.imageDataManager.getPopularTags(10);
      if (popularTags.length > 0) {
        popularTags.forEach(tagInfo => {
          const tagEl = recentTagsContainer.createEl('span', { 
            cls: 'popular-tag-item',
            text: tagInfo.tag
          });
          
          tagEl.addEventListener('click', () => {
            if (tagInput.value) {
              tagInput.value += `, ${tagInfo.tag}`;
            } else {
              tagInput.value = tagInfo.tag;
            }
          });
        });
      } else {
        recentTagsContainer.createEl('span', { 
          cls: 'no-popular-tags',
          text: '暂无热门标签'
        });
      }
    }
    
    const closeModal = () => {
      modal.remove();
    };
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    modal.querySelector('.modal-backdrop')?.addEventListener('click', closeModal);
    
    // 确认按钮事件
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        if (tagInput && tagInput.value.trim()) {
          const tags = tagInput.value.split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);
          
          if (tags.length > 0) {
            if (operation === 'add') {
              await this.batchAddTags(tags);
            } else {
              await this.batchRemoveTags(tags);
            }
            closeModal();
            new Notice(`已${operationText}标签到 ${this.selectedImages.length} 个图片`);
            this.renderImages(); // 重新渲染以显示更改
          }
        } else {
          new Notice('请输入标签');
        }
      });
    }
  }
  
  // 批量添加标签
  private async batchAddTags(tags: string[]) {
    for (const imageId of this.selectedImages) {
      const imageData = this.imageDataManager.getImageData(imageId);
      if (imageData) {
        // 添加新标签，避免重复
        for (const tag of tags) {
          if (!imageData.tags.includes(tag)) {
            imageData.tags.push(tag);
          }
        }
        // 更新数据
        this.imageDataManager.addImageData(imageData);
      }
    }
    
    // 保存数据
    const plugin = getImageTaggingPlugin(this.app);
    if (plugin) {
      await plugin.saveDataToFile();
    }
  }
  
  // 批量删除标签
  private async batchRemoveTags(tags: string[]) {
    for (const imageId of this.selectedImages) {
      const imageData = this.imageDataManager.getImageData(imageId);
      if (imageData) {
        // 删除指定标签
        imageData.tags = imageData.tags.filter(tag => !tags.includes(tag));
        // 更新数据
        this.imageDataManager.addImageData(imageData);
      }
    }
    
    // 保存数据
    const plugin = getImageTaggingPlugin(this.app);
    if (plugin) {
      await plugin.saveDataToFile();
    }
  }
  
  /**
   * 更新单个图片预览容器的宽高比
   */
  private async updateContainerAspectRatio(container: HTMLElement) {
    try {
      const mediaPath = container.dataset.mediaPath;
      if (!mediaPath || !mediaPath.startsWith('app://')) return;
      
      // 从app://路径中提取实际文件路径
      const actualPath = mediaPath.replace(/.*app:\/\/\+\/\w+\//, '').split('?')[0];
      const file = this.app.vault.getAbstractFileByPath(actualPath);
      
      if (file && file instanceof TFile && file.extension.match(/^(jpg|jpeg|png|gif|bmp|webp|svg)$/)) {
        // 创建临时图片对象以获取尺寸
        const img = new Image();
        img.src = mediaPath;
        
        // 设置一个合理的超时时间
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout getting image dimensions')), 5000);
        });
        
        const dimensionPromise = new Promise<{width: number, height: number}>((resolve, reject) => {
          img.onload = () => {
            resolve({ width: img.naturalWidth, height: img.naturalHeight });
          };
          img.onerror = () => {
            reject(new Error('Failed to load image for dimension calculation'));
          };
        });
        
        // 获取图片尺寸，带超时保护
        const { width, height } = await Promise.race([dimensionPromise, timeoutPromise]) as {width: number, height: number};
        
        if (width > 0 && height > 0) {
          // 计算宽高比并转换为百分比
          const aspectRatio = (height / width) * 100;
          container.style.setProperty('--aspect-ratio', `${aspectRatio}%`);
        }
      }
    } catch (error) {
      // 出错时忽略，保持默认宽高比
      Logger.warn(`无法获取图片尺寸:`, error);
    }
  }
}