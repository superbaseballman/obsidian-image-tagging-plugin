import { TFile, App, Workspace } from 'obsidian';
import { ImageDataManager, ImageTaggingSettings, MediaData } from './image-data-model';
import { Logger } from './logger';
import { ErrorHandler, ImageTaggingError } from './error-handler';
import { ImageCacheManager } from './image-cache-manager';

// 图片信息缓存
interface CachedImageInfo {
  width: number;
  height: number;
  resolution: string;
  lastFetchTime: number;
}

// 缓存图片信息，避免重复加载
const imageInfoCache = new Map<string, CachedImageInfo>();

// 缓存过期时间（毫秒）
const CACHE_EXPIRY_TIME = 30 * 60 * 1000; // 30分钟

// 通用的图片路径处理函数
export function getSafeImagePath(app: App, path: string | undefined | null): string {
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
      const files = app.vault.getFiles();
      const matchingFile = files.find(file => file.name === path || file.basename + '.' + file.extension === path);
      if (matchingFile) {
        return app.vault.getResourcePath(matchingFile);
      }
    }
    
    // 检查文件是否存在再获取路径
    const abstractFile = app.vault.getAbstractFileByPath(path);
    if (!abstractFile) {
      // 如果文件不存在，返回占位符
      return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
    }

    // 只有当 abstractFile 是文件类型时，传入 getResourcePath
    if (abstractFile instanceof TFile) {
      return app.vault.getResourcePath(abstractFile);
    }

    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
  } catch (e) {
    // 如果 getResourcePath 失败，返回一个默认的占位符图像
    Logger.warn(`无法获取图片路径: ${path}`, e);
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
  }
}

export interface ImageTaggingPlugin {
  imageDataManager: ImageDataManager;
  settings: ImageTaggingSettings;
  saveDataToFile(): Promise<void>;
  loadDataFromFile(): Promise<void>;
  saveSettings(): Promise<void>;
}

// 获取插件实例
export function getImageTaggingPlugin(app: App): ImageTaggingPlugin | null {
  try {
    // 首先尝试标准方式获取
    const plugins = (app as any).plugins as { [key: string]: ImageTaggingPlugin } | undefined;
    if (plugins && plugins['image-tagging-obsidian']) {
      return plugins['image-tagging-obsidian'];
    }
    
    // 如果标准方式失败，尝试其他方式
    // 检查插件是否在其他可能的位置
    if ((app as any).plugins?.plugins) {
      const allPlugins = (app as any).plugins.plugins;
      if (allPlugins && allPlugins['image-tagging-obsidian']) {
        return allPlugins['image-tagging-obsidian'] as ImageTaggingPlugin;
      }
    }
    
    // 如果仍然找不到，返回 null
    return null;
  } catch (error) {
    console.error('获取插件实例时出错:', error);
    return null;
  }
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
 * 从图片路径获取 TFile 对象
 * @param imagePath 图片路径
 * @param app Obsidian App 实例
 * @returns TFile 对象或 null
 */
export function getImageFileFromPath(imagePath: string, app: App): TFile | null {
  // 处理不同格式的图片路径
  if (!imagePath) return null;
  
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

  // 尝试匹配文件名
  if (!cleanPath.includes('/')) {
    const matchingFile = app.vault.getFiles().find(f => f.name === cleanPath || f.basename === cleanPath);
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
    await app.vault.delete(fileToDelete);

    // 从数据管理器中移除该图片的数据
    imageDataManager.removeImageData(imageData.id);

    return true;
  } catch (error) {
    Logger.error('删除图片文件时发生错误:', error);
    return false;
  }
}
