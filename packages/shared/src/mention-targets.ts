import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';

/** 没 @ 时回看最近几条用户消息;只扫人说的话,不扫猫。 */
export const USER_MENTION_LOOKBACK = 5;
export const USER_MENTION_MAX_AGE_MS = 60 * 60 * 1000;

/** 提取消息里所有有效 @ 目标(不去 fallback;无 @ 返回空)。 */
export function extractMentionTargets(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId[] {
  const targets: AgentId[] = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  for (const match of content.matchAll(re)) {
    const id = resolveAlias(match[1] ?? '', catalog);
    if (id && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

/** 消息里最后一个有效 @;用于「没 @ 续上一只」。 */
export function lastMentionedAgent(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId | undefined {
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let last: AgentId | undefined;
  for (const match of content.matchAll(re)) {
    const id = resolveAlias(match[1] ?? '', catalog);
    if (id) last = id;
  }
  return last;
}

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
  const found = extractMentionTargets(content, catalog);
  return found.length > 0 ? found : [fallback];
}

export interface TurnTargetInput {
  primaryAgentId: AgentId;
  /** 本轮之前的用户消息,旧→新;只扫这些,不扫猫。 */
  recentUserMessages?: readonly { content: string; createdAt?: string }[];
  lastAssistantAgentId?: AgentId;
  catalog?: MentionCatalog;
  now?: number;
}

/**
 * 本轮路由:本句有效 @ → 最近 1h 内用户消息的最后一只 @
 * → 最后开口的猫 → 线程主猫。不加 @all。
 */
export function resolveTurnTargets(
  content: string,
  input: TurnTargetInput,
): AgentId[] {
  const catalog = input.catalog ?? DEFAULT_CATALOG;
  const explicit = extractMentionTargets(content, catalog);
  if (explicit.length > 0) return explicit;

  const now = input.now ?? Date.now();
  const recent = (input.recentUserMessages ?? [])
    .filter((msg) => {
      if (!msg.createdAt) return true;
      const ts = Date.parse(msg.createdAt);
      return Number.isFinite(ts) && now - ts <= USER_MENTION_MAX_AGE_MS;
    })
    .slice(-USER_MENTION_LOOKBACK)
    .reverse();

  for (const msg of recent) {
    const last = lastMentionedAgent(msg.content, catalog);
    if (last) return [last];
  }

  if (input.lastAssistantAgentId) return [input.lastAssistantAgentId];
  return [input.primaryAgentId];
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
