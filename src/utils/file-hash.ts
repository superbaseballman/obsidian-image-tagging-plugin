import { App, TFile } from 'obsidian';
import { md5Bytes } from './md5';

/**
 * 文件内容 MD5 缓存：key = `路径|最后修改时间|大小`。
 * 同一文件内容未变化时（重复扫描、重复触发 ensure）直接命中缓存，
 * 避免反复读取整个文件并计算 MD5。
 */
const fileMd5Cache = new Map<string, string>();
const MAX_MD5_CACHE_ENTRIES = 5000;

/**
 * 计算文件内容 MD5（十六进制小写），作为媒体记录的唯一 id。
 *
 * 使用纯 TypeScript 的 MD5 实现，不依赖 Node 的 crypto / Buffer，
 * 因此桌面端与 Android / iOS 移动端行为一致，同一文件得到相同的 id。
 */
export async function getFileMd5(file: TFile, app: App): Promise<string> {
  const cacheKey = `${file.path}|${file.stat?.mtime ?? 0}|${file.stat?.size ?? 0}`;
  const cached = fileMd5Cache.get(cacheKey);
  if (cached) return cached;

  const data = await app.vault.readBinary(file);
  const hash = md5Bytes(new Uint8Array(data));

  if (fileMd5Cache.size >= MAX_MD5_CACHE_ENTRIES) {
    fileMd5Cache.clear();
  }
  fileMd5Cache.set(cacheKey, hash);
  return hash;
}

/** 清除文件 MD5 缓存（例如批量重命名 / 内容批量变更后调用） */
export function clearFileMd5Cache(): void {
  fileMd5Cache.clear();
}