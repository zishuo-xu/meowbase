export interface MentionQuery {
  start: number;
  query: string;
}

/**
 * 检测光标位置是否处于一个未闭合的 @mention 词元中。
 * 词元 = @ + [字母|中文]*(到光标为止),一旦出现空格即闭合。
 */
export function getMentionQuery(value: string, pos: number): MentionQuery | null {
  const before = value.slice(0, pos);
  const match = before.match(/@([a-zA-Z\u4e00-\u9fa5]*)$/);
  if (!match) return null;
  return { start: pos - match[0].length, query: match[1] ?? '' };
}
