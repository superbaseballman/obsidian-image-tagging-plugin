import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ImageData, ImageDataManager } from './image-data-model';

// 右侧边栏视图类型ID
export const IMAGE_INFO_VIEW_TYPE = 'image-info-view';

export class ImageView extends ItemView {
  private imageDataManager: ImageDataManager;
  private currentFile: TFile | null = null;
  private imageInfoContainer: HTMLElement;

  constructor(leaf: WorkspaceLeaf, imageDataManager: ImageDataManager) {
    super(leaf);
    this.imageDataManager = imageDataManager;
  }

  getViewType(): string {
    return IMAGE_INFO_VIEW_TYPE;
  }

  getDisplayText(): string {
    return '图片信息';
  }

  getIcon(): string {
    return 'image';
  }

  async onOpen() {
    this.createView();
  }

  async onClose() {
    // 清理资源
  }

  private createView() {
    this.contentEl.empty();
    this.contentEl.addClass('image-info-panel');
    
    // 创建标题
    const header = this.contentEl.createEl('div', { cls: 'image-info-header' });
    header.createEl('h3', { text: '图片信息' });
    
    // 创建信息容器
    this.imageInfoContainer = this.contentEl.createEl('div', { cls: 'image-info-container' });
    
    // 初始化为空内容
    this.imageInfoContainer.createEl('div', { 
      cls: 'no-image-selected', 
      text: '在库中选择一个图片文件以查看详细信息' 
    });
  }

  // 更新视图以显示指定文件的信息
  async updateForFile(file: TFile | null) {
    this.currentFile = file;
    
    if (!file) {
      this.imageInfoContainer.empty();
      this.imageInfoContainer.createEl('div', { 
        cls: 'no-image-selected', 
        text: '在库中选择一个图片文件以查看详细信息' 
      });
      return;
    }

    // 获取或创建图片数据
    let imageData = this.imageDataManager.getImageDataByPath(file.path);
    
    if (!imageData) {
      // 如果没有找到数据，则创建默认数据
      imageData = {
        id: `img_${Date.now()}_${file.path || file.name}`,
        path: file.path || file.name || '',
        title: file.basename,
        tags: [],
        date: new Date().toISOString(),
        size: this.formatFileSize(file.size),
        resolution: '未知',
        format: file.extension.toUpperCase(),
        description: '',
        originalName: file.name,
        lastModified: file.stat.mtime
      };
      
      // 尝试获取图片尺寸
      try {
        const resolution = await this.getImageResolution(file);
        imageData.resolution = resolution;
      } catch (e) {
        console.log('无法获取图片分辨率:', e);
      }
      
      // 保存新创建的数据
      this.imageDataManager.addImageData(imageData);
    }

    // 渲染图片信息
    this.renderImageInfo(imageData);
  }

