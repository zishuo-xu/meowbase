import { describe, expect, it } from 'vitest';
import { parseA2AHandoff } from '../src/a2a.js';

describe('parseA2AHandoff', () => {
  it('行首 mention → 解析目标与任务', () => {
    expect(
      parseA2AHandoff('写完了。\n@opencode 请审查这段代码\n重点看边界条件。', 'claude'),
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
});
