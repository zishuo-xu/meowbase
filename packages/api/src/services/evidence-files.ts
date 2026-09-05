import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evidenceFileName,
  formatEvidenceMarkdown,
  parseEvidenceMarkdown,
  type EvidenceEntry,
} from '@meowbase/shared';
import type { EvidenceStore } from '../stores/ports.js';

export async function materializeEvidenceFile(
  dir: string,
  entry: EvidenceEntry,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, evidenceFileName(entry.id));
  await writeFile(path, formatEvidenceMarkdown(entry), 'utf8');
  return path;
}

export async function rebuildEvidenceFromFiles(
  dir: string,
  store: Pick<EvidenceStore, 'upsertConfirmed'>,
): Promise<number> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (!/^ev_[a-f0-9]{8}\.md$/.test(name)) continue;
    const text = await readFile(join(dir, name), 'utf8');
    const entry = parseEvidenceMarkdown(text);
    if (!entry) continue;
    await store.upsertConfirmed(entry);
    count += 1;
  }
  return count;
}
