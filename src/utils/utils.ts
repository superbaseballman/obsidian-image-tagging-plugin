import { TFile, App } from 'obsidian';
import { ImageDataManager, ImageTaggingSettings, MediaData } from '../models/image-data-model';
import { Logger } from './logger';
import { ImageCacheManager } from './image-cache-manager';
import { CACHE_EXPIRY_TIME } from '../constants';

// 图片或媒体加载失败时的占位图（SVG data URI）
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';

// 媒体信息缓存（视频/音频时长）
interface CachedMediaInfo {
  width?: number;
  height?: number;
  resolution?: string;
  duration?: string;
  lastFetchTime: number;
}

// 缓存媒体信息，避免重复加载
const mediaInfoCache = new Map<string, CachedMediaInfo>();

// 通用的图片路径处理函数
export function getSafeImagePath(app: App, path: string | undefined | null): string {
  try {
    // 首先检查路径是否为 undefined 或 null
    if (!path) {
      // 如果路径为空、undefined 或 null，返回占位符
      return PLACEHOLDER_IMAGE;
    }

    // 检查是否已经是 app:// 格式的 URL
    if (path.startsWith('app://')) {
      // 如果是 app:// 格式，直接使用它
      return path;
    }

    // 如果路径不包含完整路径（例如只包含文件名），用链接解析在库中查找（避免遍历全部文件）
    if (!path.includes('/') && !path.includes('\\')) {
      const matchingFile = app.metadataCache.getFirstLinkpathDest(path, '');
      if (matchingFile) {
        return app.vault.getResourcePath(matchingFile);
      }
    }

    // 检查文件是否存在再获取路径
    const abstractFile = app.vault.getAbstractFileByPath(path);
    if (!abstractFile) {
      // 如果文件不存在，返回占位符
      return PLACEHOLDER_IMAGE;
    }

    // 只有当 abstractFile 是文件类型时，传入 getResourcePath
    if (abstractFile instanceof TFile) {
      return app.vault.getResourcePath(abstractFile);
    }

    return PLACEHOLDER_IMAGE;
  } catch (e) {
    // 如果 getResourcePath 失败，返回一个默认的占位符图像
    Logger.warn(`无法获取图片路径: ${path}`, e);
    return PLACEHOLDER_IMAGE;
  }
}

export interface ImageTaggingPlugin {
  imageDataManager: ImageDataManager;
  settings: ImageTaggingSettings;
  dataReady: Promise<void>;
  saveDataToFile(): Promise<void>;
  loadDataFromFile(): Promise<void>;
  saveSettings(): Promise<void>;
  ensureImageDataForFile(file: TFile): Promise<MediaData | undefined>;
  /** 取走并清空「已确认删除」的媒体记录（供图库刷新时展示） */
  consumeRemovedRecords(): MediaData[];
  /** 取走并清空仍在删除宽限期内的媒体记录（调用前应先完成一次全库扫描） */
  consumePendingRemovedRecords(): MediaData[];
}

/** 插件在 manifest 中注册的 id（必须与 manifest.json 的 id 一致） */
export const IMAGE_TAGGING_PLUGIN_ID = 'image-tagging';

/** 历史遗留 id：早期版本曾使用过，保留兼容以免旧环境取不到实例 */
const LEGACY_PLUGIN_IDS = ['image-tagging-obsidian'];

// 获取插件实例
export function getImageTaggingPlugin(app: App): ImageTaggingPlugin | null {
  try {
    const manager = (app as any).plugins as
      | {
          getPlugin?: (id: string) => unknown;
          plugins?: { [key: string]: unknown };
          [key: string]: unknown;
        }
      | undefined;
    const ids = [IMAGE_TAGGING_PLUGIN_ID, ...LEGACY_PLUGIN_IDS];
    const candidates: unknown[] = [];

    // 1) 标准方式：plugins.getPlugin(id)
    if (typeof manager?.getPlugin === 'function') {
      for (const id of ids) {
        candidates.push(manager.getPlugin(id));
      }
    }
    // 2) 兼容直接索引 / 内层 plugins 映射
    for (const id of ids) {
      candidates.push(manager?.[id], manager?.plugins?.[id]);
    }

    for (const candidate of candidates) {
      const instance = candidate as ImageTaggingPlugin | undefined;
      // 以 imageDataManager 作为识别标记，避免拿到同名 / 无关对象
      if (instance && instance.imageDataManager) {
        return instance;
      }
    }

    return null;
  } catch (error) {
    Logger.error('获取插件实例时出错:', error);
    return null;
  }
}

