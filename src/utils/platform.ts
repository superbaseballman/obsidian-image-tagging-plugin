/**
 * 平台相关工具：统一收口桌面端（Electron）与移动端（Capacitor）的能力差异。
 *
 * Android / iOS 端没有 Node 运行时，也没有 Electron 的 dialog / shell，
 * 因此所有桌面专属能力（系统默认应用打开、文件对话框、绝对路径读写）
 * 都必须先经过这里的判断，避免在移动端抛出 "require is not defined"。
 */
import { App, FileSystemAdapter, Platform, TFile } from 'obsidian';
import { Logger } from './logger';

/** 是否运行在桌面端（Electron） */
export function isDesktopApp(): boolean {
  return Platform.isDesktopApp === true;
}

/** 是否运行在移动端（Android / iOS） */
export function isMobileApp(): boolean {
  return Platform.isMobileApp === true;
}

/** 当前平台是否可以使用 Electron 的对话框能力 */
export function canUseElectronDialog(): boolean {
  const electron = getElectron();
  return !!(electron?.remote?.dialog || electron?.dialog);
}

/**
 * 安全获取 Electron 模块（仅桌面端返回，移动端 / 失败返回 null）。
 * 移动端 WebView 没有 require，直接调用会抛 "require is not defined"。
 */
export function getElectron(): any | null {
  if (!isDesktopApp()) return null;
  try {
    return require('electron');
  } catch (e) {
    Logger.debug('Electron 模块不可用:', e);
    return null;
  }
}

/** 安全获取 Node 的 fs 模块（仅桌面端可用，移动端返回 null） */
export function getNodeFs(): any | null {
  if (!isDesktopApp()) return null;
  try {
    return require('fs');
  } catch (e) {
    Logger.debug('fs 模块不可用:', e);
    return null;
  }
}

/** 当前系统的路径分隔符（移动端退回 '/'） */
export function getPathSeparator(): string {
  if (!isDesktopApp()) return '/';
  try {
    return require('path').sep as string;
  } catch {
    return '/';
  }
}

/** Electron 对话框的最小接口（避免依赖 electron 的类型声明） */
export interface ElectronDialogLike {
  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(options: {
    title?: string;
    properties?: string[];
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * 安全获取 Electron 的文件对话框。
 * 兼容新旧 Obsidian：优先 remote.dialog，其次直接 dialog；不可用时返回 null。
 */
export function getElectronDialog(): ElectronDialogLike | null {
  const electron = getElectron();
  const dialog = electron?.remote?.dialog || electron?.dialog;
  return (dialog as ElectronDialogLike) || null;
}

/**
 * 用系统默认应用打开文件（仅桌面端）。
 * @returns 是否已成功发起打开操作；移动端或失败返回 false
 */
export function openFileWithDefaultApp(app: App, file: TFile): boolean {
  if (!isDesktopApp()) return false;
  try {
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const fullPath = adapter.getFullPath(file.path);
      const electron = getElectron();
      if (!electron?.shell?.openPath) return false;
      void electron.shell.openPath(fullPath);
      return true;
    }
  } catch (e) {
    Logger.warn('调用系统默认应用打开文件失败:', e);
  }
  return false;
}

/** 获取库所在文件系统的绝对路径（仅桌面端可用，移动端返回空串） */
export function getVaultBasePath(app: App): string {
  if (!isDesktopApp()) return '';
  try {
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
  } catch (e) {
    Logger.debug('获取库绝对路径失败:', e);
  }
  return '';
}
