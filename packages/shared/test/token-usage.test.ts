import { describe, expect, it } from 'vitest';
import { mergeTokenUsage } from '../src/token-usage.js';

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
