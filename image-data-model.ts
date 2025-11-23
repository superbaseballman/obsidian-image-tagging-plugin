// image-data-model.ts - 图片数据模型定义
import { TFile } from 'obsidian';

export interface ImageData {
  id: string;              // 唯一标识符
  path: string;            // 图片在 Obsidian 库中的路径
  title: string;           // 图片标题
  tags: string[];          // 标签数组
  date: string;            // 添加/修改日期 (ISO 格式)
  size: string;            // 文件大小 (例如 "2.4 MB")
  resolution: string;      // 分辨率 (例如 "1920x1080")
  format: string;          // 文件格式 (例如 "JPG")
  description: string;     // 图片描述
  originalName: string;    // 原始文件名
  lastModified: number;    // 最后修改时间戳
  width?: number;          // 图片宽度 (可选)
  height?: number;         // 图片高度 (可选)
  fileSize?: number;       // 文件大小 (以字节为单位，可选)
}

// 插件设置接口
export interface ImageTaggingSettings {
  jsonStoragePath: string;
  categories: string[];
  supportedFormats: string[];
  showInFileExplorer: boolean;
  autoTagOnImport: boolean;
  enableGalleryView: boolean;
  scanFolderPath: string;
}

// 默认设置
export const DEFAULT_SETTINGS: ImageTaggingSettings = {
  jsonStoragePath: '.obsidian/image-tags.json',
  categories: ['全部图片', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术'],
  supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'],
  showInFileExplorer: true,
  autoTagOnImport: false,
  enableGalleryView: true,
  scanFolderPath: ''  // 默认为空，用户需要手动设置
};

// 图片文件类型检查辅助函数
export function isSupportedImageFile(file: TFile, settings: ImageTaggingSettings): boolean {
  const extension = file.extension ? file.extension.toLowerCase() : '';
  return settings.supportedFormats.includes(extension);
}

// 数据管理器类
export class ImageDataManager {
  private data: Map<string, ImageData> = new Map();
  
  // 添加或更新图片数据
  addImageData(imageData: ImageData): void {
    this.data.set(imageData.id, imageData);
  }
  
  // 获取图片数据
  getImageData(id: string): ImageData | undefined {
    return this.data.get(id);
  }
  
  // 获取所有图片数据
  getAllImageData(): ImageData[] {
    return Array.from(this.data.values());
  }
  
  // 删除图片数据
  removeImageData(id: string): boolean {
    return this.data.delete(id);
  }
  
  // 根据路径获取图片数据
  getImageDataByPath(path: string): ImageData | undefined {
    for (const imageData of this.data.values()) {
      if (imageData.path === path) {
        return imageData;
      }
    }
    return undefined;
  }
  
  // 搜索包含特定标签的图片
  searchByTag(tag: string): ImageData[] {
    return Array.from(this.data.values()).filter(image => 
      image.tags.includes(tag)
    );
  }
  
  // 搜索包含特定关键词的图片（标题或标签）
  search(keyword: string): ImageData[] {
    const lowerKeyword = keyword.toLowerCase();
    return Array.from(this.data.values()).filter(image => 
      image.title.toLowerCase().includes(lowerKeyword) ||
      image.description.toLowerCase().includes(lowerKeyword) ||
      image.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
    );
  }
  
  // 获取热门标签
  getPopularTags(limit: number = 10): { tag: string; count: number }[] {
    const tagCounts: Map<string, number> = new Map();
    
    for (const image of this.data.values()) {
      for (const tag of image.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    
    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  // 从 JSON 导入数据
  importFromJSON(jsonData: string): void {
    try {
      const parsed = JSON.parse(jsonData);
      if (Array.isArray(parsed)) {
        this.data.clear();
        for (const item of parsed) {
          // 验证数据结构
          if (this.isValidImageData(item)) {
            this.data.set(item.id, item);
          }
        }
      }
    } catch (error) {
      console.error('导入 JSON 数据失败:', error);
      throw error;
    }
  }
  
  // 导出到 JSON
  exportToJSON(): string {
    return JSON.stringify(Array.from(this.data.values()), null, 2);
  }
  
  // 验证数据结构
  private isValidImageData(data: any): data is ImageData {
    return (
      typeof data === 'object' &&
      typeof data.id === 'string' &&
      typeof data.path === 'string' &&
      typeof data.title === 'string' &&
      Array.isArray(data.tags) &&
      data.tags.every((tag: any) => typeof tag === 'string') &&
      typeof data.date === 'string' &&
      typeof data.description === 'string'
    );
  }

  // 清理失效的图片数据
  public cleanupInvalidImages(app: any): number {
    let removedCount = 0;
    const validData = new Map<string, ImageData>();

    for (const [id, imageData] of this.data.entries()) {
      // 检查文件是否存在
      const file = app.vault.getAbstractFileByPath(imageData.path);
      if (file && (file as any).path) {
        // 文件存在，保留数据
        validData.set(id, imageData);
      } else {
        // 文件不存在，跳过（相当于删除）
        removedCount++;
        console.log(`清理失效图片数据: ${imageData.path}`);
      }
    }

    // 更新数据存储
    this.data = validData;
    return removedCount;
  }
}