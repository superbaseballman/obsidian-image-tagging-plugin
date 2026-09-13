/**
 * 选择器模态框：桌面端与移动端通用（基于 Obsidian 的 FuzzySuggestModal，
 * 不使用 Electron 的文件对话框，因此 Android / iOS 上同样可用）。
 */
import { App, FuzzySuggestModal, Modal, TFile, TFolder } from 'obsidian';

export function confirmWithModal(app: App, message: string): Promise<boolean> {
  return new Promise(resolve => {
    const modal = new ConfirmModal(app, message, resolve);
    modal.open();
  });
}

class ConfirmModal extends Modal {
  private readonly message: string;
  private readonly resolveResult: (confirmed: boolean) => void;
  private resolved = false;

  constructor(app: App, message: string, resolveResult: (confirmed: boolean) => void) {
    super(app);
    this.message = message;
    this.resolveResult = resolveResult;
  }

  onOpen(): void {
    this.contentEl.createEl('p', { text: this.message });
    const buttons = this.contentEl.createEl('div', { cls: 'modal-button-container' });
    buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
    buttons.createEl('button', { cls: 'mod-warning', text: '确认' }).addEventListener('click', () => {
      this.resolved = true;
      this.resolveResult(true);
      this.close();
    });
  }

  onClose(): void {
    if (!this.resolved) this.resolveResult(false);
    this.contentEl.empty();
  }
}

/**
 * 文件夹选择器：列出库内所有文件夹供模糊搜索选择。
 * 用于设置中的「扫描文件夹」添加。
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  private readonly folders: TFolder[];
  private readonly onChoose: (folder: TFolder) => void;

  constructor(app: App, onChoose: (folder: TFolder) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('输入文件夹名称进行搜索…');

    const folders: TFolder[] = [];
    for (const entry of app.vault.getAllLoadedFiles()) {
      if (entry instanceof TFolder) folders.push(entry);
    }
    // 按路径排序，且把根目录放在最前（表示整个库）
    this.folders = folders.sort((a, b) => {
      if (a.isRoot() && !b.isRoot()) return -1;
      if (!a.isRoot() && b.isRoot()) return 1;
      return a.path.localeCompare(b.path);
    });
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.isRoot() ? '/（整个库）' : folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}

/**
 * 库内文件选择器：按扩展名筛选库内文件（用于移动端从库中选取 JSON 数据导入）。
 */
export class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
  private readonly files: TFile[];
  private readonly onChoose: (file: TFile) => void;

  constructor(app: App, extension: string, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    const ext = extension.replace(/^\./, '').toLowerCase();
    this.setPlaceholder('输入文件名进行搜索…');

    this.files = app.vault
      .getFiles()
      .filter((file) => file.extension.toLowerCase() === ext)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