/**
 * 将字节数格式化为人类可读的文件大小字符串
 * @param bytes - 字节数
 * @returns 格式化后的字符串，如 "1 KB"、"2.35 MB"
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 获取图片分辨率信息，使用缓存避免重复加载
 * @param file - Obsidian TFile对象
 * @param app - Obsidian App实例
 * @returns 包含宽度、高度和分辨率字符串的对象，失败时返回null
 */
export async function getImageResolutionWithCache(file: TFile, app: App): Promise<{width: number, height: number, resolution: string} | null> {
  return ImageCacheManager.getImageResolutionWithCache(file, app);
}

/**
 * 获取视频或音频文件的时长信息，使用缓存避免重复加载
 * @param file - Obsidian TFile对象
 * @param app - Obsidian App实例
 * @returns 包含时长信息的字符串，失败时返回null
 */
export async function getMediaDurationWithCache(file: TFile, app: App): Promise<string | null> {
  try {
    // 检查缓存
    const cached = mediaInfoCache.get(file.path);
    if (cached && (Date.now() - cached.lastFetchTime) < CACHE_EXPIRY_TIME) {
      return cached.duration || null;
    }

    // 创建临时媒体元素来获取时长
    const fileUrl = app.vault.getResourcePath(file);
    
    return new Promise((resolve) => {
      let mediaElement: HTMLVideoElement | HTMLAudioElement;
      
      // 根据文件类型创建适当的媒体元素
      if (file.extension.toLowerCase().includes('mp3') || 
          file.extension.toLowerCase().includes('wav') || 
          file.extension.toLowerCase().includes('ogg') ||
          file.extension.toLowerCase().includes('m4a') ||
          file.extension.toLowerCase().includes('flac') ||
          file.extension.toLowerCase().includes('aac') ||
          file.extension.toLowerCase().includes('wma')) {
        // 音频文件
        mediaElement = document.body.createEl('audio');
      } else {
        // 视频文件
        mediaElement = document.body.createEl('video');
      }
      
      mediaElement.src = fileUrl;
      mediaElement.preload = 'metadata';
      
      const onLoad = () => {
        // 计算时长并格式化为 MM:SS 或 HH:MM:SS 格式
        const duration = mediaElement.duration;
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = Math.floor(duration % 60);
        
        let durationStr = '';
        if (hours > 0) {
          durationStr = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // 存入缓存
        mediaInfoCache.set(file.path, {
          duration: durationStr,
          lastFetchTime: Date.now()
        });
        
        // 清理元素
        mediaElement.removeEventListener('loadedmetadata', onLoad);
        mediaElement.removeEventListener('error', onError);
        document.body.removeChild(mediaElement);
        
        resolve(durationStr);
      };
      
      const onError = () => {
        // 发生错误时清理元素并返回null
        mediaElement.removeEventListener('loadedmetadata', onLoad);
        mediaElement.removeEventListener('error', onError);
        document.body.removeChild(mediaElement);
        
        resolve(null);
      };
      
      mediaElement.addEventListener('loadedmetadata', onLoad);
      mediaElement.addEventListener('error', onError);
      
      // 添加到 DOM 但隐藏
      mediaElement.addClass('image-tagging-hidden-media');
    });
  } catch (error) {
    Logger.warn(`获取媒体时长失败: ${file.path}`, error);
    return null;
  }
}

/**
 * 清除特定文件的缓存
 * @param filePath - 文件路径
 */
export function clearImageCache(filePath: string) {
  ImageCacheManager.clearImageCache(filePath);
}

/**
 * 清除所有缓存
 */
export function clearAllImageCache() {
  ImageCacheManager.clearAllImageCache();
}

/**
 * 预加载图片信息到缓存
 * @param files - 要预加载的文件数组
 * @param app - Obsidian App实例
 * @param maxConcurrent = 5
 */
export async function preloadImageInfo(files: TFile[], app: App, maxConcurrent = 5) {
  return ImageCacheManager.preloadImageInfo(files, app, maxConcurrent);
}

/**
 * 解析 app:// 资源 URL 为库内文件。
 * 兼容两种形式：
 * - 新版 / 移动端：app://<vaultId>/<库内相对路径>
 * - 桌面端旧版：app://local/<绝对路径>
 * 大多数情况下无需遍历全库，仅在最后手段才与 getResourcePath 精确比对。
 */
export function resolveAppResourceUrl(app: App, src: string): TFile | null {
  const withoutScheme = src.slice('app://'.length).split('?')[0];
  const slashIndex = withoutScheme.indexOf('/');
  let candidate = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1) : withoutScheme;
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // 解码失败时保留原字符串
  }

  // 1) 直接按库内相对路径查找
  const direct = app.vault.getAbstractFileByPath(candidate);
  if (direct instanceof TFile) return direct;

  // 2) 桌面端绝对路径 → 转换为库内相对路径
  const basePath = (app.vault.adapter as any)?.getBasePath?.();
  if (typeof basePath === 'string' && basePath) {
    const normalizedBase = basePath.replace(/\\/g, '/').replace(/\/$/, '');
    const normalizedCandidate = candidate.replace(/\\/g, '/');
    if (normalizedCandidate.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
      const relative = normalizedCandidate.slice(normalizedBase.length + 1);
      const relativeFile = app.vault.getAbstractFileByPath(relative);
      if (relativeFile instanceof TFile) return relativeFile;
    }
  }

  // 3) 退化为按文件名解析
  const name = candidate.split('/').pop() || candidate;
  const byName = app.metadataCache.getFirstLinkpathDest(name, '');
  if (byName) return byName;

  // 4) 最后手段：与 getResourcePath 精确比对（避免同名文件误判）
  for (const f of app.vault.getFiles()) {
    if (app.vault.getResourcePath(f) === src) return f;
  }
  return null;
}

