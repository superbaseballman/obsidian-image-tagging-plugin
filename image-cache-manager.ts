/**
 * 高性能图片加载和缓存管理器
 */
import { TFile, App } from 'obsidian';
import { Logger } from './logger';
import { CACHE_EXPIRY_TIME } from './constants';

// 图片信息缓存接口
export interface CachedImageInfo {
  width: number;
  height: number;
  resolution: string;
  lastFetchTime: number;
}

// 缓存图片信息，避免重复加载
const imageInfoCache = new Map<string, CachedImageInfo>();

// 图片加载队列，避免重复请求
const loadingQueue = new Map<string, Promise<{width: number, height: number, resolution: string} | null>>();

export class ImageCacheManager {
  /**
   * 获取图片分辨率信息，使用缓存避免重复加载
   * @param file - Obsidian TFile对象
   * @param app - Obsidian App实例
   * @returns 包含宽度、高度和分辨率字符串的对象，失败时返回null
   */
  static async getImageResolutionWithCache(file: TFile, app: App): Promise<{width: number, height: number, resolution: string} | null> {
    const filePath = file.path;
    
    // 检查加载队列，避免重复请求
    if (loadingQueue.has(filePath)) {
      return loadingQueue.get(filePath)!;
    }
    
    // 检查缓存是否有效
    const cached = imageInfoCache.get(filePath);
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
    
    // 创建加载任务并添加到队列
    const loadTask = this.loadImageResolution(file, app, filePath);
    loadingQueue.set(filePath, loadTask);
    
    try {
      const result = await loadTask;
      return result;
    } finally {
      // 完成后从队列中移除
      loadingQueue.delete(filePath);
    }
  }
  
  private static async loadImageResolution(file: TFile, app: App, filePath: string): Promise<{width: number, height: number, resolution: string} | null> {
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
          tempImg.onerror = () => {
            Logger.warn(`加载图片失败: ${src}`);
            resolve(null);
          };
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
      Logger.warn(`无法获取图片分辨率: ${filePath}`, e);
      return null;
    }
  }
  
  /**
   * 清除特定文件的缓存
   * @param filePath - 文件路径
   */
  static clearImageCache(filePath: string) {
    imageInfoCache.delete(filePath);
  }
  
  /**
   * 清除所有缓存
   */
  static clearAllImageCache() {
    imageInfoCache.clear();
  }
  
  /**
   * 获取缓存大小
   */
  static getCacheSize(): number {
    return imageInfoCache.size;
  }
  
  /**
   * 预加载图片信息到缓存
   * @param files - 要预加载的文件数组
   * @param app - Obsidian App实例
   * @param maxConcurrent - 最大并发数
   */
  static async preloadImageInfo(files: TFile[], app: App, maxConcurrent = 5) {
    const results: Array<{file: TFile, result: {width: number, height: number, resolution: string} | null}> = [];
    
    // 分批处理，避免同时加载过多图片导致性能问题
    for (let i = 0; i < files.length; i += maxConcurrent) {
      const batch = files.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(file => 
        this.getImageResolutionWithCache(file, app)
          .then(result => ({ file, result }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }
}