import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evidenceSourceLabel,
  filterEvidenceByRecallScope,
  formatEvidenceConfirmedAt,
  formatEvidenceInjectionLine,
  matchEvidence,
  wantsEvidenceRecall,
} from '../src/evidence-recall.js';
import { canonicalizePath } from '../src/repo-path.js';
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

describe('filterEvidenceByRecallScope', () => {
  const own = ev({ id: 'ev_own', title: '本线程', content: '自己的', threadId: 't-cur' });
  const sibling = ev({ id: 'ev_sib', title: '同仓', content: '共享的', threadId: 't-sib' });
  const other = ev({ id: 'ev_oth', title: '别仓', content: '不该来', threadId: 't-oth' });

  it('空沙箱只留下本线程自己的', () => {
    const scoped = filterEvidenceByRecallScope(
      [own, sibling, other],
      { threadId: 't-cur' },
      [
        { id: 't-cur', title: '实验' },
        { id: 't-sib', title: '另一个沙箱' },
        { id: 't-oth', title: '再一个' },
      ],
    );
    expect(scoped.map((e) => e.id)).toEqual(['ev_own']);
  });

  it('绑了仓则同仓跨线程共享,别的仓不进', () => {
    const scoped = filterEvidenceByRecallScope(
      [own, sibling, other],
      { threadId: 't-cur', repoPath: '/tmp/repo-a' },
      [
        { id: 't-cur', title: 'A1', repoPath: '/tmp/repo-a' },
        { id: 't-sib', title: 'A2', repoPath: '/tmp/repo-a' },
        { id: 't-oth', title: 'B', repoPath: '/tmp/repo-b' },
      ],
    );
    expect(scoped.map((e) => e.id).sort()).toEqual(['ev_own', 'ev_sib']);
  });

  it('比对仓库路径用 canonical realpath,/var 与 /private/var 算同一个仓', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meow-scope-'));
    try {
      const real = canonicalizePath(dir);
      const aliased = real.startsWith('/private/') ? real.slice('/private'.length) : dir;
      expect(canonicalizePath(aliased)).toBe(real);
      const scoped = filterEvidenceByRecallScope(
        [own, sibling],
        { threadId: 't-cur', repoPath: aliased },
        [
          { id: 't-cur', title: 'A1', repoPath: aliased },
          { id: 't-sib', title: 'A2', repoPath: real },
        ],
      );
      expect(scoped.map((e) => e.id).sort()).toEqual(['ev_own', 'ev_sib']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('formatEvidenceInjectionLine', () => {
  it('带 id、来源、确认时间;老数据写确认时间未记,不用 createdAt', () => {
    const old = ev({
      id: 'ev_old0001',
      title: '用户偏好 TS',
      content: '喜欢 TypeScript',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    const line = formatEvidenceInjectionLine(old, [{ id: 't1', title: '旧会话' }]);
    expect(line).toBe(
      '- [decision] 用户偏好 TS(ev_old0001 · 来自 旧会话 · 确认时间未记): 喜欢 TypeScript',
    );
    expect(line).not.toContain('2020-01-01');
  });

  it('有 confirmedAt 才写日期;绑仓用来源目录名', () => {
    const fresh = ev({
      id: 'ev_new0001',
      title: '栈容量',
      content: '默认 16',
      confirmedAt: '2026-08-28T15:04:05.000Z',
      threadId: 't-repo',
    });
    const line = formatEvidenceInjectionLine(fresh, [
      { id: 't-repo', title: '不该用标题', repoPath: '/src/myapp' },
    ]);
    expect(line).toBe(
      '- [decision] 栈容量(ev_new0001 · 来自 myapp · 确认于 2026-08-28): 默认 16',
    );
  });
});

describe('evidenceSourceLabel / formatEvidenceConfirmedAt', () => {
  it('没绑仓用线程标题', () => {
    expect(evidenceSourceLabel(ev({ id: 'ev_x', title: 't', content: 'c' }), [{ id: 't1', title: '实验' }])).toBe(
      '实验',
    );
  });

  it('没有 confirmedAt 绝不拿别的时间顶', () => {
    expect(formatEvidenceConfirmedAt(undefined)).toBe('确认时间未记');
    expect(formatEvidenceConfirmedAt('')).toBe('确认时间未记');
  });
});
