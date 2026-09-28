/**
 * 平台相关工具：统一收口桌面端（Electron）与移动端（Capacitor）的能力差异。
 *
 * Android / iOS 端没有 Node 运行时，也没有 Electron 的 shell，
 * 因此桌面专属能力（系统默认应用打开）必须先经过这里的判断，
 * 避免在移动端抛出 "require is not defined"。
 * JSON 数据的导入 / 导出统一走 Obsidian 的 Vault API，不再依赖 Node 的 fs 模块。
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

/**
 * 安全获取 Electron 模块（仅桌面端返回，移动端 / 失败返回 null）。
 * 移动端 WebView 没有 require，直接调用会抛 "require is not defined"。
 */
interface ElectronLike {
  shell?: { openPath(path: string): Promise<string> };
}

export async function getElectron(): Promise<ElectronLike | null> {
  if (!isDesktopApp()) return null;
  try {
    return await import('electron') as unknown as ElectronLike;
  } catch (e) {
    Logger.debug('Electron 模块不可用:', e);
    return null;
  }
}

/**
 * 用系统默认应用打开文件（仅桌面端）。
 * @returns 是否已成功发起打开操作；移动端或失败返回 false
 */
export async function openFileWithDefaultApp(app: App, file: TFile): Promise<boolean> {
  if (!isDesktopApp()) return false;
  try {
    const adapter = app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const fullPath = adapter.getFullPath(file.path);
      const electron = await getElectron();
      if (!electron?.shell?.openPath) return false;
      void electron.shell.openPath(fullPath);
      return true;
    }
  } catch (e) {
    Logger.warn('调用系统默认应用打开文件失败:', e);
  }
  return false;
}
