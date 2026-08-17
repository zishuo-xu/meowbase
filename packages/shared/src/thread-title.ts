import { DEFAULT_CATALOG, type MentionCatalog } from './catalog.js';
import { stripMentions } from './mention-targets.js';

export const TITLE_MAX_LEN = 24;

/** 新建会话留下的时间标题 / 「新会话」,可以被首条消息替换。 */
export function isPlaceholderTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === '新会话' || t === '新线程') return true;
  return /^(?:\d{4}[/\-年])?\d{1,2}\s*[/\-月]\s*\d{1,2}/.test(t);
}

/** 第一条用户消息收成侧栏标题;只剩 @ 时返回 null。 */
export function titleFromUserMessage(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
  max = TITLE_MAX_LEN,
): string | null {
  const cleaned = stripMentions(content, catalog).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  const sliced = cleaned.slice(0, max).replace(/[，,。.\s]+$/u, '').trimEnd();
  return sliced ? `${sliced}…` : null;
}
