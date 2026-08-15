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
