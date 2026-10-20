# Image Tagging

An Obsidian plugin that adds tag management, description editing and a gallery view for image and video attachments.

## Features

- **Tag management** – attach custom tags to any image or video attachment for easier classification and retrieval
- **Gallery view** – browse every attachment in the vault with a paginated grid layout
- **Info panel** – view and edit the title, description and tags of the active media file in the sidebar
- **Search and filter** – find media quickly by tag, title, description or file name
- **Batch scanning** – index all images in the entire vault, or restrict scanning to selected folders
- **Page image extraction** – collect all images referenced by the current note
- **SQLite storage** – media records are stored in `.obsidian/image-tags.db`, avoiding a full JSON rewrite on every change
- **MD5 identifier** – records are keyed by the file content MD5, so renaming a file keeps its tags and description
- **Mobile support** – works on desktop and on Android / iOS

## Installation

1. Download `main.js`, `manifest.json` and `styles.css` from the release matching your Obsidian version.
2. Copy the three files into `<your-vault>/.obsidian/plugins/image-tagging/`.
3. Reload Obsidian and enable **Image Tagging** in *Settings → Community plugins*.

> Requires Obsidian 1.13.0 or newer (the settings tab uses the declarative settings API so it appears in settings search).

### Building from source

```bash
npm install
npm run build
```

The build produces `main.js`, `manifest.json` and `styles.css`, which are the only files needed by the plugin.

## Usage

1. After enabling the plugin, open the command palette (`Ctrl/Cmd+P`) and use:
   - **打开图片图库** – open the gallery view
   - **打开图片信息面板** – open the sidebar info panel
   - **扫描库中的所有图片** – scan and index every image in the vault
   - **从当前页面提取图片** – collect images referenced by the current note
2. In the gallery view you can browse all media, search by tag / title / description, open a detail view, and add or edit tags.
3. Selecting an image file automatically shows its details in the info panel, where the title, description and tags can be edited.

## Configuration

- **Legacy JSON data path** – only used on first upgrade to locate data written by older versions
- **Supported formats** – image file extensions handled by the plugin
- **Auto tag on import** – whether a record is created automatically when a new image is added to the vault
- **Scan folders** – pick one or more folders to restrict scanning; with no folder selected the whole vault is scanned

## Platform support

The plugin supports both desktop and mobile (Android / iOS):

- Storage uses the asm.js build of `sql.js` (`.obsidian/image-tags.db`), so no native desktop module is required
- File fingerprints are computed with a pure TypeScript MD5 implementation, without Node's `crypto` / `Buffer`
- *Export JSON* opens a native "Save as" dialog on desktop and writes a vault file on mobile
- *Import JSON* opens a native "Open file" dialog on desktop and picks a vault file on mobile
- *Open with default app* is desktop-only and is hidden on mobile

## Data migration

Data is stored in `.obsidian/image-tags.db`. On first start the plugin reads the legacy JSON path from settings plus the common old locations. The old JSON file is deleted only after the SQLite write succeeds; if migration fails the source file is kept.

Record IDs are the content MD5 of the file. Renaming a file keeps the ID, while changing the content makes the plugin inherit the existing tags, title and description by path and generate a new MD5 ID.

## Startup performance

- Settings are no longer awaited synchronously during `onload`; the UI renders first and settings merge in asynchronously
- `sql.js` initialization and the database read are deferred to an idle callback after the layout is ready
- Restored gallery leaves load once layout and plugin data are ready
- A single delegated `contextmenu` listener avoids duplicate menus and extra startup cost

---

# 中文说明

## 简介

这是一个功能丰富的 Obsidian 插件，提供图片标签管理和图库视图功能。

## 功能特性

- **图片标签管理**：为图片添加自定义标签，方便分类和检索
- **图库视图**：可视化展示所有图片，支持网格布局
- **图片信息面板**：在侧边栏查看和编辑图片的详细信息
- **搜索和过滤**：通过标签或关键词快速查找图片
- **批量扫描**：自动扫描库中的所有图片文件
- **页面图片提取**：从当前页面提取所有图片并添加到标签系统
- **SQLite 存储**：使用 SQLite 数据库存储媒体信息，减少频繁 JSON 全量读写
- **MD5 标识**：以文件内容 MD5 作为记录 ID，重命名不会改变标签和描述

