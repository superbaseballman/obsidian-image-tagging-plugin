// image-data-model.ts - 媒体数据模型定义
import { TFile, App } from 'obsidian';
import { Logger } from '../utils/logger';
import { DEFAULT_JSON_STORAGE_PATH, DEFAULT_SUPPORTED_FORMATS, DEFAULT_CATEGORIES, IMAGE_FORMATS, VIDEO_FORMATS, AUDIO_FORMATS } from '../constants';
import { DataMigration } from '../services/data-migration';
import { isFileInFolderPaths, resolveScanFolderPaths } from '../utils/folders';

export interface MediaData {
  id: string;              // 唯一标识符
  path: string;            // 文件在 Obsidian 库中的路径
  title: string;           // 标题
  tags: string[];          // 标签数组
  date: string;            // 添加/修改日期 (ISO 格式)
  size: string;            // 文件大小 (例如 "2.4 MB")
  resolution: string;      // 分辨率（对于图片）或时长（对于视频/音频）
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

  if (IMAGE_FORMATS.includes(extension)) return 'image';
  if (VIDEO_FORMATS.includes(extension)) return 'video';
  if (AUDIO_FORMATS.includes(extension)) return 'audio';
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
    const pathOwner = this.pathToIdMap.get(mediaData.path);
    if (pathOwner && pathOwner !== mediaData.id) {
      // 该路径已被另一条记录占用：让新记录接管路径，并移除旧的占用记录
      this.data.delete(pathOwner);
      this.pathToIdMap.delete(mediaData.path);
    }

    // 同内容（同 MD5）已在其它路径存在记录：同一内容只保留一条记录。
    // 直接合并标签到已有记录，不再生成 md5-2 / md5-3 派生 id，保证“同内容数据合并”。
    const existingData = this.data.get(mediaData.id);
    if (existingData && existingData.path !== mediaData.path) {
      existingData.tags = Array.from(new Set([...(existingData.tags || []), ...(mediaData.tags || [])]));
      this.updateRecentTags(existingData.tags);
      return;
    }

    this.data.set(mediaData.id, mediaData);
    this.pathToIdMap.set(mediaData.path, mediaData.id); // 添加路径到ID的映射
    
