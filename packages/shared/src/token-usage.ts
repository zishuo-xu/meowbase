import type { TokenUsage } from './types.js';

const SUM_KEYS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'costUsd',
] as const;

export function mergeTokenUsage(
  existing: TokenUsage | undefined,
  incoming: TokenUsage,
): TokenUsage {
  if (!existing) return { ...incoming };
  const result: TokenUsage = { ...existing };
  for (const key of SUM_KEYS) {
    const value = incoming[key];
    if (value != null) {
      result[key] = (result[key] ?? 0) + value;
    }
  }
  if (incoming.costEstimated != null) {
    result.costEstimated = incoming.costEstimated;
  }
  return result;
}

/** 上游报了 totalTokens 就用它；否则派生可见字段之和。 */
export function totalTokensOf(usage: TokenUsage): number {
  if (usage.totalTokens != null) return usage.totalTokens;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0)
  );
}
