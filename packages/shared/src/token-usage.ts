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

/** 配了有限正数上限,且已花真实花费达到上限,才拦。没配 / 非法不拦。 */
export function isOverBudget(spentUsd: number, capUsd: number | undefined): boolean {
  if (capUsd == null || !Number.isFinite(capUsd) || capUsd <= 0) return false;
  if (!Number.isFinite(spentUsd) || spentUsd < 0) return false;
  return spentUsd >= capUsd;
}

export function formatBudgetGateNote(input: { spentUsd: number; capUsd: number }): string {
  const spent = input.spentUsd.toFixed(4);
  const cap = input.capUsd.toFixed(4);
  return `⚠️ 预算用完(已花 $${spent} / 上限 $${cap}),不再叫猫。批准和拉闸仍能走。`;
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