    // 更新最近使用的标签
    this.updateRecentTags(mediaData.tags);
  }

  /**
   * 处理文件重命名/移动：保留原记录（id、标签、描述不变），仅更新路径与映射。
   * @returns 更新后的记录；若无对应记录则返回 undefined
   */
  renamePath(oldPath: string, newPath: string): MediaData | undefined {
    if (oldPath === newPath) return undefined;
    const id = this.pathToIdMap.get(oldPath);
    if (!id) return undefined;
    const record = this.data.get(id);
    if (!record) return undefined;

    // 目标路径若已被其它记录占用，移除占用者，保持 path -> id 映射一致
    const otherOwner = this.pathToIdMap.get(newPath);
    if (otherOwner && otherOwner !== id) {
      this.data.delete(otherOwner);
      this.pathToIdMap.delete(newPath);
    }

    // 清理旧路径映射，更新记录路径，建立新路径映射（id 保持不变）
    this.pathToIdMap.delete(oldPath);
    record.path = newPath;
    this.pathToIdMap.set(newPath, id);
    return record;
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

  /**
   * 规整历史遗留的「同内容派生记录」（id 形如 md5-<后缀>），让同一内容最终只保留一条
   * 记录且 id 就是内容 MD5：
   * 1) 派生记录与基础 md5 记录并存 → 派生记录并入基础记录（标签取并集）；
   * 2) 仅剩派生记录（基础已被删除）→ 按内容分组，保留一条（优先文件仍存在者）并规整 id 为基础 md5。
   * @param exists 判断某路径的文件是否仍然存在
   * @returns 被合并移除的记录数
   */
  mergeDerivedContentRecords(exists: (path: string) => boolean): number {
    const baseOf = (id: string): string | undefined => {
      const m = /^([0-9a-f]{32})-.+$/.exec(id);
      return m ? m[1] : undefined;
    };
    let merged = 0;

    // 第一遍：基础 md5 记录与派生记录并存 → 派生并入基础，删除派生记录
    for (const derivedId of Array.from(this.data.keys())) {
      const baseId = baseOf(derivedId);
      if (!baseId) continue;
      const base = this.data.get(baseId);
      const derived = this.data.get(derivedId);
      if (!base || !derived || base.path === derived.path) continue;

      base.tags = Array.from(new Set([...base.tags, ...derived.tags]));
      if (!exists(base.path) && exists(derived.path)) {
        // 基础记录对应的文件已不存在，而派生记录的文件仍在 → 记录改指向该文件
        this.pathToIdMap.delete(base.path);
        base.path = derived.path;
        this.pathToIdMap.set(base.path, baseId);
      }
      this.pathToIdMap.delete(derived.path);
      this.data.delete(derivedId);
      this.updateRecentTags(base.tags);
      merged++;
    }

    // 第二遍：仅剩派生记录（基础 md5 记录已不存在）→ 分组后保留一条并规整 id
    const groups = new Map<string, MediaData[]>();
    for (const [id, record] of this.data) {
      const baseId = baseOf(id);
      if (baseId) {
        const list = groups.get(baseId);
        if (list) list.push({ ...record, id });
        else groups.set(baseId, [{ ...record, id }]);
      }
    }
    for (const [baseId, list] of groups) {
      if (list.length === 0) continue;
      // 尽量选择文件仍存在的记录作为保留对象
      let kept = list[0];
      for (const candidate of list) {
        if (exists(candidate.path)) {
          kept = candidate;
          break;
        }
      }
      for (const record of list) {
        if (record.id === kept.id) continue;
        kept.tags = Array.from(new Set([...kept.tags, ...record.tags]));
        this.pathToIdMap.delete(record.path);
        this.data.delete(record.id);
        merged++;
      }
      if (kept.id !== baseId) {
        this.data.delete(kept.id);
        kept.id = baseId;
        this.data.set(baseId, kept);
        this.pathToIdMap.set(kept.path, baseId);
      }
      this.updateRecentTags(kept.tags);
    }
    return merged;
  }
  
  // 根据路径获取媒体数据
  getImageDataByPath(path: string): MediaData | undefined {
    const id = this.pathToIdMap.get(path);
    if (id) {
      return this.data.get(id);
    }
    return undefined;
  }

  // 按内容标识查找记录：id 可能为 md5 或 md5-<序号>（同内容多拷贝）。
  // 优先返回与 contentId 完全相等的记录，其次返回由它派生的记录。
  getImageDataByContentId(contentId: string): MediaData | undefined {
    const exact = this.data.get(contentId);
    if (exact) return exact;
    const prefix = `${contentId}-`;
    for (const [id, record] of this.data) {
      if (id.startsWith(prefix)) return record;
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
        this.importRecords(parsed);
      }
    } catch (error) {
      Logger.error('导入 JSON 数据失败:', error);
      throw error;
    }
  }

  importRecords(records: MediaData[]): void {
    this.data.clear();
    this.pathToIdMap.clear();
    for (const item of records) {
      if (this.isValidImageData(item)) {
        this.addImageData(item);
      } else {
        Logger.warn('跳过无效的数据项:', item);
      }
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
  public cleanupInvalidImages(app: App, scanFolderPath?: string, scanMultipleFolderPaths?: string[]): MediaData[] {
    const removedData: MediaData[] = [];
    const validData = new Map<string, MediaData>();
    const validPathToIdMap = new Map<string, string>();

    // 解析扫描目录列表；为空数组表示未配置（扫描整个库，不限制）
    const folderPaths = resolveScanFolderPaths(scanFolderPath, scanMultipleFolderPaths);

    for (const [id, mediaData] of this.data.entries()) {
      // 检查文件是否存在
      const file = app.vault.getAbstractFileByPath(mediaData.path);

      // 检查是否在指定的扫描路径内（folderPaths 为空时不限制）
      const isInScanFolder = isFileInFolderPaths(mediaData.path, folderPaths);

      if (file && file instanceof TFile && isInScanFolder) {
        // 文件存在且在扫描路径内，保留数据
        validData.set(id, mediaData);
        validPathToIdMap.set(mediaData.path, id); // 同时保留路径映射
      } else {
        // 文件不存在或不在扫描路径内，跳过（相当于删除）
        removedData.push(mediaData);
        Logger.debug(`清理媒体数据: ${mediaData.path}`);
      }
    }

    // 更新数据存储
    this.data = validData;
    this.pathToIdMap = validPathToIdMap;
    return removedData;
  }
}