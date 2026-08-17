/** Redis 单测残留标题,侧栏默认藏起来。 */
export function isNoiseThreadTitle(title: string): boolean {
  return /^(redis-[tm]|redis-[tm]-\d+|t-\d{10,})$/.test(title.trim());
}

export function sortThreadsByCreated<T extends { createdAt: string }>(threads: T[]): T[] {
  return [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
