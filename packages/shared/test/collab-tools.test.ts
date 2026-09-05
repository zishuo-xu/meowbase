import { describe, expect, it } from 'vitest';
import { listThreadIndex, searchMessages } from '../src/collab-tools.js';

describe('searchMessages', () => {
  const rows = [
    { id: 'm1', threadId: 't1', role: 'assistant' as const, agentId: 'claude' as const, content: '仓A斑马纹约定' },
    { id: 'm2', threadId: 't2', role: 'user' as const, content: '另一条斑马纹' },
    { id: 'm3', threadId: 't1', role: 'assistant' as const, agentId: 'gemini' as const, content: '审查通过' },
  ];

  it('空查询返回空,不扫全库', () => {
    expect(searchMessages(rows, { query: '  ' })).toEqual([]);
  });

  it('关键词大小写不敏感,可按猫过滤', () => {
    expect(searchMessages(rows, { query: '斑马' }).map((h) => h.messageId)).toEqual(['m1', 'm2']);
    expect(searchMessages(rows, { query: '斑马', agentId: 'claude' }).map((h) => h.messageId)).toEqual(['m1']);
  });

  it('摘录截断空白', () => {
    const hit = searchMessages(
      [{ id: 'm', threadId: 't', role: 'user', content: `  ${'x'.repeat(200)}  ` }],
      { query: 'xx' },
    )[0];
    expect(hit?.excerpt.endsWith('…')).toBe(true);
    expect(hit?.excerpt.length).toBeLessThanOrEqual(161);
  });
});

describe('listThreadIndex', () => {
  it('列出 id 标题主猫和阶段', () => {
    expect(
      listThreadIndex([
        { id: 't1', title: '加法', primaryAgentId: 'claude', sop: { stage: 'doing', note: '写手在干活。' } },
        { id: 't2', title: '空', primaryAgentId: 'gemini' },
      ]),
    ).toEqual([
      { id: 't1', title: '加法', primaryAgentId: 'claude', stage: 'doing' },
      { id: 't2', title: '空', primaryAgentId: 'gemini' },
    ]);
  });
});
