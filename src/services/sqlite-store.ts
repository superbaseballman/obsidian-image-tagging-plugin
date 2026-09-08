import initSqlJs, { Database } from 'sql.js/dist/sql-asm.js';
import { App, DataAdapter } from 'obsidian';
import { MediaData } from '../models/image-data-model';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    tags TEXT NOT NULL, date TEXT NOT NULL, size TEXT NOT NULL,
    resolution TEXT NOT NULL, format TEXT NOT NULL, description TEXT NOT NULL,
    original_name TEXT NOT NULL, last_modified INTEGER NOT NULL, width INTEGER,
    height INTEGER, file_size INTEGER, type TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_path ON media(path);
`;

export class SqliteStore {
  private database: Database | null = null;
  private readonly adapter: DataAdapter;

  constructor(private readonly app: App, private readonly databasePath: string) {
    this.adapter = app.vault.adapter;
  }

  async load(): Promise<MediaData[]> {
    const database = await this.open();
    const result = database.exec('SELECT * FROM media ORDER BY rowid');
    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
      id: String(row[0]), path: String(row[1]), title: String(row[2]),
      tags: this.parseTags(row[3]), date: String(row[4]), size: String(row[5]),
      resolution: String(row[6]), format: String(row[7]), description: String(row[8]),
      originalName: String(row[9]), lastModified: Number(row[10]),
      width: row[11] == null ? undefined : Number(row[11]),
      height: row[12] == null ? undefined : Number(row[12]),
      fileSize: row[13] == null ? undefined : Number(row[13]),
      type: this.parseType(row[14])
    }));
  }

  async save(items: MediaData[]): Promise<void> {
    const database = await this.open();
    const uniqueItems = new Map<string, MediaData>();
    for (const item of items) {
      const existing = uniqueItems.get(item.id);
      if (existing && existing.path !== item.path) {
        // 同内容重复记录（id 相同、路径不同）：管理器已合并为单条，此处仅做防御。
        // 合并标签并保留先出现的记录，不再生成 md5-2 派生 id。
        existing.tags = Array.from(new Set([...existing.tags, ...item.tags]));
        continue;
      }
      uniqueItems.set(item.id, { ...item });
    }

    database.run('BEGIN TRANSACTION');
    try {
      database.run('DELETE FROM media');
      const statement = database.prepare(`
        INSERT INTO media (
          id, path, title, tags, date, size, resolution, format, description,
          original_name, last_modified, width, height, file_size, type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of uniqueItems.values()) {
        statement.run([
          item.id, item.path, item.title, JSON.stringify(item.tags), item.date,
          item.size, item.resolution, item.format, item.description, item.originalName,
          item.lastModified, item.width ?? null, item.height ?? null, item.fileSize ?? null,
          item.type
        ]);
      }
      statement.free();
      database.run('COMMIT');
      await this.flush(database);
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.database) return;
    await this.flush(this.database);
    this.database.close();
    this.database = null;
  }

  private async open(): Promise<Database> {
    if (this.database) return this.database;
    const SQL = await initSqlJs();
    const binary = await this.adapter.exists(this.databasePath)
      ? await this.adapter.readBinary(this.databasePath)
      : undefined;
    this.database = new SQL.Database(binary ? new Uint8Array(binary) : undefined);
    this.database.run(SCHEMA);
    return this.database;
  }

  private async flush(database: Database): Promise<void> {
    await this.ensureDirectory();
    await this.adapter.writeBinary(this.databasePath, database.export().buffer as ArrayBuffer);
  }

  private async ensureDirectory(): Promise<void> {
    const directory = this.databasePath.substring(0, this.databasePath.lastIndexOf('/'));
    if (!directory || await this.adapter.exists(directory)) return;
    const parts = directory.split('/');
    let current = '';
    for (const part of parts) {
      if (!part) continue;
      current += `${current ? '/' : ''}${part}`;
      if (!await this.adapter.exists(current)) await this.adapter.mkdir(current);
    }
  }

  private parseTags(value: unknown): string[] {
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseType(value: unknown): MediaData['type'] {
    return value === 'video' || value === 'audio' ? value : 'image';
  }

}