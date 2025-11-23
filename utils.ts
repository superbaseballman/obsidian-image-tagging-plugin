import { TFile, App } from 'obsidian';

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
    console.warn(`无法获取图片路径: ${path}`, e);
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkltYWdlPC90ZXh0Pjwvc3ZnPg==';
  }
}

export interface ImageTaggingPlugin {
  imageDataManager: ImageDataManager;
  settings: ImageTaggingSettings;
  saveDataToFile(): Promise<void>;
  loadDataFromFile(): Promise<void>;
}

export function getImageTaggingPlugin(app: App): ImageTaggingPlugin | null {
  const plugin = app.plugins.plugins['image-tagging-obsidian'];
  if (plugin) {
    return plugin as ImageTaggingPlugin;
  }
  return null;
}

/**
 * 获取图片分辨率信息，使用缓存避免重复加载
 * @param file - Obsidian TFile对象
 * @param app - Obsidian App实例
 * @returns 包含宽度、高度和分辨率字符串的对象，失败时返回null
 */
export async function getImageResolutionWithCache(file: TFile, app: any): Promise<{width: number, height: number, resolution: string} | null> {
  const filePath = file.path;
  const cached = imageInfoCache.get(filePath);
  
  // 检查缓存是否有效
  if (cached) {
    const now = Date.now();
    if (now - cached.lastFetchTime < CACHE_EXPIRY_TIME && file.stat.mtime <= cached.lastFetchTime) {
      // 缓存有效，直接返回
      return {
        width: cached.width,
        height: cached.height,
        resolution: cached.resolution
      };
    }
  }
  
  try {
    // 获取图片资源路径
    const fileUrl = app.vault.getResourcePath(file);
    
    // 创建一个Promise来等待图片加载完成
    const loadImage = (src: string): Promise<{width: number, height: number} | null> => {
      return new Promise((resolve) => {
        const tempImg = new Image();
        tempImg.onload = () => {
          resolve({ 
            width: tempImg.width, 
            height: tempImg.height 
          });
        };
        tempImg.onerror = () => resolve(null);
        tempImg.src = src;
      });
    };
    
    const dimensions = await loadImage(fileUrl);
    
    if (dimensions) {
      const resolution = `${dimensions.width}x${dimensions.height}`;
      const cacheData: CachedImageInfo = {
        width: dimensions.width,
        height: dimensions.height,
        resolution,
        lastFetchTime: Date.now()
      };
      
      imageInfoCache.set(filePath, cacheData);
      
      return {
        width: dimensions.width,
        height: dimensions.height,
        resolution
      };
    }
    
    return null;
  } catch (e) {
    console.warn(`无法获取图片分辨率: ${filePath}`, e);
    return null;
  }
}

/**
 * 清除特定文件的缓存
 * @param filePath - 文件路径
 */
export function clearImageCache(filePath: string) {
  imageInfoCache.delete(filePath);
}

/**
 * 清除所有缓存
 */
export function clearAllImageCache() {
  imageInfoCache.clear();
}

/**
 * 预加载图片信息到缓存
 * @param files - 要预加载的文件数组
 * @param app - Obsidian App实例
 */
export async function preloadImageInfo(files: TFile[], app: any, maxConcurrent = 5) {
  const results: Array<{file: TFile, result: {width: number, height: number, resolution: string} | null}> = [];
  
  // 分批处理，避免同时加载过多图片导致性能问题
  for (let i = 0; i < files.length; i += maxConcurrent) {
    const batch = files.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(file => 
      getImageResolutionWithCache(file, app)
        .then(result => ({ file, result }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}