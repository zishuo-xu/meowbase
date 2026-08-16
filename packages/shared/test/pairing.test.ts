import { describe, expect, it } from 'vitest';
import { selectReviewer } from '../src/pairing.js';

describe('selectReviewer', () => {
  it('claude 写 → 有闪闪则闪闪审', () => {
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'])).toBe('gemini');
  });

  it('闪闪不在时 claude 写 → 团团审', () => {
    expect(selectReviewer('claude', ['claude', 'opencode'])).toBe('opencode');
  });

  it('opencode 写 → 有闪闪则闪闪审', () => {
    expect(selectReviewer('opencode', ['claude', 'gemini', 'opencode'])).toBe('gemini');
  });

  it('闪闪不在时 opencode 写 → 墨墨审', () => {
    expect(selectReviewer('opencode', ['claude', 'opencode'])).toBe('claude');
  });

  it('gemini 写 → claude 审', () => {
    expect(selectReviewer('gemini', ['claude', 'gemini', 'opencode'])).toBe('claude');
  });

  it('只有写手自己 → undefined', () => {
    expect(selectReviewer('claude', ['claude'])).toBeUndefined();
  });

  it('写手不可用时选第一个可用且不同的', () => {
    expect(selectReviewer('claude', ['gemini'])).toBe('gemini');
  });

  it('配对来自 team.handoffTo', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官' },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'], team)).toBe('opencode');
  });
});
