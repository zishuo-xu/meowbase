import { describe, expect, it } from 'vitest';
import { parseMentions, resolveTargetAgent } from '../src/mention.js';

describe('parseMentions', () => {
  it('解析开头 @claude', () => {
    expect(parseMentions('@claude 帮我写个函数')).toEqual([
      { agentId: 'claude', offset: 0 },
    ]);
  });

  it('解析中文名 @墨墨', () => {
    expect(parseMentions('@墨墨 帮我写个函数')).toEqual([
      { agentId: 'claude', offset: 0 },
    ]);
  });

  it('解析中间多个 mention', () => {
    expect(parseMentions('先 @claude 写,再 @gemini 审')).toEqual([
      { agentId: 'claude', offset: 2 },
      { agentId: 'gemini', offset: 14 },
    ]);
  });

  it('无 mention 返回空数组', () => {
    expect(parseMentions('普通消息')).toEqual([]);
  });

  it('不把 @xyz 当 mention', () => {
    expect(parseMentions('@xyz 你好')).toEqual([]);
  });
});

describe('resolveTargetAgent', () => {
  it('有 mention 用第一个', () => {
    expect(resolveTargetAgent('@opencode 干活', 'claude')).toBe('opencode');
  });

  it('有中文 mention 用对应 agent', () => {
    expect(resolveTargetAgent('@墨墨 干活', 'opencode')).toBe('claude');
  });

  it('无 mention 用 fallback', () => {
    expect(resolveTargetAgent('干活', 'claude')).toBe('claude');
  });
});
