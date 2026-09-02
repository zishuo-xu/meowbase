import { describe, expect, it } from 'vitest';
import { classifyDiffRisk, selectReviewer } from '../src/pairing.js';

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

  it('安全面改动 → 选声明了 safety 的猫,不是 handoffTo 默认那只', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官', reviewRisk: ['safety' as const, 'contract' as const] },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    // handoffTo 指向 opencode,但 safety 面应由声明了 safety 的 gemini 审
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'], team, 'safety')).toBe('gemini');
  });

  it('契约面改动 → 选声明了 contract 的猫', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官', reviewRisk: ['contract' as const] },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'], team, 'contract')).toBe('gemini');
  });

  it('default 面改动 → 维持 handoffTo 现状', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官', reviewRisk: ['safety' as const] },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'], team, 'default')).toBe('opencode');
  });

  it('该风险面没人声明 → 回退 handoffTo 现状逻辑', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官' },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    expect(selectReviewer('claude', ['claude', 'gemini', 'opencode'], team, 'safety')).toBe('opencode');
  });

  it('唯一声明该风险面的是写手自己 → 不许自审,回退现状逻辑', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'gemini' as const, reviewRisk: ['safety' as const] },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官' },
    ];
    expect(selectReviewer('claude', ['claude', 'gemini'], team, 'safety')).toBe('gemini');
  });

  it('声明了该风险面的猫不可用 → 回退现状逻辑', () => {
    const team = [
      { agentId: 'claude' as const, name: '墨墨', role: '主架构师', handoffTo: 'opencode' as const },
      { agentId: 'gemini' as const, name: '闪闪', role: '审查官', reviewRisk: ['safety' as const] },
      { agentId: 'opencode' as const, name: '团团', role: '执行者' },
    ];
    expect(selectReviewer('claude', ['claude', 'opencode'], team, 'safety')).toBe('opencode');
  });
});

describe('classifyDiffRisk', () => {
  it('空文件列表 → default', () => {
    expect(classifyDiffRisk([])).toBe('default');
  });

  it('普通沙箱文件 → default', () => {
    expect(classifyDiffRisk(['hello.txt', 'src/index.ts'])).toBe('default');
  });

  it('命中安全面路径 → safety', () => {
    expect(classifyDiffRisk(['packages/shared/src/hold-command.ts'])).toBe('safety');
    expect(classifyDiffRisk(['hello.txt', 'packages/shared/src/repo-path.ts'])).toBe('safety');
  });

  it('命中契约面路径 → contract', () => {
    expect(classifyDiffRisk(['AGENTS.md'])).toBe('contract');
    expect(classifyDiffRisk(['packages/shared/src/a2a.ts'])).toBe('contract');
  });

  it('同时命中 safety 和 contract → safety 优先', () => {
    expect(classifyDiffRisk(['AGENTS.md', 'packages/shared/src/hold-command.ts'])).toBe('safety');
  });
});
