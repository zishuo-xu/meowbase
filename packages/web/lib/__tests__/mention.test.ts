import { describe, expect, it } from 'vitest';
import { getMentionQuery } from '../mention';

describe('getMentionQuery', () => {
  it('光标在 @ 后 → 返回词元起点与查询', () => {
    expect(getMentionQuery('帮我 @cl', 6)).toEqual({ start: 3, query: 'cl' });
  });

  it('光标紧跟 @ 无输入 → 空查询', () => {
    expect(getMentionQuery('帮我 @', 4)).toEqual({ start: 3, query: '' });
  });

  it('中文查询', () => {
    expect(getMentionQuery('@墨', 2)).toEqual({ start: 0, query: '墨' });
  });

  it('@ 后有空格 → null(词元已闭合)', () => {
    expect(getMentionQuery('@claude 写', 9)).toBeNull();
  });

  it('无 @ → null', () => {
    expect(getMentionQuery('普通文本', 4)).toBeNull();
  });
});
