/** Redis 单测残留标题,侧栏默认藏起来。 */
export function isNoiseThreadTitle(title: string): boolean {
  return /^(redis-[tm]|redis-[tm]-\d+|t-\d{10,})$/.test(title.trim());
}

/** 新建会话的默认标题,用时间,不叫「新线程」。 */
export function defaultSessionTitle(now = new Date()): string {
  return now.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function sortThreadsByCreated<T extends { createdAt: string }>(threads: T[]): T[] {
  return [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
