import type { EvidenceEntry } from './types.js';

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
