import { describe, expect, it } from 'vitest';
import { evidenceFileName, formatEvidenceMarkdown, parseEvidenceMarkdown } from '../src/evidence-files.js';

describe('evidence markdown', () => {
  it('排版再回读得到同一条确认证据', () => {
    const entry = {
      id: 'ev_ab12cd34',
      kind: 'fact' as const,
      title: '用户偏好 TS',
      content: '用户明确表示喜欢 TypeScript',
      threadId: 't1',
      confirmedAt: '2026-09-06T12:00:00.000Z',
    };
    const md = formatEvidenceMarkdown(entry);
    expect(evidenceFileName(entry.id)).toBe('ev_ab12cd34.md');
    expect(md).toContain('id: ev_ab12cd34');
    expect(md).toContain('用户明确表示喜欢 TypeScript');
    const parsed = parseEvidenceMarkdown(md);
    expect(parsed).toMatchObject({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      threadId: entry.threadId,
      status: 'confirmed',
      confirmedAt: entry.confirmedAt,
    });
  });

  it('标题含冒号也能回读', () => {
    const md = formatEvidenceMarkdown({
      id: 'ev_aaaaaaaa',
      kind: 'decision',
      title: '约定:用 TypeScript',
      content: '正文',
      threadId: 't1',
      confirmedAt: '2026-09-06T12:00:00.000Z',
    });
    expect(parseEvidenceMarkdown(md)?.title).toBe('约定:用 TypeScript');
  });

  it('没有 frontmatter 或缺 id 则 null', () => {
    expect(parseEvidenceMarkdown('只是一段话')).toBeNull();
    expect(parseEvidenceMarkdown('---\nkind: fact\n---\n正文')).toBeNull();
  });
});
