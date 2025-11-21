import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import { ImageData, ImageTaggingSettings, ImageDataManager } from './image-data-model';

// 图库视图类型ID
export const GALLERY_VIEW_TYPE = 'image-gallery-view';

// 图库视图类
export class GalleryView extends ItemView {
  settings: ImageTaggingSettings;
  imageDataManager: ImageDataManager;
  currentFilter: string = '';
  currentCategory: string = '全部图片';

  constructor(leaf: WorkspaceLeaf, settings: ImageTaggingSettings, imageDataManager: ImageDataManager) {
    super(leaf);
    this.settings = settings;
    this.imageDataManager = imageDataManager;
  }

  getViewType(): string {
    return GALLERY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '图片图库';
  }

  getIcon(): string {
    return 'gallery';
  }

  async onOpen() {
    this.containerEl.empty();
    this.createView();
    this.loadData();
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
    searchContainer.createEl('input', {
      cls: 'gallery-search-input',
      placeholder: '搜索图片或标签...',
      type: 'text'
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
    ['全部图片', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术'].forEach((category, index) => {
      const li = categoriesList.createEl('li', { 
        cls: `category-item ${index === 0 ? 'active' : ''}`,
        text: category
      });
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
    
    // 主要网格
    const gridContainer = mainContent.createEl('div', { cls: 'gallery-grid-container' });
    this.imageGrid = gridContainer.createEl('div', { cls: 'gallery-grid masonry-grid' });
    
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
    if (this.currentCategory !== '全部图片') {
      images = images.filter(image => 
        image.tags.includes(this.currentCategory) || 
        image.title.includes(this.currentCategory)
      );
    }
    
    // 应用搜索过滤
    if (this.currentFilter) {
      const filter = this.currentFilter.toLowerCase();
      images = images.filter(image => 
        image.title.toLowerCase().includes(filter) ||
        image.description.toLowerCase().includes(filter) ||
        image.tags.some(tag => tag.toLowerCase().includes(filter))
      );
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
      
      // 使用安全的图片路径获取方法
      const imagePath = this.getSafeImagePath(image.path);
      
      imageCard.innerHTML = `
        <div class="image-card-inner">
          <div class="image-preview-container">
            <img src="${imagePath}" alt="${image.title}" class="image-preview">
            <div class="image-overlay">
              <div class="image-overlay-content">
                <h4 class="image-title">${image.title}</h4>
                <div class="image-tags-preview">${tagsHtml}</div>
              </div>
            </div>
          </div>
          <div class="image-info-bar">
            <span class="image-size">${image.size}</span>
            <span class="image-resolution">${image.resolution}</span>
          </div>
        </div>
      `;
      
      // 添加点击事件打开详情
      imageCard.addEventListener('click', (e) => {
        // 如果点击的是标签，则不打开详情
        if (!(e.target as HTMLElement).classList.contains('image-tag')) {
          this.openImageDetail(image);
        }
      });
    });
    
    // 更新统计信息
    this.updateStats();
    
    // 更新热门标签
    this.updatePopularTags();
  }
  
  private getSafeImagePath(path: string | undefined | null): string {
    try {
      // 首先检查路径是否为 undefined 或 null
      if (!path) {
        // 如果路径为空、undefined 或 null，返回占位符
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
      }
      
      // 检查是否已经是 app:// 格式的 URL
      if (path.startsWith('app://')) {
        // 如果是 app:// 格式，直接使用它
        return path;
      }
      
      // 如果路径不包含完整路径（例如只包含文件名），尝试在 vault 中查找
      if (!path.includes('/') && !path.includes('\\')) {
        // 如果只有文件名，尝试在 vault 中查找匹配的文件
        const files = this.app.vault.getFiles();
        const matchingFile = files.find(file => file.name === path || file.basename + '.' + file.extension === path);
        if (matchingFile) {
          return this.app.vault.getResourcePath(matchingFile.path);
        }
      }
      
      // 检查文件是否存在再获取路径
      const abstractFile = this.app.vault.getAbstractFileByPath(path);
      if (!abstractFile) {
        // 如果文件不存在，返回占位符
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
      }
      
      // 否则使用 Obsidian 的 getResourcePath 方法获取正确的资源路径
      return this.app.vault.getResourcePath(path);
    } catch (e) {
      // 如果 getResourcePath 失败，返回一个默认的占位符图像
      console.warn(`无法获取图片路径: ${path}`, e);
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
    }
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
    
    // 更新统计显示
    const totalImagesEl = this.containerEl.querySelector('#total-images');
    const totalTagsEl = this.containerEl.querySelector('#total-tags');
    const totalCategoriesEl = this.containerEl.querySelector('#total-categories-stat');
    
    if (totalImagesEl) totalImagesEl.setText(totalImages.toString());
    if (totalTagsEl) totalTagsEl.setText(totalTags.toString());
    if (totalCategoriesEl) totalCategoriesEl.setText('8'); // 假设分类数为8
  }

  private updatePopularTags() {
    const tagsContainer = this.containerEl.querySelector('.tags-cloud');
    if (!tagsContainer) return;
    
    tagsContainer.empty();
    
    // 获取热门标签
    const popularTags = this.imageDataManager.getPopularTags(10);
    
    popularTags.forEach(tagInfo => {
      const tagEl = tagsContainer.createEl('span', { 
        cls: 'popular-tag-item',
        text: `${tagInfo.tag} (${tagInfo.count})`
      });
      
      tagEl.addEventListener('click', () => {
        this.currentFilter = tagInfo.tag.toLowerCase();
        // 清空搜索框
        const searchInput = this.containerEl.querySelector('.gallery-search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.value = tagInfo.tag;
        }
        this.renderImages();
      });
    });
    
    // 如果热门标签为空，显示提示
    if (popularTags.length === 0) {
      tagsContainer.createEl('div', { 
        cls: 'no-popular-tags',
        text: '暂无标签数据'
      });
    }
  }

  private openImageDetail(image: ImageData) {
    // 创建模态框显示图片详情
    const modal = this.containerEl.createEl('div', { cls: 'image-detail-modal' });
    
    // 使用安全的图片路径
    const imagePath = this.getSafeImagePath(image.path);
    
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>${image.title}</h3>
          <span class="modal-close-btn">&times;</span>
        </div>
        <div class="modal-body">
          <div class="modal-image-preview">
            <img src="${imagePath}" alt="${image.title}">
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
            </div>
            <div class="info-section file-info-section">
              <label>文件信息</label>
              <div class="file-info">
                <p><strong>路径:</strong> ${image.path}</p>
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
      const plugin = (this.app as any).plugins.plugins['image-tagging-obsidian'];
      if (plugin) {
        await plugin.saveDataToFile();
      }
      
      new Notice(`已保存 ${image.title} 的信息`);
      closeModal();
      this.renderImages(); // 重新渲染
    });
  }
}