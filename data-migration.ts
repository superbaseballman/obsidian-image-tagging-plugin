import { MediaData } from './image-data-model';
import { getMediaType } from './image-data-model';
import { TFile, App } from 'obsidian';
import { Logger } from './logger';

/**
 * 数据迁移接口 - 用于处理旧版本数据格式
 */
export interface LegacyImageData {
  id: string;
  path: string;
  title: string;
  tags: string[];
  date: string;
  size: string;
  resolution: string;
  format: string;
  description: string;
  originalName: string;
  lastModified: number;
  width?: number;
  height?: number;
  fileSize?: number;
  // 注意：旧版本没有 'type' 字段
}

/**
 * 数据迁移工具类
 * 用于将旧版本的数据格式迁移到新版本
 */
export class DataMigration {
  /**
   * 检查数据是否为旧版本格式
   * 通过检查是否存在 'type' 字段来判断
   */
  static isLegacyFormat(data: any[]): boolean {
    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }
    
    // 检查第一个元素是否有 'type' 字段
    const firstItem = data[0];
    return !firstItem.hasOwnProperty('type');
  }

  /**
   * 将旧版本数据转换为新版本数据
   * @param legacyData 旧版本数据数组
   * @returns 转换后的新版本数据数组
   */
  static migrateFromLegacy(legacyData: LegacyImageData[]): MediaData[] {
    Logger.info(`开始迁移 ${legacyData.length} 条旧版本数据记录`);
    
    const migratedData: MediaData[] = legacyData.map(item => {
      // 根据文件扩展名确定媒体类型
      const pathParts = item.path.split('.');
      const extension = pathParts.length > 0 ? pathParts[pathParts.length - 1].toLowerCase() : '';
      
      // 使用 getMediaType 函数确定媒体类型
      let mediaType: 'image' | 'video' | 'audio' = 'image'; // 默认为图片
      if (extension) {
        // 临时创建一个对象来使用 getMediaType 函数
        const tempFile = {
          extension: extension
        } as TFile;
        
        const detectedType = getMediaType(tempFile);
        if (detectedType) {
          mediaType = detectedType;
        }
      }
      
      // 创建新版本的数据对象，添加缺失的 'type' 字段
      const newData: MediaData = {
        ...item,  // 复制所有旧数据字段
        type: mediaType  // 添加新的媒体类型字段
      };
      
      return newData;
    });
    
    Logger.info(`完成迁移，转换了 ${migratedData.length} 条数据记录`);
    return migratedData;
  }

  /**
   * 尝试从 JSON 字符串加载数据，自动检测并处理旧版本格式
   * @param jsonData JSON 数据字符串
   * @returns 解析后的 MediaData 数组
   */
  static loadDataWithMigration(jsonData: string): MediaData[] {
    try {
      const parsed = JSON.parse(jsonData);
      
      if (!Array.isArray(parsed)) {
        Logger.error('解析的数据不是数组格式');
        return [];
      }
      
      if (this.isLegacyFormat(parsed)) {
        Logger.info('检测到旧版本数据格式，开始迁移...');
        const legacyData = parsed as LegacyImageData[];
        return this.migrateFromLegacy(legacyData);
      } else {
        // 如果是新版本格式，直接返回
        return parsed as MediaData[];
      }
    } catch (error) {
      Logger.error('解析 JSON 数据失败:', error);
      throw error;
    }
  }

  /**
   * 迁移旧版本的 JSON 文件
   * @param oldFilePath 旧版本文件路径
   * @param newFilePath 新版本文件路径
   * @returns 迁移是否成功
   */
  static async migrateLegacyFile(app: App, oldFilePath: string, newFilePath?: string): Promise<boolean> {
    try {
      // 检查旧文件是否存在
      if (!await app.vault.adapter.exists(oldFilePath)) {
        Logger.warn(`旧版本数据文件不存在: ${oldFilePath}`);
        return false;
      }

      // 读取旧版本数据
      const jsonData = await app.vault.adapter.read(oldFilePath);
      
      // 解析并迁移数据
      const migratedData = this.loadDataWithMigration(jsonData);
      
      // 确定保存路径
      const savePath = newFilePath || oldFilePath;
      
      // 确保目录存在
      const dirPath = savePath.substring(0, savePath.lastIndexOf('/'));
      if (dirPath && !(await app.vault.adapter.exists(dirPath))) {
        await app.vault.adapter.mkdir(dirPath);
      }
      
      // 保存迁移后的数据
      const migratedJsonData = JSON.stringify(migratedData, null, 2);
      await app.vault.adapter.write(savePath, migratedJsonData);
      
      Logger.info(`数据迁移完成，已保存到: ${savePath}`);
      return true;
    } catch (error) {
      Logger.error('迁移旧版本数据文件失败:', error);
      return false;
    }
  }
}