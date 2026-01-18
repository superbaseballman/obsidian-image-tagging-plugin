// image-data-model.ts - 媒体数据模型定义
import { TFile, App } from 'obsidian';
import { Logger } from './logger';
import { DEFAULT_JSON_STORAGE_PATH, DEFAULT_SUPPORTED_FORMATS, DEFAULT_CATEGORIES } from './constants';
import { DataMigration } from './data-migration';

export interface MediaData {
  id: string;              // 唯一标识符
  path: string;            // 文件在 Obsidian 库中的路径
  title: string;           // 标题
  tags: string[];          // 标签数组
  date: string;            // 添加/修改日期 (ISO 格式)
  size: string;            // 文件大小 (例如 "2.4 MB")
  resolution: string;      // 分辨率 (对于视频/音频可能是时长等)
  format: string;          // 文件格式 (例如 "JPG", "MP4", "MP3")
  description: string;     // 描述
  originalName: string;    // 原始文件名
  lastModified: number;    // 最后修改时间戳
  width?: number;          // 宽度 (对于图片/视频)
  height?: number;         // 高度 (对于图片/视频)
  fileSize?: number;       // 文件大小 (以字节为单位，可选)
  type: 'image' | 'video' | 'audio'; // 媒体类型
}

// 向后兼容的别名
export type ImageData = MediaData;

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

  recentTags: string[]; // 最近使用的标签
}

// 默认设置 

export const DEFAULT_SETTINGS: ImageTaggingSettings = {

  jsonStoragePath: DEFAULT_JSON_STORAGE_PATH,

  categories: DEFAULT_CATEGORIES,

  supportedFormats: DEFAULT_SUPPORTED_FORMATS,

  showInFileExplorer: true,

  autoTagOnImport: false,

  autoTagOnImportValue: '', // 默认没有自定义标签

  enableGalleryView: true,

  scanFolderPath: '',  // 默认为空，用户需要手动设置

  scanMultipleFolderPaths: [], // 默认为空数组
  recentTags: [], // 默认没有最近使用的标签,
};

// 媒体文件类型检查辅助函数
export function isSupportedMediaFile(file: TFile, settings: ImageTaggingSettings): boolean {
  const extension = file.extension ? file.extension.toLowerCase() : '';
  return settings.supportedFormats.includes(extension);
}

// 向后兼容的别名
export const isSupportedImageFile = isSupportedMediaFile;

// 获取媒体类型
export function getMediaType(file: TFile): 'image' | 'video' | 'audio' | null {
  const extension = file.extension ? file.extension.toLowerCase() : '';
  const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
  const videoFormats = ['mp4', 'avi', 'mov', 'mkv', 'webm'];
  const audioFormats = ['mp3', 'wav', 'flac', 'aac', 'ogg'];
  
  if (imageFormats.includes(extension)) return 'image';
  if (videoFormats.includes(extension)) return 'video';
  if (audioFormats.includes(extension)) return 'audio';
  return null;
}

// 数据管理器类 

export class ImageDataManager {
  private data: Map<string, MediaData> = new Map();
  private pathToIdMap: Map<string, string> = new Map(); // 添加路径到ID的映射以提高查找效率
  private recentTags: string[] = [];
  private maxRecentTags: number = 20; // 限制最近标签数量
  
  constructor(recentTags: string[] = []) {
    this.recentTags = recentTags;
  }
  
  // 添加或更新媒体数据
  addImageData(mediaData: MediaData): void {
    // 如果之前存在相同路径的数据，先删除旧的路径映射
    const existingData = this.data.get(mediaData.id);
    if (existingData && existingData.path !== mediaData.path) {
      this.pathToIdMap.delete(existingData.path);
    }
    
    this.data.set(mediaData.id, mediaData);
    this.pathToIdMap.set(mediaData.path, mediaData.id); // 添加路径到ID的映射
    
    // 更新最近使用的标签
    this.updateRecentTags(mediaData.tags);
  }
  
  // 获取媒体数据
  getImageData(id: string): MediaData | undefined {
    return this.data.get(id);
  }
  
  // 获取所有媒体数据
  getAllImageData(): MediaData[] {
    return Array.from(this.data.values());
  }
  
  // 删除媒体数据
  removeImageData(id: string): boolean {
    const mediaData = this.data.get(id);
    if (mediaData) {
      this.pathToIdMap.delete(mediaData.path); // 同时删除路径映射
    }
    return this.data.delete(id);
  }
  
  // 根据路径获取媒体数据
  getImageDataByPath(path: string): MediaData | undefined {
    const id = this.pathToIdMap.get(path);
    if (id) {
      return this.data.get(id);
    }
    return undefined;
  }
  
  // 搜索包含特定标签的媒体
  searchByTag(tag: string): MediaData[] {
    return Array.from(this.data.values()).filter(media => 
      media.tags.includes(tag)
    );
  }
  
