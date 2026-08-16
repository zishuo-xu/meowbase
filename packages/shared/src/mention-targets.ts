import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';

/**
 * 多 @ 同题并行(对齐 clowder):提取消息中所有 @mention 目标,
 * 同一消息原文发给每个目标;无 mention 时用 fallback。
 * 中文名与英文 id 等价(@墨墨 = @claude)。
 */
export function parseMentionTargets(
  content: string,
  fallback: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId[] {
  const targets: AgentId[] = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  for (const match of content.matchAll(re)) {
    const id = resolveAlias(match[1] ?? '', catalog);
    if (id && !targets.includes(id)) targets.push(id);
  }
  return targets.length > 0 ? targets : [fallback];
}

/** 移除消息中的 @mention 标记(发给 agent 前清理) */
export function stripMentions(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): string {
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  return content.replace(re, (full, token: string) =>
    resolveAlias(token, catalog) ? '' : full,
  );
}
