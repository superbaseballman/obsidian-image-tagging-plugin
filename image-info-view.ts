import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import { MediaData, ImageDataManager, getMediaType } from './image-data-model';
import { getImageResolutionWithCache, getImageTaggingPlugin, getSafeImagePath, deleteImageFile } from './utils';

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
    return '媒体信息';
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
    header.createEl('h3', { text: '媒体信息' });
    
    // 创建信息容器
    this.imageInfoContainer = this.contentEl.createEl('div', { cls: 'image-info-container' });
    
    // 初始化为空内容
    this.imageInfoContainer.createEl('div', { 
      cls: 'no-image-selected', 
      text: '在库中选择一个媒体文件以查看详细信息' 
    });
  }

  // 更新视图以显示指定文件的信息
  async updateForFile(file: TFile | null) {
    this.currentFile = file;
    
    // 如果没有文件或者文件不是支持的媒体格式，则显示提示信息
    if (!file || !this.isSupportedImageFile(file)) {
      this.imageInfoContainer.empty();
      this.imageInfoContainer.createEl('div', { 
        cls: 'no-image-selected', 
        text: '在库中选择一个媒体文件以查看详细信息' 
      });
      return;
    }

    // 获取或创建媒体数据
    let imageData = this.imageDataManager.getImageDataByPath(file.path);
    
    if (!imageData) {
      // 如果没有找到数据，则创建默认数据
      const mediaType = getMediaType(file) || 'image';
      imageData = {
        id: `media_${Date.now()}_${file.path || file.name}`,
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
        lastModified: file.stat.mtime,
        type: mediaType
      };
      
      // 尝试获取媒体信息
      try {
        if (mediaType === 'image') {
          const resolution = await this.getImageResolution(file);
          imageData.resolution = resolution;
        } else {
          // 对于视频和音频，暂时保持默认分辨率
          imageData.resolution = mediaType === 'video' ? '视频文件' : '音频文件';
        }
      } catch (e) {
        console.log('无法获取媒体信息:', e);
      }
      
      // 保存新创建的数据
      this.imageDataManager.addImageData(imageData);
    }

    // 渲染媒体信息
    this.renderImageInfo(imageData);
  }

  private renderImageInfo(imageData: MediaData) {
    this.imageInfoContainer.empty();
    
    // 验证媒体路径
    if (!imageData.path) {
      this.imageInfoContainer.createEl('div', { 
        cls: 'no-image-selected', 
        text: '媒体路径无效' 
      });
      return;
    }
    
    // 媒体预览
    const previewContainer = this.imageInfoContainer.createEl('div', { cls: 'image-preview-container' });
    
    // 根据媒体类型创建不同的预览元素
    if (imageData.type === 'image') {
      const img = previewContainer.createEl('img', {
        cls: 'image-preview',
        attr: {
          src: getSafeImagePath(this.app, imageData.path),
          alt: imageData.title
        }
      });
    } else if (imageData.type === 'video') {
      const video = previewContainer.createEl('video', {
        cls: 'image-preview',
        attr: {
          src: getSafeImagePath(this.app, imageData.path),
          controls: 'true'
        }
      });
    } else if (imageData.type === 'audio') {
      const audio = previewContainer.createEl('audio', {
        cls: 'image-preview',
        attr: {
          src: getSafeImagePath(this.app, imageData.path),
          controls: 'true'
        }
      });
    } else {
      // 默认作为图片处理
      const img = previewContainer.createEl('img', {
        cls: 'image-preview',
        attr: {
          src: getSafeImagePath(this.app, imageData.path),
          alt: imageData.title
        }
      });
    }
    
    // 媒体基本信息
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
    
    // 最近使用的标签部分
    const recentTagsContainer = tagsContainer.createEl('div', { cls: 'recent-tags-container' });
    const recentTagsLabel = recentTagsContainer.createEl('label', { text: '最近使用' });
    
    const recentTagsList = recentTagsContainer.createEl('div', { cls: 'recent-tags-list' });
    
    // 获取最近使用的标签并显示
    const recentTags = this.imageDataManager.getRecentTags();
    recentTags.forEach(tag => {
      const recentTagEl = recentTagsList.createEl('span', { 
        cls: 'recent-tag-item', 
        text: tag 
      });
      
      recentTagEl.addEventListener('click', () => {
        if (!imageData.tags.includes(tag)) {
          // 添加标签
          imageData.tags.push(tag);
          this.createTagElement(tagsList, tag, imageData);
          
          // 更新最近使用的标签
          this.imageDataManager.addImageData(imageData);
          
          // 更新UI状态
          recentTagEl.addClass('selected');
        } else {
          // 移除标签
          imageData.tags = imageData.tags.filter(t => t !== tag);
          
          // 从标签列表中移除对应的标签元素
          const tagElements = tagsList.querySelectorAll('.tag-item');
          for (let i = 0; i < tagElements.length; i++) {
            const tagEl = tagElements[i] as HTMLElement;
            // 检查标签文本是否匹配（注意需要去除可能的删除按钮文本）
            const tagText = tagEl.innerText.split('×')[0]?.trim();
            if (tagText === tag) {
              tagEl.remove();
              break;
            }
          }
          
          // 更新最近使用的标签
          this.imageDataManager.addImageData(imageData);
          
          // 更新UI状态
          recentTagEl.removeClass('selected');
        }
      });
      
      // 检查当前图片是否已包含此最近使用的标签，如果是，则标记为选中状态
      if (imageData.tags.includes(tag)) {
        recentTagEl.addClass('selected');
      }
    });
    
    // 如果没有最近使用的标签，显示提示
    if (recentTags.length === 0) {
      recentTagsList.createEl('span', { 
        cls: 'no-recent-tags', 
        text: '暂无最近使用标签' 
      });
    }
    
    
    // 保存按钮
    const saveBtn = infoContainer.createEl('button', {
      cls: 'save-info-btn',
      text: '保存更改'
    });
    
    // 删除按钮
    const deleteBtn = infoContainer.createEl('button', {
      cls: 'delete-image-btn',
      text: '删除图片文件',
      attr: {
        style: 'background-color: #da3633; border-color: #ff7b72; color: white; margin-top: 10px;'
      }
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
    
    deleteBtn.addEventListener('click', () => {
      this.deleteImageFile(imageData);
    });
  }
  
  private createTagElement(container: HTMLElement, tag: string, imageData: MediaData) {
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
      
      // 更新最近使用标签的状态
      const recentTagElements = this.imageInfoContainer.querySelectorAll('.recent-tag-item');
      for (let i = 0; i < recentTagElements.length; i++) {
        const recentTagEl = recentTagElements[i] as HTMLElement;
        if (recentTagEl.innerText === tag) {
          recentTagEl.removeClass('selected');
          break;
        }
      }
      
      // 更新最近使用的标签
      this.imageDataManager.addImageData(imageData);
    });
  }

  private addTag(input: HTMLInputElement, imageData: MediaData, container: HTMLElement) {
    const newTag = input.value.trim();
    if (!newTag) return;
    
    if (!imageData.tags.includes(newTag)) {
      imageData.tags.push(newTag);
      this.createTagElement(container, newTag, imageData);
      input.value = '';
      
      // 更新最近使用的标签
      this.imageDataManager.addImageData(imageData);
      
      // 更新最近使用标签的UI状态
      const recentTagElements = this.imageInfoContainer.querySelectorAll('.recent-tag-item');
      for (let i = 0; i < recentTagElements.length; i++) {
        const recentTagEl = recentTagElements[i] as HTMLElement;
        if (recentTagEl.innerText === newTag) {
          recentTagEl.addClass('selected');
          break;
        }
      }
    }
  }

  private async saveImageInfo(imageData: MediaData, titleInput: HTMLInputElement, descInput: HTMLTextAreaElement) {
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

  private async deleteImageFile(imageData: MediaData) {
    // 确认删除对话框
    const confirmed = confirm(`确定要删除图片 "${imageData.title}" 吗？`);
    
    if (!confirmed) {
      return; // 用户取消删除
    }

    try {
      // 使用工具函数删除图片文件
      const success = await deleteImageFile(imageData, this.app, this.imageDataManager, this.currentFile);
      
      if (success) {
        new Notice(`已删除图片: ${imageData.title}`);
        
        // 关闭当前视图
        this.leaf.detach();
      } else {
        new Notice('删除失败，请查看控制台获取更多信息');
      }
    } catch (error) {
      console.error('删除图片文件时发生错误:', error);
      new Notice(`删除失败: ${error.message}`);
    }
  }
}