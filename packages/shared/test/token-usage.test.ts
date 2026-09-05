import { describe, expect, it } from 'vitest';
import { formatBudgetGateNote, isOverBudget, mergeTokenUsage, totalTokensOf } from '../src/token-usage.js';

describe('mergeTokenUsage', () => {
  it('空值时直接返回 incoming', () => {
    const incoming = { inputTokens: 10 };
    expect(mergeTokenUsage(undefined, incoming)).toEqual(incoming);
  });

  it('数值字段累加', () => {
    const result = mergeTokenUsage(
      { inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
      { inputTokens: 20, outputTokens: 3, costUsd: 0.02 },
    );
    expect(result).toEqual({ inputTokens: 30, outputTokens: 8, costUsd: 0.03 });
  });

  it('undefined 字段不参与累加', () => {
    const result = mergeTokenUsage(
      { inputTokens: 10 },
      { inputTokens: 20, cacheReadTokens: 4 },
    );
    expect(result.cacheReadTokens).toBe(4);
    expect(result.inputTokens).toBe(30);
  });

  it('costEstimated 取 incoming', () => {
    const result = mergeTokenUsage(
      { costUsd: 0.01, costEstimated: false },
      { costUsd: 0.02, costEstimated: true },
    );
    expect(result.costEstimated).toBe(true);
  });
});

describe('totalTokensOf', () => {
  it('有 totalTokens 就用上游报的', () => {
    expect(
      totalTokensOf({
        inputTokens: 179,
        outputTokens: 557,
        totalTokens: 13465,
        cacheReadTokens: 10880,
      }),
    ).toBe(13465);
  });

  it('没有 totalTokens 就派生 input+output+缓存', () => {
    expect(
      totalTokensOf({
        inputTokens: 21171,
        outputTokens: 1936,
        cacheReadTokens: 107008,
        cacheCreationTokens: 0,
      }),
    ).toBe(21171 + 1936 + 107008 + 0);
  });

  it('全空返回 0', () => {
    expect(totalTokensOf({})).toBe(0);
  });

  it('只有 input 时等于 input', () => {
    expect(totalTokensOf({ inputTokens: 42 })).toBe(42);
  });
});

describe('isOverBudget', () => {
  it('spent 达到 cap 才拦,没配或非法不拦', () => {
    expect(isOverBudget(1, 1)).toBe(true);
    expect(isOverBudget(1.01, 1)).toBe(true);
    expect(isOverBudget(0.99, 1)).toBe(false);
    expect(isOverBudget(1, undefined)).toBe(false);
    expect(isOverBudget(1, 0)).toBe(false);
    expect(isOverBudget(1, -2)).toBe(false);
    expect(isOverBudget(Number.NaN, 1)).toBe(false);
  });

  it('拒跑文案带已花和上限', () => {
    expect(formatBudgetGateNote({ spentUsd: 0.001, capUsd: 0.001 })).toContain('已花 $0.0010');
    expect(formatBudgetGateNote({ spentUsd: 0.001, capUsd: 0.001 })).toContain('上限 $0.0010');
    expect(formatBudgetGateNote({ spentUsd: 1, capUsd: 1, agentName: '墨墨' })).toContain('墨墨的预算用完');
  });
});
