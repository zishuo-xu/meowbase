/** 有意镜像 shared/src/token-usage.ts 的 totalTokensOf，web 不依赖 @meowbase/shared。 */

export interface TokenCountFields {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** 上游报了 totalTokens 就用它；否则派生可见字段之和。 */
export function totalTokensOf(usage: TokenCountFields): number {
  if (usage.totalTokens != null) return usage.totalTokens;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheReadTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0)
  );
}