## 构建说明

插件已成功构建，生成的文件包括：

- `main.js` - 插件的主要 JavaScript 代码
- `styles.css` - 插件的样式文件
- `manifest.json` - 插件的元数据信息

## 安装方法

1. 将以下文件复制到您的 Obsidian 库的 `.obsidian/plugins/` 目录下：
   - `main.js`
   - `styles.css`
   - `manifest.json`

2. 在 Obsidian 设置中启用插件

> 需要 Obsidian 1.13.0 或更高版本（设置页使用声明式设置 API，以便出现在设置搜索中）。

## 使用方法

1. 启用插件后，您可以通过命令面板 (`Ctrl/Cmd+P`) 访问以下功能：
   - "打开图片图库" - 打开可视化图库视图
   - "打开图片信息面板" - 打开侧边栏图片信息面板
   - "扫描库中的所有图片" - 扫描并索引库中的所有图片
   - "从当前页面提取图片" - 从当前页面提取图片并添加到标签系统

2. 在图库视图中，您可以：
   - 浏览所有图片
   - 按标签、标题或描述搜索图片
   - 查看图片详细信息
   - 添加或编辑标签

3. 当打开图片文件时，图片信息面板会自动显示该图片的详细信息，您可以编辑标题、描述和标签。

## 配置选项

- 旧 JSON 数据路径：仅用于首次升级时定位旧版本数据
- 支持的图片格式：自定义插件处理的图片文件格式
- 导入时自动添加标签：当新图片添加到库中时是否自动创建标签数据项
- 扫描指定文件夹：通过文件夹选择器挑选需要扫描的文件夹，可添加多个；未添加任何文件夹时扫描整个库

## 平台支持

插件同时支持 Obsidian 桌面端与移动端（Android / iOS）：

- 数据存储使用 `sql.js` 的 asm.js 构建（`.obsidian/image-tags.db`），不依赖桌面端原生模块，移动端同样可用
- 文件内容指纹使用纯 TypeScript 实现的 MD5，不依赖 Node 的 `crypto` / `Buffer`
- 「导出 JSON」在桌面端会弹出系统「另存为」对话框；移动端会写入库内文件
- 「导入 JSON」在桌面端会弹出系统「打开文件」对话框；移动端会从库内选择 JSON 文件
- 「用默认软件打开」为桌面端专属功能，移动端不显示该行为

## 数据迁移

当前版本将数据保存到 `.obsidian/image-tags.db`，插件首次启动时会自动读取设置中的旧 JSON 路径以及常见旧路径。迁移成功并完成 SQLite 写入后，旧 JSON 文件会被删除；迁移失败时不会删除源文件。

媒体记录的 ID 是文件内容的 MD5。文件重命名时 ID 保持不变；文件内容发生变化时，插件按原路径继承标签、标题和描述等数据，并为新内容生成新的 MD5 ID。

## 启动性能

- 插件启用时不再同步等待设置读取，界面先完成渲染，设置随后异步合并生效
- `sql.js` 初始化与数据库读取推迟到布局就绪后的浏览器空闲时机执行
- 启动时恢复的媒体图库标签页会在布局和插件数据就绪后自动加载；分类导航使用已加载的设置
- 仅注册一份 `contextmenu` 委托监听器，避免重复菜单与多余的启动开销

## 技术架构

此插件使用以下组件：
- 图片数据模型 (image-data-model.ts) - 管理图片元数据
- 图片信息视图 (image-info-view.ts) - 侧边栏信息面板
- 图库视图 (gallery-view.ts) - 主要的图库界面
- 选择器模态框 (suggest-modals.ts) - 文件夹 / 库内文件选择器，桌面端与移动端通用
- 平台工具 (platform.ts) - 收口桌面端与移动端的能力差异（Electron、fs、路径）
- 纯 TS MD5 (md5.ts) - 不依赖 Node 运行时计算文件内容指纹
- 样式文件 (styles.css) - 定制化界面样式