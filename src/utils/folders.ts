/**
 * 文件夹 / 扫描目录相关的公共工具。
 *
 * 原先「扫描目录判断 / 目录归一化」逻辑在 main.ts、gallery-view.ts、
 * image-info-view.ts 与 image-data-model.ts 中存在多份近同实现，这里统一收口。
 */

/**
 * 归一化文件夹路径：去首尾空白、反斜杠转正斜杠、保证以 '/' 结尾。
 * 空字符串/纯空白输入返回空字符串。
 */
export function normalizeFolderPath(path: string | undefined | null): string {
  const trimmed = (path || '').trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

/**
 * 解析出应扫描的目录列表：
 * - 优先使用多目录设置（scanMultipleFolderPaths），归一化并过滤空项；
 * - 为空时回退到旧的单目录设置（scanFolderPath）；
 * - 两者皆空则返回 []（表示扫描整个库）。
 */
export function resolveScanFolderPaths(
  scanFolderPath: string | undefined,
  scanMultipleFolderPaths: string[] | undefined
): string[] {
  const multi = (scanMultipleFolderPaths || [])
    .map((path) => normalizeFolderPath(path))
    .filter((path) => path.length > 0);
  if (multi.length > 0) return multi;

  const single = normalizeFolderPath(scanFolderPath);
  return single ? [single] : [];
}

/**
 * 判断文件路径是否落在给定目录列表中的任意一个目录内。
 * 目录列表为空表示“扫描整个库”，恒返回 true（与旧逻辑一致）。
 */
export function isFileInFolderPaths(filePath: string, folderPaths: string[]): boolean {
  if (!filePath) return false;
  if (folderPaths.length === 0) return true; // 未配置扫描目录 → 不限制
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  return folderPaths.some((folderPath) => normalizedFilePath.startsWith(folderPath));
}

/**
 * 判断文件路径是否属于当前扫描设置下的目录。
 * 便捷封装：先解析目录列表再判断。
 */
export function isFileInScanFolders(
  filePath: string,
  scanFolderPath: string | undefined,
  scanMultipleFolderPaths: string[] | undefined
): boolean {
  return isFileInFolderPaths(filePath, resolveScanFolderPaths(scanFolderPath, scanMultipleFolderPaths));
}
