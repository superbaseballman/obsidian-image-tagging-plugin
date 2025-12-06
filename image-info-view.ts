import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { ImageData, ImageDataManager } from './image-data-model';
import { getImageResolutionWithCache, getImageTaggingPlugin, getSafeImagePath } from './utils';

// 右侧边栏视图类型ID
export const IMAGE_INFO_VIEW_TYPE = 'image-info-view';

export class ImageView extends ItemView {
  private imageDataManager: ImageDataManager;
  private currentFile: TFile | null = null;
  private imageInfoContainer: HTMLElement;
  private settings: any;

  constructor(leaf: WorkspaceLeaf, imageDataManager: ImageDataManager, settings: any) {
    super(leaf);
    this.imageDataManager = imageDataManager;
    this.settings = settings;
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

  // 检查文件是否为支持的图片文件
  isSupportedImageFile(file: TFile): boolean {
    if (!file || !file.extension) return false;
    const extension = file.extension.toLowerCase();
    return this.settings.supportedFormats?.includes(extension) || false;
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
    
    // 如果没有文件或者文件不是支持的图片格式，则显示提示信息
    if (!file || !this.isSupportedImageFile(file)) {
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
        size: this.formatFileSize(file.stat.size),
        fileSize: file.stat.size, // 添加原始字节大小
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
        src: getSafeImagePath(this.app, imageData.path),
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
    // 创建可点击的路径链接
    const pathContainer = fileInfo.createEl('p');
    pathContainer.createEl('span', { text: '路径: ' });
    const pathLink = pathContainer.createEl('a', {
      text: imageData.path,
      cls: 'file-path-link'
    });
    pathLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.openImageFile(imageData.path);
    });
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
    
    // 保存到文件
    const plugin = getImageTaggingPlugin(this.app);
    if (plugin) {
      await plugin.saveDataToFile();
    }
    
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
    try {
      // 使用缓存的图片分辨率获取方法
      const dimensions = await getImageResolutionWithCache(file, this.app);
      if (dimensions) {
        return dimensions.resolution;
      }
      return '未知';
    } catch (e) {
      console.warn(`无法获取图片分辨率: ${file.path}`, e);
      return '未知';
    }
  }

  private async openImageFile(path: string) {
    try {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file && file instanceof TFile) {
        // 在新标签页中打开图片文件
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      } else {
        new Notice(`找不到文件: ${path}`);
      }
    } catch (error) {
  }
}
}