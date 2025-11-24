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
  autoTagOnImportValue: string; // 自定义导入标签值
  enableGalleryView: boolean;
  scanFolderPath: string; // 保持原有字段用于兼容性
  scanMultipleFolderPaths: string[]; // 新增：支持多个扫描文件夹路径
}

// 默认设置
export const DEFAULT_SETTINGS: ImageTaggingSettings = {
  jsonStoragePath: '.obsidian/image-tags.json',
  categories: ['全部图片', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术'],
  supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'],
  showInFileExplorer: true,
  autoTagOnImport: false,
  autoTagOnImportValue: '', // 默认没有自定义标签
  enableGalleryView: true,
  scanFolderPath: '',  // 默认为空，用户需要手动设置
  scanMultipleFolderPaths: [] // 默认为空数组
};

// 图片文件类型检查辅助函数
export function isSupportedImageFile(file: TFile, settings: ImageTaggingSettings): boolean {
  const extension = file.extension ? file.extension.toLowerCase() : '';
  return settings.supportedFormats.includes(extension);
}

// 数据管理器类
export class ImageDataManager {
  private data: Map<string, ImageData> = new Map();
  private pathToIdMap: Map<string, string> = new Map(); // 添加路径到ID的映射以提高查找效率
  
  // 添加或更新图片数据
  addImageData(imageData: ImageData): void {
    // 如果之前存在相同路径的数据，先删除旧的路径映射
    const existingData = this.data.get(imageData.id);
    if (existingData && existingData.path !== imageData.path) {
      this.pathToIdMap.delete(existingData.path);
    }
    
    this.data.set(imageData.id, imageData);
    this.pathToIdMap.set(imageData.path, imageData.id); // 添加路径到ID的映射
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
    const imageData = this.data.get(id);
    if (imageData) {
      this.pathToIdMap.delete(imageData.path); // 同时删除路径映射
    }
    return this.data.delete(id);
  }
  
  // 根据路径获取图片数据
  getImageDataByPath(path: string): ImageData | undefined {
    const id = this.pathToIdMap.get(path);
    if (id) {
      return this.data.get(id);
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
        this.pathToIdMap.clear(); // 清空路径映射
        for (const item of parsed) {
          // 验证数据结构
          if (this.isValidImageData(item)) {
            this.data.set(item.id, item);
            this.pathToIdMap.set(item.path, item.id); // 添加路径映射
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
  public cleanupInvalidImages(app: any, scanFolderPath?: string, scanMultipleFolderPaths?: string[]): number {
    let removedCount = 0;
    const validData = new Map<string, ImageData>();
    const validPathToIdMap = new Map<string, string>();

    for (const [id, imageData] of this.data.entries()) {
      // 检查文件是否存在
      const file = app.vault.getAbstractFileByPath(imageData.path);
      
      // 检查是否在指定的扫描路径内
      let isInScanFolder = true;
      
      // 优先使用多个文件夹路径设置，如果为空则使用单个文件夹路径设置
      if (scanMultipleFolderPaths && scanMultipleFolderPaths.length > 0) {
        // 标准化路径以确保正确匹配
        const normalizedFolderPaths = scanMultipleFolderPaths.map(path => {
          let normalizedPath = path.replace(/\\/g, '/');
          if (!normalizedPath.endsWith('/')) {
            normalizedPath += '/';
          }
          return normalizedPath;
        });
        
        // 检查图片路径是否在任一扫描路径内
        const normalizedImagePath = imageData.path.replace(/\\/g, '/');
        isInScanFolder = normalizedFolderPaths.some(folderPath => normalizedImagePath.startsWith(folderPath));
      } else if (scanFolderPath && scanFolderPath.trim() !== '') {
        // 标准化路径以確保正确匹配
        let normalizedScanPath = scanFolderPath.replace(/\\/g, '/');
        if (!normalizedScanPath.endsWith('/')) {
          normalizedScanPath += '/';
        }
        
        // 检查图片路径是否在扫描路径内
        const normalizedImagePath = imageData.path.replace(/\\/g, '/');
        isInScanFolder = normalizedImagePath.startsWith(normalizedScanPath);
      }

      if (file && file instanceof TFile && isInScanFolder) {
        // 文件存在且在扫描路径内，保留数据
        validData.set(id, imageData);
        validPathToIdMap.set(imageData.path, id); // 同时保留路径映射
      } else {
        // 文件不存在或不在扫描路径内，跳过（相当于删除）
        removedCount++;
        console.log(`清理图片数据: ${imageData.path}`);
      }
    }

    // 更新数据存储
    this.data = validData;
    this.pathToIdMap = validPathToIdMap;
    return removedCount;
  }
}