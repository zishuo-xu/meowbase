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

export function isPlaceholderTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === '新会话' || t === '新线程') return true;
  return /^(?:\d{4}[/\-年])?\d{1,2}\s*[/\-月]\s*\d{1,2}/.test(t);
}

export function titleFromUserMessage(content: string, max = 24): string | null {
  const cleaned = content.replace(/@\S+\s*/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  const sliced = cleaned.slice(0, max).replace(/[，,。.\s]+$/u, '').trimEnd();
  return sliced ? `${sliced}…` : null;
}

export function sortThreadsByCreated<T extends { createdAt: string }>(threads: T[]): T[] {
  return [...threads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** 侧栏/顶栏用:仓库目录名 · 线程分支 */
export function threadRepoHint(repo: { path: string; branch: string }): string {
  const parts = repo.path.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? repo.path;
  return `${base} · ${repo.branch}`;
}