  // 搜索包含特定关键词的媒体（标题或标签）
  search(keyword: string): MediaData[] {
    const lowerKeyword = keyword.toLowerCase();
    return Array.from(this.data.values()).filter(media => 
      media.title.toLowerCase().includes(lowerKeyword) ||
      media.description.toLowerCase().includes(lowerKeyword) ||
      media.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))
    );
  }
  
  // 获取热门标签
  getPopularTags(limit: number = 10): { tag: string; count: number }[] {
    const tagCounts: Map<string, number> = new Map();
    
    for (const media of this.data.values()) {
      for (const tag of media.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    
    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
  
  // 更新最近使用的标签
  private updateRecentTags(tags: string[]) {
    for (const tag of tags) {
      // 移除标签（如果已经存在于最近标签列表中）
      this.recentTags = this.recentTags.filter(t => t !== tag);
      // 将标签添加到开头
      this.recentTags.unshift(tag);
    }
    // 限制最近标签的数量
    this.recentTags = this.recentTags.slice(0, this.maxRecentTags);
  }
  
  // 获取最近使用的标签
  getRecentTags(): string[] {
    return [...this.recentTags]; // 返回副本
  }
  
  // 从 JSON 导入数据
  importFromJSON(jsonData: string): void {
    try {
      // 使用数据迁移工具加载数据，自动处理旧版本格式
      const parsed = DataMigration.loadDataWithMigration(jsonData);
      
      if (Array.isArray(parsed)) {
        this.data.clear();
        this.pathToIdMap.clear(); // 清空路径映射
        for (const item of parsed) {
          // 验证数据结构
          if (this.isValidImageData(item)) {
            this.data.set(item.id, item);
            this.pathToIdMap.set(item.path, item.id); // 添加路径映射
          } else {
            Logger.warn('跳过无效的数据项:', item);
          }
        }
      }
    } catch (error) {
      Logger.error('导入 JSON 数据失败:', error);
      throw error;
    }
  }
  
  // 导出到 JSON
  exportToJSON(): string {
    return JSON.stringify(Array.from(this.data.values()), null, 2);
  }
  
  // 验证数据结构 - 兼容新旧版本格式
  private isValidImageData(data: unknown): data is MediaData {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    const obj = data as Record<string, unknown>;
    
    // 检查基本必需字段
    const hasBasicFields = 
      typeof obj.id === 'string' &&
      typeof obj.path === 'string' &&
      typeof obj.title === 'string' &&
      Array.isArray(obj.tags) &&
      obj.tags.every((tag: unknown) => typeof tag === 'string') &&
      typeof obj.date === 'string' &&
      typeof obj.description === 'string';
    
    if (!hasBasicFields) {
      return false;
    }
    
    // 检查新版本必需的 type 字段
    if ('type' in obj) {
      // 新版本格式 - 需要验证 type 字段的值
      return (obj.type === 'image' || obj.type === 'video' || obj.type === 'audio');
    }
    
    // 旧版本格式 - 没有 type 字段，但我们仍认为它是有效的（将在导入时添加）
    return true;
  }

  // 清理失效的媒体数据
  public cleanupInvalidImages(app: App, scanFolderPath?: string, scanMultipleFolderPaths?: string[]): number {
    let removedCount = 0;
    const validData = new Map<string, MediaData>();
    const validPathToIdMap = new Map<string, string>();

    for (const [id, mediaData] of this.data.entries()) {
      // 检查文件是否存在
      const file = app.vault.getAbstractFileByPath(mediaData.path);
      
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
        
        // 检查媒体路径是否在任一扫描路径内
        const normalizedMediaPath = mediaData.path.replace(/\\/g, '/');
        isInScanFolder = normalizedFolderPaths.some(folderPath => normalizedMediaPath.startsWith(folderPath));
      } else if (scanFolderPath && scanFolderPath.trim() !== '') {
        // 标准化路径以確保正确匹配
        let normalizedScanPath = scanFolderPath.replace(/\\/g, '/');
        if (!normalizedScanPath.endsWith('/')) {
          normalizedScanPath += '/';
        }
        
        // 检查媒体路径是否在扫描路径内
        const normalizedMediaPath = mediaData.path.replace(/\\/g, '/');
        isInScanFolder = normalizedMediaPath.startsWith(normalizedScanPath);
      }

      if (file && file instanceof TFile && isInScanFolder) {
        // 文件存在且在扫描路径内，保留数据
        validData.set(id, mediaData);
        validPathToIdMap.set(mediaData.path, id); // 同时保留路径映射
      } else {
        // 文件不存在或不在扫描路径内，跳过（相当于删除）
        removedCount++;
        Logger.debug(`清理媒体数据: ${mediaData.path}`);
      }
    }

    // 更新数据存储
    this.data = validData;
    this.pathToIdMap = validPathToIdMap;
    return removedCount;
  }
}