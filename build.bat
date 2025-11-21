@echo off
echo 正在构建 Obsidian 图片标签插件...
echo.

cd /d "C:\Users\12053\Desktop\obsidian-eagle-master\obsidian-image-tagging-plugin"

echo 1. 安装依赖...
npm install

echo 2. 构建插件...
node esbuild.config.mjs production

echo.
echo 构建完成！
echo 生成的文件：
echo - main.js
echo - main.css
echo - manifest.json
echo.
echo 您现在可以将这些文件复制到 Obsidian 的插件目录中使用。
pause