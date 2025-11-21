import { build } from 'esbuild';

const isDev = process.argv.includes('--dev');

build({
  entryPoints: ['main.ts'],
  bundle: true,
  format: 'cjs',
  minify: !isDev,
  platform: 'node',
  outfile: 'main.js',
  external: ['obsidian'],
  logLevel: 'info',
  sourcemap: isDev,
}).catch(() => process.exit(1));