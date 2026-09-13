import { ItemView, WorkspaceLeaf, Notice, TFile, App, Modal } from 'obsidian';
import { MediaData, ImageTaggingSettings, ImageDataManager } from '../models/image-data-model';
import { getImageTaggingPlugin, getSafeImagePath } from '../utils/utils';
import { Logger } from '../utils/logger';
import { GALLERY_VIEW_TYPE } from '../constants';
import { resolveScanFolderPaths, isFileInFolderPaths } from '../utils/folders';
import { confirmWithModal } from './suggest-modals';

// 图库视图类

export class GalleryView extends ItemView {

  settings: ImageTaggingSettings;

  imageDataManager: ImageDataManager;

  currentFilter: string = '';



  currentCategory: string = '全部媒体';



  categories: string[] = [];

  

  selectedTags: string[] = []; // 存储当前选择的标签

  selectedImages: string[] = []; // 存储当前选中的图片ID
  
  lastSelectedImageId: string | null = null; // 存储最后选中的图片ID，用于Shift连续选择

  // 分页状态
  currentPage: number = 1;
  pageSize: number = 60;
  totalResults: number = 0;
  totalPages: number = 1;
  filteredImages: MediaData[] = []; // 过滤+排序后的全部结果，用于分页切片
  private paginationEl: HTMLElement | null = null;
  private searchDebounceTimer: number | null = null;



