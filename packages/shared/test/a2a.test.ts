import { describe, expect, it } from 'vitest';
import { parseA2AHandoff, findInlineA2AMentions } from '../src/a2a.js';

describe('parseA2AHandoff', () => {
  it('行首 mention → 解析目标与任务', () => {
    expect(
      parseA2AHandoff('写完了。\n@opencode 请审查这段代码\n重点看边界条件。', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查这段代码\n重点看边界条件。' });
  });

  it('行首中文名与英文 id 等价', () => {
    expect(
      parseA2AHandoff('写完了。\n@团团 请审查这段代码\n重点看边界条件。', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查这段代码\n重点看边界条件。' });
  });

  it('自调用不触发', () => {
    expect(parseA2AHandoff('@claude 我自己来', 'claude')).toBeNull();
  });

  it('行内 mention 不触发(仅行首)', () => {
    expect(parseA2AHandoff('请 @opencode 帮忙看看', 'claude')).toBeNull();
  });

  it('无 mention 返回 null', () => {
    expect(parseA2AHandoff('干完了,没有其他事。', 'claude')).toBeNull();
  });

  it('任务为空不触发', () => {
    expect(parseA2AHandoff('@opencode', 'claude')).toBeNull();
  });

  it('代码块里的 @ 不触发交接', () => {
    expect(
      parseA2AHandoff('示例:\n```\n@opencode 这不是交接\n```\n做完了。', 'claude'),
    ).toBeNull();
    expect(
      parseA2AHandoff('示例:\n```\n@opencode 这不是交接\n```\n@团团 请审查', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查' });
  });
});

describe('findInlineA2AMentions', () => {
  it('句中 @ 记为 inline,行首交接不算', () => {
    expect(findInlineA2AMentions('请 @团团 帮忙看看', 'claude')).toEqual(['opencode']);
    expect(findInlineA2AMentions('@团团 请审查这段代码', 'claude')).toEqual([]);
  });
});
