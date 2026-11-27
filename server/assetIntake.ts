import { createHash } from 'node:crypto';
import type { McpUploadResult } from '../shared/contracts.js';
import * as assets from './assets.js';
import { withSpaceLock } from './db/redis.js';
import { grantUploadedRepoFile } from './fileAccess.js';
import * as gitSync from './gitSync.js';
import * as storage from './storage.js';

export interface StoreUploadedAssetInput {
  space: string;
  pageId?: string;
  filename: string;
  data: Buffer;
  user: { id: string; name: string; email: string };
  mime?: string;
  reuseIdenticalInRepo?: boolean;
}

export async function storeUploadedAsset(input: StoreUploadedAssetInput): Promise<McpUploadResult> {
  const { space, pageId, filename, data, user } = input;
  const sha256 = createHash('sha256').update(data).digest('hex');
  const size = data.length;

  const info = await storage.getSpaceInfo(space);
  if (info?.assetMode !== 'repo') {
    const stored = await assets.putAsset(data, { mime: input.mime ?? 'application/octet-stream', filename }, user.id, pageId);
    return { sha256, size, url: stored.url };
  }

  const save = async (): Promise<{ url: string; path: string }> => {
    const existing = input.reuseIdenticalInRepo ? await storage.findRepoAssetByContent(space, filename, sha256) : null;
    return existing ?? storage.saveAssetIntoRepo(space, filename, data);
  };
  const saved = input.reuseIdenticalInRepo ? await withSpaceLock(space, save) : await save();
  if (pageId) await grantUploadedRepoFile(pageId, saved.path);
  gitSync.recordEditor(space, { name: user.name, email: user.email });
  gitSync.noteActivity(space);
  return { sha256, size, url: saved.url, path: saved.path };
}