  private renderImageInfo(imageData: ImageData) {
    this.imageInfoContainer.empty();
    
    // 验证图片路径
    if (!imageData.path) {
      this.imageInfoContainer.createEl('div', { 
        cls: 'no-image-selected', 
        text: '图片路径无效' 
      });
      return;
    }
    
    // 图片预览
    const previewContainer = this.imageInfoContainer.createEl('div', { cls: 'image-preview-container' });
    const img = previewContainer.createEl('img', {
      cls: 'image-preview',
      attr: {
        src: this.getCorrectImagePath(imageData.path),
        alt: imageData.title
      }
    });
    
    // 图片基本信息
    const infoContainer = this.imageInfoContainer.createEl('div', { cls: 'image-details' });
    
    // 标题编辑
    const titleContainer = infoContainer.createEl('div', { cls: 'info-item' });
    titleContainer.createEl('label', { text: '标题' });
    const titleInput = titleContainer.createEl('input', {
      type: 'text',
      cls: 'title-input',
      value: imageData.title
    });
    
    // 描述编辑
    const descContainer = infoContainer.createEl('div', { cls: 'info-item' });
    descContainer.createEl('label', { text: '描述' });
    const descInput = descContainer.createEl('textarea', {
      cls: 'description-input',
      text: imageData.description
    });
    
    // 标签编辑
    const tagsContainer = infoContainer.createEl('div', { cls: 'info-item tags-section' });
    tagsContainer.createEl('label', { text: '标签' });
    
    const tagsList = tagsContainer.createEl('div', { cls: 'tags-list' });
    imageData.tags.forEach(tag => {
      this.createTagElement(tagsList, tag, imageData);
    });
    
    const tagInputContainer = tagsContainer.createEl('div', { cls: 'tag-input-container' });
    const tagInput = tagInputContainer.createEl('input', {
      type: 'text',
      cls: 'tag-input',
      placeholder: '添加标签...'
    });
    
    // 添加标签按钮
    const addTagBtn = tagInputContainer.createEl('button', {
      cls: 'add-tag-btn',
      text: '添加'
    });
    
    // 文件信息
    const fileInfoContainer = infoContainer.createEl('div', { cls: 'info-item file-info' });
    fileInfoContainer.createEl('label', { text: '文件信息' });
    
    const fileInfo = fileInfoContainer.createEl('div', { cls: 'file-properties' });
    fileInfo.createEl('p', { text: `路径: ${imageData.path}` });
    fileInfo.createEl('p', { text: `大小: ${imageData.size}` });
    fileInfo.createEl('p', { text: `格式: ${imageData.format}` });
    fileInfo.createEl('p', { text: `分辨率: ${imageData.resolution}` });
    fileInfo.createEl('p', { text: `修改时间: ${new Date(imageData.lastModified).toLocaleString()}` });
    
    // 保存按钮
    const saveBtn = infoContainer.createEl('button', {
      cls: 'save-info-btn',
      text: '保存更改'
    });
    
    // 事件处理
    addTagBtn.addEventListener('click', () => {
      this.addTag(tagInput, imageData, tagsList);
    });
    
    tagInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addTag(tagInput, imageData, tagsList);
      }
    });
    
    saveBtn.addEventListener('click', () => {
      this.saveImageInfo(imageData, titleInput, descInput);
    });
  }
  
  private getCorrectImagePath(path: string | undefined | null): string {
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

  private createTagElement(container: HTMLElement, tag: string, imageData: ImageData) {
    const tagEl = container.createEl('span', { cls: 'tag-item' });
    tagEl.setText(tag);
    
    const removeBtn = tagEl.createEl('span', { 
      cls: 'remove-tag', 
      text: '×' 
    });
    
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      imageData.tags = imageData.tags.filter(t => t !== tag);
      tagEl.remove();
    });
  }

  private addTag(input: HTMLInputElement, imageData: ImageData, container: HTMLElement) {
    const newTag = input.value.trim();
    if (!newTag) return;
    
    if (!imageData.tags.includes(newTag)) {
      imageData.tags.push(newTag);
      this.createTagElement(container, newTag, imageData);
      input.value = '';
    }
  }

  private async saveImageInfo(imageData: ImageData, titleInput: HTMLInputElement, descInput: HTMLTextAreaElement) {
    // 更新数据
    imageData.title = titleInput.value;
    imageData.description = descInput.value;
    imageData.date = new Date().toISOString();
    
    // 更新最后修改时间
    if (this.currentFile) {
      imageData.lastModified = this.currentFile.stat.mtime;
    }
    
    // 保存到数据管理器
    this.imageDataManager.addImageData(imageData);
    
    // 通知用户保存成功
    new Notice(`已保存 ${imageData.title} 的信息`);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private async getImageResolution(file: TFile): Promise<string> {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        const url = this.app.vault.getResourcePath(file.path);
        
        img.onload = () => {
          resolve(`${img.width}x${img.height}`);
        };
        
        img.onerror = () => {
          resolve('无法获取');
        };
        
        img.src = url;
      } catch (e) {
        resolve('无法获取');
      }
    });
  }
}