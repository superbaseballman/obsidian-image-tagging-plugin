/**
 * 纯 TypeScript 的 MD5 实现（不依赖 Node 的 crypto / Buffer）。
 *
 * 目的：让插件在 Obsidian 移动端（Android / iOS，运行在 Capacitor WebView 中，
 * 没有 Node 运行时与 Buffer）也能计算文件内容指纹。
 *
 * 输出与 Node 的 `createHash('md5').update(data).digest('hex')` 完全一致，
 * 因此桌面端与移动端对同一文件会得到相同的记录 id，数据可互通。
 *
 * 算法参考公开领域的 MD5 参考实现（RFC 1321）。
 */

const HEX_CHARS = '0123456789abcdef';

/** 32 位无符号加法 */
function add32(a: number, b: number): number {
  return (a + b) & 0xffffffff;
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  a = add32(add32(a, q), add32(x, t));
  return add32((a << s) | (a >>> (32 - s)), b);
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & c) | (~b & d), a, b, x, s, t);
}

function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn((b & d) | (c & ~d), a, b, x, s, t);
}

function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(b ^ c ^ d, a, b, x, s, t);
}

function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  return cmn(c ^ (b | ~d), a, b, x, s, t);
}

/** 处理一个 64 字节分组 */
function md5cycle(x: number[], k: number[]): void {
  let a = x[0];
  let b = x[1];
  let c = x[2];
  let d = x[3];

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259);
  b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = add32(a, x[0]);
  x[1] = add32(b, x[1]);
  x[2] = add32(c, x[2]);
  x[3] = add32(d, x[3]);
}

/** 读取从 offset 开始的 64 字节，转换为 16 个 32 位小端字 */
function md5blk(s: Uint8Array, offset: number): number[] {
  const words: number[] = [];
  for (let i = 0; i < 64; i += 4) {
    words[i >> 2] =
      s[offset + i] |
      (s[offset + i + 1] << 8) |
      (s[offset + i + 2] << 16) |
      (s[offset + i + 3] << 24);
  }
  return words;
}

/** 计算字节数组的 MD5 状态字 */
function md5state(bytes: Uint8Array): number[] {
  const n = bytes.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];

  let i: number;
  for (i = 64; i <= n; i += 64) {
    md5cycle(state, md5blk(bytes, i - 64));
  }

  // 处理最后不足 64 字节的尾块并补位
  const tailStart = n - (n % 64);
  let tail: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const remainder = n % 64;
  for (i = 0; i < remainder; i++) {
    tail[i >> 2] |= bytes[tailStart + i] << ((i % 4) << 3);
  }
  tail[remainder >> 2] |= 0x80 << ((remainder % 4) << 3);
  if (remainder > 55) {
    md5cycle(state, tail);
    tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }
  // 以比特为单位的长度（低 32 位写入第 14 个字，MD5 的 64 位长度此处高位为 0）
  tail[14] = n * 8;
  md5cycle(state, tail);

  return state;
}

/** 将 32 位字按小端输出为 8 位十六进制字符 */
function wordToHex(value: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    const byte = (value >> (i * 8)) & 0xff;
    out += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0x0f);
  }
  return out;
}

/**
 * 计算字节数组的 MD5 十六进制字符串（小写，32 位）。
 * 与 Node `crypto` 的 md5 输出一致。
 */
export function md5Bytes(bytes: Uint8Array): string {
  const state = md5state(bytes);
  return wordToHex(state[0]) + wordToHex(state[1]) + wordToHex(state[2]) + wordToHex(state[3]);
}
