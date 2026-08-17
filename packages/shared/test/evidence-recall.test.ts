import { describe, expect, it } from 'vitest';
import { matchEvidence, wantsEvidenceRecall } from '../src/evidence-recall.js';
import type { EvidenceEntry } from '../src/types.js';

function ev(partial: Partial<EvidenceEntry> & Pick<EvidenceEntry, 'id' | 'title' | 'content'>): EvidenceEntry {
  return {
    threadId: 't1',
    kind: 'decision',
    status: 'confirmed',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...partial,
  };
}

describe('wantsEvidenceRecall', () => {
  it('认出之前/约定/讨论过', () => {
    expect(wantsEvidenceRecall('之前我们约定用 TypeScript')).toBe(true);
    expect(wantsEvidenceRecall('当时决定过栈的容量怎么算')).toBe(true);
    expect(wantsEvidenceRecall('我们讨论过加法函数')).toBe(true);
  });

  it('普通续写不召回', () => {
    expect(wantsEvidenceRecall('继续写 stack.ts')).toBe(false);
    expect(wantsEvidenceRecall('审查一下')).toBe(false);
  });
});

describe('matchEvidence', () => {
  const ts = ev({
    id: 'ev_aaa11111',
    title: '用户偏好 TypeScript',
    content: '用户明确表示喜欢 TypeScript',
  });
  const lru = ev({
    id: 'ev_bbb22222',
    title: 'LRU 容量',
    content: '默认容量 16',
    createdAt: '2026-08-18T01:00:00.000Z',
  });
  const draft = ev({
    id: 'ev_ccc33333',
    title: '用户偏好 TypeScript',
    content: '还没确认',
    status: 'draft',
  });

  it('无召回意图时不匹配', () => {
    expect(matchEvidence('继续写', [ts])).toEqual([]);
  });

  it('按标题和正文关键词命中已确认证据', () => {
    expect(matchEvidence('之前我们约定用 TypeScript', [ts, lru]).map((e) => e.id)).toEqual([
      'ev_aaa11111',
    ]);
  });

  it('draft 不召回', () => {
    expect(matchEvidence('之前我们约定用 TypeScript', [draft])).toEqual([]);
  });

  it('没有重叠词就不灌全部记忆', () => {
    expect(matchEvidence('之前我们讨论过晚饭吃什么', [ts, lru])).toEqual([]);
  });
});
