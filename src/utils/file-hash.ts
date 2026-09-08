/// <reference types="node" />
import { createHash } from 'crypto';
import { App, TFile } from 'obsidian';

export async function getFileMd5(file: TFile, app: App): Promise<string> {
  const data = await app.vault.readBinary(file);
  return createHash('md5').update(Buffer.from(data)).digest('hex');
}