import { describe, expect, it } from 'vitest';
import { parseMentionTargets, stripMentions } from '../src/mention-targets.js';

describe('parseMentionTargets', () => {
  it('多 @ 提取全部目标(保持顺序)', () => {
    expect(parseMentionTargets('@claude @opencode 帮我看看', 'claude')).toEqual([
      'claude',
      'opencode',
    ]);
  });

  it('中文名提取目标', () => {
    expect(parseMentionTargets('@墨墨 @团团 帮我看看', 'gemini')).toEqual([
      'claude',
      'opencode',
    ]);
  });

  it('重复 @ 去重', () => {
    expect(parseMentionTargets('@claude 写 @claude 再改', 'claude')).toEqual(['claude']);
  });

  it('无 mention 用 fallback', () => {
    expect(parseMentionTargets('普通消息', 'claude')).toEqual(['claude']);
  });
});

describe('stripMentions', () => {
  it('移除 @mention 标记', () => {
    expect(stripMentions('@claude 帮我写代码')).toBe(' 帮我写代码');
  });

  it('移除多个标记', () => {
    expect(stripMentions('@claude 写 @opencode 审')).toBe(' 写  审');
  });

  it('移除中文名标记', () => {
    expect(stripMentions('@墨墨 帮我写代码')).toBe(' 帮我写代码');
  });

  it('无标记原样返回', () => {
    expect(stripMentions('普通消息')).toBe('普通消息');
  });
});
