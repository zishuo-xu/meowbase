import { basename } from 'node:path';
import { canonicalizePath } from './repo-path.js';
import type { EvidenceEntry } from './types.js';

/** 召回范围用的线程侧写。只有 id / 仓路径 / 标题,不往证据上加仓库字段。 */
export interface EvidenceScopeThread {
  id: string;
  title: string;
  repoPath?: string;
}

export function toEvidenceScopeThread(thread: {
  id: string;
  title: string;
  repo?: { path?: string };
}): EvidenceScopeThread {
  return {
    id: thread.id,
    title: thread.title,
    ...(thread.repo?.path ? { repoPath: thread.repo.path } : {}),
  };
}

const RECALL_CUE =
  /之前|当时决定|我们约定|讨论过|当时对.{0,12}怎么|我们(当时)?(是怎么)?决定/;

const STOP = new Set([
  '之前',
  '当时',
  '决定',
  '约定',
  '讨论',
  '讨论过',
  '我们',
  '怎么',
  '怎样',
  '什么',
  '关于',
  '这个',
  '那个',
  '一下',
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '对',
  '用',
  '再',
  '请',
  '帮',
  '看',
  '看看',
]);

export function wantsEvidenceRecall(text: string): boolean {
  return RECALL_CUE.test(text);
}

export function tokenizeEvidenceQuery(text: string): string[] {
  const found = text.toLowerCase().match(/[a-z][a-z0-9._-]{1,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  return [...new Set(found.filter((token) => !STOP.has(token)))];
}

/** 人说「之前/约定」时,从已确认证据里按标题和正文做关键词匹配。不向量、不摘要。 */
export function matchEvidence(
  query: string,
  entries: readonly EvidenceEntry[],
  limit = 3,
): EvidenceEntry[] {
  if (!wantsEvidenceRecall(query)) return [];
  const tokens = tokenizeEvidenceQuery(query);
  if (tokens.length === 0) return [];

  return entries
    .filter((entry) => entry.status === 'confirmed')
    .map((entry) => {
      const hay = `${entry.title} ${entry.content}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (!hay.includes(token)) continue;
        score += token.length >= 4 ? 2 : 1;
        if (entry.title.toLowerCase().includes(token)) score += 2;
      }
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
    .slice(0, limit)
    .map((row) => row.entry);
}

function sameRepo(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return canonicalizePath(a) === canonicalizePath(b);
}

/**
 * 当前线程绑了仓 → 候选是绑同一个仓的线程产出的证据。
 * 当前线程没绑仓(空沙箱) → 候选只有本线程自己的。
 */
export function filterEvidenceByRecallScope(
  entries: readonly EvidenceEntry[],
  current: { threadId: string; repoPath?: string },
  threads: readonly EvidenceScopeThread[],
): EvidenceEntry[] {
  const repoByThread = new Map(threads.map((t) => [t.id, t.repoPath]));
  const currentRepo = current.repoPath ?? repoByThread.get(current.threadId);
  if (!currentRepo) {
    return entries.filter((entry) => entry.threadId === current.threadId);
  }
  return entries.filter((entry) => sameRepo(repoByThread.get(entry.threadId), currentRepo));
}

export function evidenceSourceLabel(
  entry: EvidenceEntry,
  threads: readonly EvidenceScopeThread[],
): string {
  const thread = threads.find((item) => item.id === entry.threadId);
  if (thread?.repoPath) return basename(canonicalizePath(thread.repoPath));
  return thread?.title || entry.threadId;
}

export function formatEvidenceConfirmedAt(confirmedAt: string | undefined): string {
  if (!confirmedAt) return '确认时间未记';
  const day = confirmedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '确认时间未记';
}

export function formatEvidenceInjectionLine(
  entry: EvidenceEntry,
  threads: readonly EvidenceScopeThread[] = [],
): string {
  const when = entry.confirmedAt
    ? `确认于 ${formatEvidenceConfirmedAt(entry.confirmedAt)}`
    : '确认时间未记';
  return `- [${entry.kind}] ${entry.title}(${entry.id} · 来自 ${evidenceSourceLabel(entry, threads)} · ${when}): ${entry.content}`;
}
