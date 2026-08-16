import { describe, expect, it } from 'vitest';
import {
  buildMentionCatalog,
  displayName,
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
