import { describe, expect, it } from 'vitest';
import {
  extractMentionTargets,
  lastMentionedAgent,
  parseMentionTargets,
  resolveTurnTargets,
  stripMentions,
} from '../src/mention-targets.js';

describe('parseMentionTargets', () => {
  it('各占一行的行首 @ 才都算目标', () => {
    expect(parseMentionTargets('@claude\n@opencode\n帮我看看', 'claude')).toEqual([
      'claude',
      'opencode',
    ]);
  });

  it('中文名各占一行', () => {
    expect(parseMentionTargets('@墨墨\n@团团\n帮我看看', 'gemini')).toEqual([
      'claude',
      'opencode',
    ]);
  });

  it('同一行第二个 @ 不当目标', () => {
    expect(parseMentionTargets('@claude @opencode 帮我看看', 'claude')).toEqual(['claude']);
    expect(parseMentionTargets('@墨墨 @团团 帮我看看', 'gemini')).toEqual(['claude']);
  });

  it('句中不要 @ 某人不当目标', () => {
    expect(parseMentionTargets('不要 @闪闪,只写 add.ts', 'claude')).toEqual(['claude']);
    expect(extractMentionTargets('不要 @闪闪,只写 add.ts')).toEqual([]);
  });

  it('重复行首 @ 去重', () => {
    expect(parseMentionTargets('@claude 写\n@claude 再改', 'gemini')).toEqual(['claude']);
  });

  it('无行首 mention 用 fallback', () => {
    expect(parseMentionTargets('普通消息', 'claude')).toEqual(['claude']);
  });
});

describe('extractMentionTargets / lastMentionedAgent', () => {
  it('无 @ 返回空,不填 fallback', () => {
    expect(extractMentionTargets('普通消息')).toEqual([]);
    expect(lastMentionedAgent('普通消息')).toBeUndefined();
  });

  it('续棒只看行首,取最后一行行首 @', () => {
    expect(lastMentionedAgent('@墨墨\n@团团\n一起看')).toBe('opencode');
    expect(lastMentionedAgent('@团团 先做 @墨墨 再看')).toBe('opencode');
  });
});

describe('resolveTurnTargets', () => {
  it('本句有 @ 用本句,不看历史', () => {
    expect(
      resolveTurnTargets('@团团 改一下', {
        primaryAgentId: 'claude',
        recentUserMessages: [{ content: '@闪闪 审过了' }],
        lastAssistantAgentId: 'gemini',
      }),
    ).toEqual(['opencode']);
  });

  it('没 @ 续最近用户消息里的最后一只', () => {
    expect(
      resolveTurnTargets('继续', {
        primaryAgentId: 'claude',
        recentUserMessages: [
          { content: '@墨墨 先写' },
          { content: '@闪闪 审一下' },
        ],
        lastAssistantAgentId: 'claude',
      }),
    ).toEqual(['gemini']);
  });

  it('用户消息也没 @ 时续最后开口的猫', () => {
    expect(
      resolveTurnTargets('接着说', {
        primaryAgentId: 'claude',
        recentUserMessages: [{ content: '随便聊聊' }],
        lastAssistantAgentId: 'opencode',
      }),
    ).toEqual(['opencode']);
  });

  it('都没有时回主猫', () => {
    expect(
      resolveTurnTargets('你好', {
        primaryAgentId: 'claude',
      }),
    ).toEqual(['claude']);
  });

  it('超过 1 小时的用户 @ 不续', () => {
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    expect(
      resolveTurnTargets('继续', {
        primaryAgentId: 'claude',
        recentUserMessages: [
          { content: '@闪闪 审一下', createdAt: '2026-08-17T10:00:00.000Z' },
        ],
        lastAssistantAgentId: 'opencode',
        now,
      }),
    ).toEqual(['opencode']);
  });
});

describe('stripMentions', () => {
  it('只剥行首 @,留给猫的是任务正文', () => {
    expect(stripMentions('@claude 帮我写代码')).toBe('帮我写代码');
  });

  it('句中 @ 留给原文', () => {
    expect(stripMentions('@claude 写 @opencode 审')).toBe('写 @opencode 审');
  });

  it('剥中文行首名', () => {
    expect(stripMentions('@墨墨 帮我写代码')).toBe('帮我写代码');
  });

  it('无标记原样返回', () => {
    expect(stripMentions('普通消息')).toBe('普通消息');
  });
});