/**
 * 从图片路径获取 TFile 对象
 * @param imagePath 图片路径
 * @param app Obsidian App 实例
 * @returns TFile 对象或 null
 */
export function getImageFileFromPath(imagePath: string, app: App): TFile | null {
  // 处理不同格式的图片路径
  if (!imagePath) return null;

  // app:// 资源 URL（渲染后的图片 src）：优先用专属解析器处理
  if (imagePath.startsWith('app://')) {
    const resolved = resolveAppResourceUrl(app, imagePath);
    if (resolved) return resolved;
  }

  // 去除 Obsidian 特定的协议前缀和查询参数
  let cleanPath = imagePath.replace(/^app:\/\/\+\/\w+\//, '');
  if (cleanPath.includes('?')) {
    cleanPath = cleanPath.substring(0, cleanPath.indexOf('?'));
  }

  // 尝试直接获取文件
  let file = app.vault.getAbstractFileByPath(cleanPath);
  if (file && file instanceof TFile) {
    return file;
  }

  // 如果直接路径未找到，尝试在当前打开的文件所在目录查找
  const activeFile = app.workspace.getActiveFile();
  if (activeFile && !cleanPath.startsWith('/')) {
    // 构造相对路径
    const dir = activeFile.parent?.path || '';
    const relativePath = dir ? `${dir}/${cleanPath}` : cleanPath;
    file = app.vault.getAbstractFileByPath(relativePath);
    if (file && file instanceof TFile) {
      return file;
    }
  }

  // 尝试用 Obsidian 的链接解析匹配文件名（避免遍历整个库，图库渲染时开销更小）
  if (!cleanPath.includes('/')) {
    const matchingFile = app.metadataCache.getFirstLinkpathDest(cleanPath, activeFile?.path || '');
    if (matchingFile) {
      return matchingFile;
    }
  }

  return null;
}

/**
 * 删除图片文件及其相关数据
 * @param imageData - 要删除的图片数据
 * @param app - Obsidian App实例
 * @param imageDataManager - 图片数据管理器实例
 * @param currentFile - 当前TFile对象（可选，如果未提供则根据路径获取）
 * @returns Promise<boolean> - 删除是否成功
 */
export async function deleteImageFile(
  imageData: MediaData, 
  app: App, 
  imageDataManager: ImageDataManager, 
  currentFile?: TFile | null
): Promise<boolean> {
  try {
    let fileToDelete: TFile | null = null;

    if (currentFile) {
      fileToDelete = currentFile;
    } else {
      // 如果currentFile不存在，尝试通过路径获取文件
      const file = app.vault.getAbstractFileByPath(imageData.path);
      if (file && file instanceof TFile) {
        fileToDelete = file;
      }
    }

    if (!fileToDelete) {
      Logger.error('找不到要删除的文件');
      return false;
    }

    // 从文件系统中删除文件
    await app.fileManager.trashFile(fileToDelete);

    // 从数据管理器中移除该图片的数据
    imageDataManager.removeImageData(imageData.id);

    return true;
  } catch (error) {
    Logger.error('删除图片文件时发生错误:', error);
    return false;
  }
}
