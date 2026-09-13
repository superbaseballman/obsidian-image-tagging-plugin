import { build } from 'esbuild';

const isDev = process.argv.includes('--dev');

build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  minify: !isDev,
  platform: 'node',
  // 输出语法锁定在 es2018：兼容 Android / iOS 端较旧的 WebView
  target: ['es2018'],
  outfile: 'main.js',
  external: ['obsidian', 'electron'],
  logLevel: 'info',
  sourcemap: isDev,
}).catch(() => process.exit(1));