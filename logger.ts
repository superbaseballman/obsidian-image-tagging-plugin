/**
 * 统一日志管理器
 * 控制插件的日志输出级别和格式
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export class Logger {
  private static level: LogLevel = LogLevel.WARN; // 默认只显示警告和错误
  private static pluginName: string = 'Image Tagging Plugin';

  static setLogLevel(level: LogLevel) {
    this.level = level;
  }

  static setPluginName(name: string) {
    this.pluginName = name;
  }

  static debug(message: string, ...optionalParams: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.log(`[${this.pluginName}] DEBUG: ${message}`, ...optionalParams);
    }
  }

  static info(message: string, ...optionalParams: any[]) {
    if (this.level <= LogLevel.INFO) {
      console.info(`[${this.pluginName}] INFO: ${message}`, ...optionalParams);
    }
  }

  static warn(message: string, ...optionalParams: any[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[${this.pluginName}] WARN: ${message}`, ...optionalParams);
    }
  }

  static error(message: string, ...optionalParams: any[]) {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[${this.pluginName}] ERROR: ${message}`, ...optionalParams);
    }
  }
}