/**
 * 专门的错误处理工具类
 */
import { Logger } from './logger';

export class ImageTaggingError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string, details?: any) {
    super(message);
    this.name = 'ImageTaggingError';
    this.code = code;
    this.details = details;
  }
}

export class ErrorHandler {
  static handle(error: unknown, context: string = ''): void {
    if (error instanceof ImageTaggingError) {
      // 已知错误，使用 Logger 记录
      Logger.error(`[${context}] ${error.message} (Code: ${error.code})`, error.details);
    } else if (error instanceof Error) {
      // 一般错误
      Logger.error(`[${context}] ${error.message}`, error);
    } else {
      // 未知错误
      Logger.error(`[${context}] 未知错误:`, error);
    }
  }

  static async handleAsync<T>(
    operation: () => Promise<T>, 
    context: string = '', 
    fallbackValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.handle(error, context);
      if (fallbackValue !== undefined) {
        return fallbackValue;
      }
      return undefined;
    }
  }

  static validateImageData(data: unknown): data is Record<string, unknown> {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    const obj = data as Record<string, unknown>;
    return typeof obj.id === 'string' && typeof obj.path === 'string';
  }
}