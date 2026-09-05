import { describe, expect, it } from 'vitest';
import {
  buildMentionCatalog,
  displayName,
  expandMentionToken,
  isGroupMentionToken,
  resolveAlias,
} from '../src/catalog.js';

describe('resolveAlias', () => {
  it('英文 id 与中文名都解析到同一 agent', () => {
    expect(resolveAlias('claude')).toBe('claude');
    expect(resolveAlias('墨墨')).toBe('claude');
    expect(resolveAlias('闪闪')).toBe('gemini');
    expect(resolveAlias('团团')).toBe('opencode');
    expect(resolveAlias('OpenCode')).toBe('opencode');
  });

  it('未知词返回 undefined', () => {
    expect(resolveAlias('xyz')).toBeUndefined();
    expect(resolveAlias('墨')).toBeUndefined();
  });

  it('profile 改名后新名字生效', () => {
    const catalog = buildMentionCatalog([
      { agentId: 'claude', name: '小墨', aliases: ['写手墨'] },
    ]);
    expect(resolveAlias('小墨', catalog)).toBe('claude');
    expect(resolveAlias('墨墨', catalog)).toBe('claude');
    expect(resolveAlias('写手墨', catalog)).toBe('claude');
    expect(displayName('claude', catalog)).toBe('小墨');
  });
});

describe('expandMentionToken', () => {
  it('全员组按名册顺序展开,角色组按职责,未知空', () => {
    expect(expandMentionToken('all')).toEqual(['claude', 'gemini', 'opencode']);
    expect(expandMentionToken('大家')).toEqual(['claude', 'gemini', 'opencode']);
    expect(expandMentionToken('审查')).toEqual(['gemini']);
    expect(expandMentionToken('墨墨')).toEqual(['claude']);
    expect(expandMentionToken('xyz')).toEqual([]);
    expect(isGroupMentionToken('all')).toBe(true);
    expect(isGroupMentionToken('墨墨')).toBe(false);
  });
});
