export function isUrgentInbound(content: string): boolean {
  return /^\s*[!！急]/.test(content);
}

/**
 * 把 id 挪到 beforeId 前面。
 * beforeId 省略 → 队头;空/null → 队尾;找不到 id 或 beforeId → null。
 */
export function moveQueueItem<T extends { id: string }>(
  list: readonly T[],
  id: string,
  beforeId?: string | null,
): T[] | null {
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) return null;
  const item = list[from]!;
  const rest = list.filter((_, index) => index !== from);
  if (beforeId === undefined) {
    return from === 0 ? [...list] : [item, ...rest];
  }
  if (beforeId === null || beforeId === '') {
    return from === list.length - 1 ? [...list] : [...rest, item];
  }
  const to = rest.findIndex((row) => row.id === beforeId);
  if (to < 0) return null;
  return [...rest.slice(0, to), item, ...rest.slice(to)];
}
