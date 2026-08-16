import { describe, expect, it } from 'vitest';
import { parseMentionSegments } from '../src/mention-segments.js';

describe('parseMentionSegments', () => {
  it('多角色接力:按 @ 切段', () => {
    expect(
      parseMentionSegments('@claude 写个函数 @opencode 审查它', 'claude'),
    ).toEqual([
      { agentId: 'claude', text: '写个函数' },
      { agentId: 'opencode', text: '审查它' },
    ]);
  });

  it('无 mention:整段给主 agent', () => {
    expect(parseMentionSegments('随便聊聊', 'claude')).toEqual([
      { agentId: 'claude', text: '随便聊聊' },
    ]);
  });

  it('尾部空段跳过', () => {
    expect(parseMentionSegments('@claude 干活 @opencode', 'claude')).toEqual([
      { agentId: 'claude', text: '干活' },
    ]);
  });

  it('开头的 mention 前缀被剥离,文本从 mention 后开始', () => {
    expect(parseMentionSegments('@gemini 说说看法', 'claude')).toEqual([
      { agentId: 'gemini', text: '说说看法' },
    ]);
  });
});