  constructor(leaf: WorkspaceLeaf, settings: ImageTaggingSettings, imageDataManager: ImageDataManager) {

    super(leaf);

    this.settings = settings;

    this.imageDataManager = imageDataManager;
    
    // 从设置中加载分类导航
    this.categories = [...(settings.categories || ['全部媒体', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术'])];
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
  }

  async initialize() {
    if (this.imageGrid) return;

    this.containerEl.empty();
    this.createView();
    const plugin = getImageTaggingPlugin(this.app);
    if (plugin?.dataReady) {
      await plugin.dataReady;
    }
    await this.refreshGallery();
  }

  async onClose() {
    // 清理防抖定时器，避免视图关闭后仍触发渲染
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
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

      const li = this.createCategoryElement(categoriesList, category, category === '全部媒体');

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
    
    const totalMediaStat = statsContainer.createEl('div', { cls: 'stat-item' });
    totalMediaStat.createEl('div', { cls: 'stat-value', attr: { id: 'total-media' }, text: '0' });
    totalMediaStat.createEl('div', { cls: 'stat-label', text: '总媒体数' });
    const totalTagsStat = statsContainer.createEl('div', { cls: 'stat-item' });
    totalTagsStat.createEl('div', { cls: 'stat-value', attr: { id: 'total-tags' }, text: '0' });
    totalTagsStat.createEl('div', { cls: 'stat-label', text: '标签总数' });
    const totalCategoriesStat = statsContainer.createEl('div', { cls: 'stat-item' });
    totalCategoriesStat.createEl('div', { cls: 'stat-value', attr: { id: 'total-categories-stat' }, text: '0' });
    totalCategoriesStat.createEl('div', { cls: 'stat-label', text: '分类数' });
    
    // 右侧主内容区
    const mainContent = contentContainer.createEl('div', { cls: 'gallery-main' });
    
    // 工具栏
    const toolbar = mainContent.createEl('div', { cls: 'gallery-toolbar' });
    toolbar.createEl('h3', { text: '图片图库' });
    
    const toolbarControls = toolbar.createEl('div', { cls: 'toolbar-controls' });
    
    // 排序下拉菜单
    const sortContainer = toolbarControls.createEl('div', { cls: 'sort-container' });
    const sortSelect = sortContainer.createEl('select', { cls: 'sort-select' });
    [
      ['date', '按时间'],
      ['name', '按名称'],
      ['size', '按大小'],
      ['tags', '按标签数']
    ].forEach(([value, text]) => sortSelect.createEl('option', { text, attr: { value } }));
    
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

    // 分页控件栏（固定在网格下方）
    this.paginationEl = mainContent.createEl('div', { cls: 'gallery-pagination' });
    
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

        this.debouncedRenderImages();

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

  private imageGrid!: HTMLElement;

  private async refreshData() {
    // 从插件实例获取最新数据
    const plugin = getImageTaggingPlugin(this.app);
    
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
    // 等待插件数据就绪，避免在数据尚未从存储加载完成时扫描，导致误建空记录覆盖旧数据
    const readyPlugin = getImageTaggingPlugin(this.app);
    if (readyPlugin?.dataReady) {
      await readyPlugin.dataReady;
    }

    // 尝试获取插件实例（插件实例由 getImageTaggingPlugin 统一解析，含 id 兼容）
    const plugin = getImageTaggingPlugin(this.app);
    
    if (!plugin) {
      new Notice('无法获取插件实例，刷新失败');
      console.error('Failed to get plugin instance in refreshGallery');
      return;
    }

    // 确保使用插件实例的数据管理器
    const imageDataManager = plugin.imageDataManager;
    this.imageDataManager = imageDataManager;

    // 先扫描：让改名 / 移动后的新文件按内容 MD5 继承残留记录（id / 标签 / 描述），
    // 再清理真正失效的记录，避免“先删后建”导致原标签丢失。
    await this.scanImagesBasedOnSettings();

    // 清理无效媒体数据（删除仍不存在或不在指定扫描路径内的媒体记录）
    const removedData = imageDataManager.cleanupInvalidImages(this.app, this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);

    // 确保在扫描后再次使用插件实例的数据管理器
    this.imageDataManager = plugin.imageDataManager;

    // 直接通过插件实例保存数据，确保保存的是最新数据
    await plugin.saveDataToFile();

    // 重新渲染
    this.renderImages();

    if (removedData.length > 0) {
      new DeletedMediaModal(this.app, removedData).open();
    }

    // 获取最终的媒体计数用于通知
    const finalCount = imageDataManager.getAllImageData().length;
    new Notice(`图库已刷新，清理了 ${removedData.length} 个无效媒体记录，当前共有 ${finalCount} 个媒体项目`);
  }

  private async scanImagesBasedOnSettings() {

    // 获取插件实例
    const plugin = getImageTaggingPlugin(this.app);
    
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

    // 解析扫描目录：优先多目录设置，回退到旧单目录；为空表示扫描整个库
    const folderPathsToUse = resolveScanFolderPaths(this.settings.scanFolderPath, this.settings.scanMultipleFolderPaths);

    // 如果设置了扫描文件夹路径，则只扫描这些文件夹中的文件
    if (folderPathsToUse.length > 0) {
      allFiles = allFiles.filter(file => isFileInFolderPaths(file.path, folderPathsToUse));
    }

    let mediaCount = 0;

    // 获取当前支持的媒体格式
    const supportedFormats = this.settings.supportedFormats || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'mp4', 'avi', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'flac', 'aac', 'ogg'];

    for (const file of allFiles) {
      // 检查是否为支持的媒体格式
      if (supportedFormats.includes(file.extension.toLowerCase())) {
        const existingData = imageDataManager.getImageDataByPath(file.path);
        if (!existingData) {
          // 交由插件统一逻辑处理：新建（id=内容 MD5）或按内容继承改名/移动后的原记录；
          // 若同内容已有其它现存文件登记则视为重复拷贝不建记录 —— 同内容数据直接合并。
          const ensured = await plugin.ensureImageDataForFile(file);
          if (ensured) {
            mediaCount++;
          }
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

  private loadData() {
    // 从数据管理器加载数据
    this.renderImages();
  }

  private renderImages(resetToFirst: boolean = true) {
    if (!this.imageGrid) return;

    // 结果集发生变化时回到第一页（纯翻页请传 false，见 goToPage）
    if (resetToFirst) {
      this.currentPage = 1;
    }
    
    // 获取所有图片数据
    let images = this.imageDataManager.getAllImageData();
    
    // 过滤掉路径无效的图片
    images = images.filter(image => image.path);
    
    // 应用分类过滤
    if (this.currentCategory && this.currentCategory !== '全部媒体') {
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
    const sortBy = sortSelect ? sortSelect.value : 'data';
    
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
    
    // 缓存并统计当前过滤结果
    this.filteredImages = images;
    this.totalResults = images.length;
    this.totalPages = Math.max(1, Math.ceil(images.length / this.pageSize));

    // 校正当前页范围
    if (this.currentPage > this.totalPages) this.currentPage = this.totalPages;
    if (this.currentPage < 1) this.currentPage = 1;

    // 仅渲染当前页的图片，避免一次性渲染全部导致大图库卡顿
    const start = (this.currentPage - 1) * this.pageSize;
    const pageImages = images.slice(start, start + this.pageSize);

    // 更新分页控件
    this.renderPagination();

    // 清空网格
    this.imageGrid.empty();
    
    // 渲染当前页图片
    pageImages.forEach(image => {
      // 验证图片路径有效
      if (!image.path) return;
      
      const imageCard = this.imageGrid.createEl('div', { cls: 'image-card' });
      imageCard.dataset.imageId = image.id;
      
      // 使用安全的媒体路径获取方法
      const mediaPath = getSafeImagePath(this.app, image.path);

      // 检查图片是否被选中
      const isSelected = this.selectedImages.includes(image.id);
      if (isSelected) {
        imageCard.addClass('selected');
      }

      const cardInner = imageCard.createEl('div', { cls: 'image-card-inner' });
      const previewContainer = cardInner.createEl('div', {
        cls: 'image-preview-container',
        attr: { 'data-media-path': mediaPath }
      });
      const previewClass = 'image-preview';
      if (image.type === 'video') {
        const video = previewContainer.createEl('video', { cls: previewClass, attr: { src: mediaPath, preload: 'metadata' } });
        video.controls = true;
      } else if (image.type === 'audio') {
        const audio = previewContainer.createEl('audio', { cls: previewClass, attr: { src: mediaPath, preload: 'metadata' } });
        audio.controls = true;
      } else {
        previewContainer.createEl('img', {
          cls: previewClass,
          attr: { src: mediaPath, alt: image.title, loading: 'lazy', decoding: 'async' }
        });
      }

      const selectionIndicator = previewContainer.createEl('div', { cls: 'image-selection-indicator' });
      if (isSelected) selectionIndicator.addClass('selected');
      selectionIndicator.createEl('span', { cls: 'image-selection-check', text: '✓' });

      const overlay = previewContainer.createEl('div', { cls: 'image-overlay' });
      const overlayContent = overlay.createEl('div', { cls: 'image-overlay-content' });
      overlayContent.createEl('h4', { cls: 'image-title', text: image.title });
      const tagsContainer = overlayContent.createEl('div', { cls: 'image-tags-preview' });
      const colors = ['blue', 'green', 'purple', 'yellow', 'red', 'pink', 'indigo', 'teal'];
      image.tags.slice(0, 3).forEach(tag => {
        const tagEl = tagsContainer.createEl('span', { cls: 'image-tag', text: tag });
        tagEl.addClass(`tag-color-${colors[this.getTagColorIndex(tag)]}`);
      });
      if (image.tags.length > 3) {
        tagsContainer.createEl('span', { cls: 'image-tag tag-more', text: `+${image.tags.length - 3}` });
      }

      const infoBar = cardInner.createEl('div', { cls: 'image-info-bar' });
      const pathLink = infoBar.createEl('a', {
        cls: 'file-path-link image-path-link',
        text: image.path.split('/').pop() || image.path,
        attr: { href: '#', 'data-path': image.path }
      });
      infoBar.createEl('span', { cls: 'image-size', text: image.size });
      infoBar.createEl('span', {
        cls: 'image-resolution',
        text: `${image.type === 'image' ? '分辨率' : '时长'}: ${image.resolution}`
      });
      
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
    
    // 计算分类总数（排除"全部媒体"分类）
    const totalCategories = this.categories.filter(cat => cat !== '全部媒体').length;
    
    // 更新统计显示
    const totalMediaEl = this.containerEl.querySelector('#total-media');
    const totalTagsEl = this.containerEl.querySelector('#total-tags');
    const totalCategoriesEl = this.containerEl.querySelector('#total-categories-stat');
    
    if (totalMediaEl) totalMediaEl.setText(totalImages.toString());
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
    
    const backdrop = modal.createEl('div', { cls: 'modal-backdrop' });
    const modalContent = modal.createEl('div', { cls: 'modal-content' });
    const modalHeader = modalContent.createEl('div', { cls: 'modal-header' });
    modalHeader.createEl('h3', { text: image.title });
    modalHeader.createEl('span', { cls: 'modal-close-btn', text: '×' });
    const modalBody = modalContent.createEl('div', { cls: 'modal-body' });
    const previewContainer = modalBody.createEl('div', { cls: 'modal-image-preview' });
    if (image.type === 'video') {
      const video = previewContainer.createEl('video', { attr: { src: mediaPath } });
      video.controls = true;
      video.setCssStyles({ maxWidth: '100%', maxHeight: '70vh' });
    } else if (image.type === 'audio') {
      const audio = previewContainer.createEl('audio', { attr: { src: mediaPath } });
      audio.controls = true;
      audio.setCssStyles({ width: '100%' });
    } else {
      previewContainer.createEl('img', { attr: { src: mediaPath, alt: image.title } });
    }
    const modalImageInfo = modalBody.createEl('div', { cls: 'modal-image-info' });
    const titleSection = modalImageInfo.createEl('div', { cls: 'info-section' });
    titleSection.createEl('label', { text: '标题' });
    titleSection.createEl('input', { cls: 'title-input', attr: { type: 'text', value: image.title } });
    const descriptionSection = modalImageInfo.createEl('div', { cls: 'info-section' });
    descriptionSection.createEl('label', { text: '描述' });
    descriptionSection.createEl('textarea', { cls: 'description-input', text: image.description });
    const tagsSection = modalImageInfo.createEl('div', { cls: 'info-section tags-section' });
    tagsSection.createEl('label', { text: '标签' });
    const currentTags = tagsSection.createEl('div', { cls: 'current-tags' });
    image.tags.forEach(tag => {
      const currentTag = currentTags.createEl('span', { cls: 'current-tag' });
      currentTag.appendText(tag);
      currentTag.createEl('span', { cls: 'remove-tag', text: '×', attr: { 'data-tag': tag } });
    });
    const addTagContainer = tagsSection.createEl('div', { cls: 'add-tag-container' });
    addTagContainer.createEl('input', { cls: 'new-tag-input', attr: { type: 'text', placeholder: '添加新标签...' } });
    addTagContainer.createEl('button', { cls: 'add-tag-btn', text: '添加' });
    const recentSection = tagsSection.createEl('div', { cls: 'recent-tags-section' });
    recentSection.createEl('label', { text: '最近使用' });
    recentSection.createEl('div', { cls: 'recent-tags-list' });
    const fileInfoSection = modalImageInfo.createEl('div', { cls: 'info-section file-info-section' });
    fileInfoSection.createEl('label', { text: '文件信息' });
    const fileInfo = fileInfoSection.createEl('div', { cls: 'file-info' });
    const pathRow = fileInfo.createEl('p');
    pathRow.createEl('strong', { text: '路径:' });
    pathRow.createEl('a', { cls: 'file-path-link', text: image.path, attr: { href: '#', 'data-path': image.path } });
    const sizeRow = fileInfo.createEl('p');
    sizeRow.createEl('strong', { text: '大小:' });
    sizeRow.appendText(` ${image.size}`);
    const formatRow = fileInfo.createEl('p');
    formatRow.createEl('strong', { text: '格式:' });
    formatRow.appendText(` ${image.format}`);
    const resolutionRow = fileInfo.createEl('p');
    resolutionRow.createEl('strong', { text: `${image.type === 'image' ? '分辨率' : '时长'}:` });
    resolutionRow.appendText(` ${image.resolution}`);
    const modifiedRow = fileInfo.createEl('p');
    modifiedRow.createEl('strong', { text: '修改时间:' });
    modifiedRow.appendText(` ${new Date(image.lastModified).toLocaleString()}`);
    const modalFooter = modalContent.createEl('div', { cls: 'modal-footer' });
    modalFooter.createEl('button', { cls: 'modal-save-btn', text: '保存' });
    modalFooter.createEl('button', { cls: 'modal-cancel-btn', text: '取消' });
    
    // 添加事件处理
    const closeBtn = modal.querySelector('.modal-close-btn');
    const cancelBtn = modal.querySelector('.modal-cancel-btn');
    
    const closeModal = () => {
      modal.remove();
    };
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    
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
        const recentTagEl = recentTagsContainer.createEl('span', { cls: 'recent-tag-item', text: tag });
        
        // 检查当前图片是否已包含此最近使用的标签，如果是，则标记为选中状态
        if (image.tags.includes(tag)) {
          recentTagEl.classList.add('selected');
        }
        
        recentTagEl.addEventListener('click', () => {
          if (!image.tags.includes(tag)) {
            // 添加标签
            image.tags.push(tag);
            
            // 更新当前标签显示
            const newTagEl = currentTagsContainer?.createEl('span', { cls: 'current-tag' });
            if (!newTagEl) return;
            newTagEl.appendText(tag);
            const removeTagEl = newTagEl.createEl('span', { cls: 'remove-tag', text: '×', attr: { 'data-tag': tag } });
            
            removeTagEl.addEventListener('click', (e) => {
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
          
          const newTagEl = currentTagsContainer?.createEl('span', { cls: 'current-tag' });
          if (!newTagEl) return;
          newTagEl.appendText(newTag);
          const removeTagEl = newTagEl.createEl('span', { cls: 'remove-tag', text: '×', attr: { 'data-tag': newTag } });
          
          removeTagEl.addEventListener('click', (e) => {
            const tagValue = (e.target as HTMLElement).dataset.tag;
            if (tagValue) {
              image.tags = image.tags.filter(t => t !== tagValue);
              newTagEl.remove();
            }
          });
          
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

      this.renderImages(false); // 重新渲染（保留当前页，不跳回第一页）

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

    

    // 为"全部媒体"以外的分类添加删除按钮

    if (category !== '全部媒体') {

      const deleteBtn = li.createEl('span', {

        cls: 'delete-category-btn',

        text: '×'

      });

      

      deleteBtn.addEventListener('click', (e) => {

        e.stopPropagation(); // 阻止点击事件冒泡到li元素

        void this.deleteCategory(category, parent);

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

  private async deleteCategory(category: string, categoriesList: HTMLElement) {
    if (await confirmWithModal(this.app, `确定要删除分类 "${category}" 吗？`)) {
      // 从数组中移除分类
      this.categories = this.categories.filter(cat => cat !== category);
      
      // 保存分类到插件设置
      this.saveCategories();
      
      // 如果当前分类被删除，切换到"全部媒体"
      if (this.currentCategory === category) {
        this.currentCategory = '全部媒体';
        // 重新激活"全部媒体"项
        categoriesList.querySelectorAll('.category-item').forEach(item => {
          item.removeClass('active');
        });
        const allImagesItem = Array.from(categoriesList.querySelectorAll('.category-item'))
          .find(item => item.getText() === '全部媒体');
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
          const toolbarContent = batchToolbar.createEl('div', { cls: 'batch-toolbar-content' });
          toolbarContent.createEl('span', {
            cls: 'batch-selection-info',
            text: `已选中 ${this.selectedImages.length} 个项目`
          });
          const operationControls = toolbarContent.createEl('div', { cls: 'batch-operation-controls' });
          operationControls.createEl('button', { cls: 'batch-add-tag-btn', text: '添加标签' });
          operationControls.createEl('button', { cls: 'batch-remove-tag-btn', text: '删除标签' });
          operationControls.createEl('button', { cls: 'batch-clear-selection', text: '清除选择' });
          
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
    const backdrop = modal.createEl('div', { cls: 'modal-backdrop' });
    const modalContent = modal.createEl('div', { cls: 'modal-content' });
    const modalHeader = modalContent.createEl('div', { cls: 'modal-header' });
    modalHeader.createEl('h3', { text: `批量${operationText}标签` });
    modalHeader.createEl('span', { cls: 'modal-close-btn', text: '×' });
    const modalBody = modalContent.createEl('div', { cls: 'modal-body' });
    const operationContainer = modalBody.createEl('div', { cls: 'batch-tag-operation' });
    operationContainer.createEl('p', { text: `选中的项目: ${this.selectedImages.length} 个` });
    const tagInputSection = operationContainer.createEl('div', { cls: 'tag-input-section' });
    tagInputSection.createEl('label', { text: `${operationText}标签:`, attr: { for: 'batch-tag-input' } });
    tagInputSection.createEl('input', {
      cls: 'batch-tag-input',
      attr: { id: 'batch-tag-input', type: 'text', placeholder: '输入标签，多个标签用逗号分隔' }
    });
    const recentSection = tagInputSection.createEl('div', { cls: 'recent-tags-section' });
    recentSection.createEl('label', { text: '热门标签:' });
    recentSection.createEl('div', { cls: 'recent-tags-list', attr: { id: 'batch-recent-tags-list' } });
    const modalFooter = modalContent.createEl('div', { cls: 'modal-footer' });
    modalFooter.createEl('button', { cls: 'modal-cancel-btn', text: '取消' });
    modalFooter.createEl('button', { cls: 'modal-confirm-btn', text: operationText });
    
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
    backdrop.addEventListener('click', closeModal);
    
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
            this.renderImages(false); // 重新渲染以显示更改（保留当前页）
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
          window.setTimeout(() => reject(new Error('Timeout getting image dimensions')), 5000);
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

  // 跳转到指定页（只切换结果，不重置到第一页）
  private goToPage(page: number) {
    if (!this.filteredImages || this.filteredImages.length === 0) return;
    const target = Math.max(1, Math.min(this.totalPages, page));
    if (target === this.currentPage) return;
    this.currentPage = target;
    this.renderImages(false);
    const galleryGridContainer = this.containerEl.querySelector('.gallery-grid-container');
    if (galleryGridContainer instanceof HTMLElement) {
      galleryGridContainer.scrollTop = 0;
    }
  }

  // 渲染分页控件
  private renderPagination() {
    if (!this.paginationEl) return;

    const total = this.totalResults;
    const totalPages = this.totalPages;
    const cur = Math.max(1, Math.min(this.totalPages, this.currentPage));

    const pageButtons: Array<number | 'ellipsis'> = [];
    if (totalPages <= 7) {
      for (let p = 1; p <= totalPages; p++) pageButtons.push(p);
    } else {
      const winStart = Math.max(1, cur - 2);
      const winEnd = Math.min(totalPages, cur + 2);
      if (winStart > 1) {
        pageButtons.push(1);
        if (winStart > 2) pageButtons.push('ellipsis');
      }
      for (let p = winStart; p <= winEnd; p++) pageButtons.push(p);
      if (winEnd < totalPages) {
        if (winEnd < totalPages - 1) pageButtons.push('ellipsis');
        pageButtons.push(totalPages);
      }
    }

    this.paginationEl.empty();
    if (total === 0) {
      this.paginationEl.createEl('span', { cls: 'pagination-info', text: '共 0 项' });
      return;
    }

    this.paginationEl.createEl('span', { cls: 'pagination-info', text: `共 ${total} 项 · 第 ${cur} / ${totalPages} 页` });
    const controls = this.paginationEl.createEl('div', { cls: 'pagination-controls' });
    const prevBtn = controls.createEl('button', { cls: 'pagination-btn pagination-prev', text: '‹', attr: { type: 'button' } });
    prevBtn.disabled = cur <= 1;
    prevBtn.addEventListener('click', () => this.goToPage(cur - 1));
    pageButtons.forEach(page => {
      if (page === 'ellipsis') {
        controls.createEl('span', { cls: 'pagination-ellipsis', text: '…' });
        return;
      }
      const pageButton = controls.createEl('button', {
        cls: `pagination-btn pagination-num${page === cur ? ' active' : ''}`,
        text: String(page),
        attr: { type: 'button', 'data-page': String(page) }
      });
      pageButton.addEventListener('click', () => this.goToPage(page));
    });
    const nextBtn = controls.createEl('button', { cls: 'pagination-btn pagination-next', text: '›', attr: { type: 'button' } });
    nextBtn.disabled = cur >= totalPages;
    nextBtn.addEventListener('click', () => this.goToPage(cur + 1));

    const sizeContainer = this.paginationEl.createEl('span', { cls: 'pagination-size' });
    sizeContainer.appendText('每页');
    const sizeSelect = sizeContainer.createEl('select', { cls: 'pagination-size-select' });
    [24, 60, 120].forEach(size => sizeSelect.createEl('option', {
      text: String(size),
      attr: { value: String(size) }
    }));
    sizeSelect.value = String(this.pageSize);
    sizeContainer.appendText(' 项');
    sizeSelect.addEventListener('change', () => {
      const v = parseInt(sizeSelect.value, 10);
      if (!isNaN(v) && v > 0) {
        this.pageSize = v;
        this.currentPage = 1;
        this.renderImages(false);
      }
    });
  }

  // 搜索输入防抖，避免每次按键都重建整个图库
  private debouncedRenderImages() {
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = window.setTimeout(() => {
      this.searchDebounceTimer = null;
      this.renderImages();
    }, 250);
  }
}

class DeletedMediaModal extends Modal {
  private readonly removedData: MediaData[];

  constructor(app: App, removedData: MediaData[]) {
    super(app);
    this.removedData = removedData;
  }

  onOpen() {
    this.titleEl.setText('已删除的媒体记录');
    this.contentEl.createEl('p', {
      text: `以下 ${this.removedData.length} 条记录因文件不存在或不在扫描目录内而被删除：`
    });

    const list = this.contentEl.createEl('ul');
    for (const mediaData of this.removedData) {
      list.createEl('li', { text: mediaData.path });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}