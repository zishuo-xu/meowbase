import type { EvidenceEntry, EvidenceKind } from './types.js';

const KINDS: readonly EvidenceKind[] = ['fact', 'lesson', 'decision'];

export function evidenceFileName(id: string): string {
  return `${id}.md`;
}

export function formatEvidenceMarkdown(entry: Pick<EvidenceEntry, 'id' | 'kind' | 'title' | 'content' | 'threadId' | 'confirmedAt'>): string {
  const confirmedAt = entry.confirmedAt ?? '';
  return (
    `---\n` +
    `id: ${entry.id}\n` +
    `kind: ${entry.kind}\n` +
    `title: ${escapeYaml(entry.title)}\n` +
    `threadId: ${entry.threadId}\n` +
    `confirmedAt: ${confirmedAt}\n` +
    `---\n\n` +
    `${entry.content.trim()}\n`
  );
}

export function parseEvidenceMarkdown(text: string): EvidenceEntry | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const head = match[1] ?? '';
  const body = (match[2] ?? '').trim();
  const fields = parseFrontmatter(head);
  const id = fields.id?.trim();
  const kind = fields.kind?.trim();
  const title = fields.title?.trim();
  const threadId = fields.threadId?.trim();
  if (!id || !id.startsWith('ev_') || !title || !threadId) return null;
  if (!KINDS.includes(kind as EvidenceKind)) return null;
  return {
    id,
    threadId,
    kind: kind as EvidenceKind,
    title,
    content: body,
    status: 'confirmed',
    createdAt: fields.confirmedAt?.trim() || new Date(0).toISOString(),
    ...(fields.confirmedAt?.trim() ? { confirmedAt: fields.confirmedAt.trim() } : {}),
  };
}

function parseFrontmatter(head: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = unquote(line.slice(idx + 1).trim());
    if (key) out[key] = value;
  }
  return out;
}

function escapeYaml(value: string): string {
  if (/[:#\n]/.test(value) || value.includes('"')) return JSON.stringify(value);
  return value;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
