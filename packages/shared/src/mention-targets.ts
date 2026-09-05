import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  expandMentionToken,
  isGroupMentionToken,
  type MentionCatalog,
} from './catalog.js';

/** 没 @ 时回看最近几条用户消息;只扫人说的话,不扫猫。 */
export const USER_MENTION_LOOKBACK = 5;
export const USER_MENTION_MAX_AGE_MS = 60 * 60 * 1000;

/** 行首 @名字,与猫的 A2A 同一条规则(对齐 clowder TIPS)。 */
const LINE_START = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)/;

function lineStartTargets(line: string, catalog: MentionCatalog): AgentId[] {
  const match = line.match(LINE_START);
  if (!match) return [];
  return expandMentionToken(match[1] ?? '', catalog);
}

function lineStartTarget(line: string, catalog: MentionCatalog): AgentId | undefined {
  return lineStartTargets(line, catalog)[0];
}

/** 提取行首有效 @ 目标(不去 fallback;句中 @ 不算)。群组名展开。 */
export function extractMentionTargets(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId[] {
  const targets: AgentId[] = [];
  for (const line of content.split('\n')) {
    for (const id of lineStartTargets(line, catalog)) {
      if (!targets.includes(id)) targets.push(id);
    }
  }
  return targets;
}

/** 最后一行行首 @;用于「没 @ 续上一只」。句中 @ 不续。 */
export function lastMentionedAgent(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId | undefined {
  let last: AgentId | undefined;
  for (const line of content.split('\n')) {
    const id = lineStartTarget(line, catalog);
    if (id) last = id;
  }
  return last;
}

/**
 * 多 @ 同题群发:各占一行的行首 @ 才是目标,同一正文发给每个目标。谁先谁后见协议表。
 * 无行首 mention 时用 fallback。中文名与英文 id 等价。
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
 * 本轮路由:本句行首 @ → 最近 1h 内用户消息的最后一行行首 @
 * → 最后开口的猫 → 线程主猫。行首 @all/@thread/角色组会展开。
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

/** 只剥行首路由 @,句中 @ 留给原文。 */
export function stripMentions(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): string {
  return content
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*)@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)(\s*)(.*)$/);
      if (!match) return line;
      const token = match[2] ?? '';
      if (expandMentionToken(token, catalog).length === 0 && !isGroupMentionToken(token)) {
        return line;
      }
      return `${match[1] ?? ''}${match[4] ?? ''}`;
    })
    .join('\n');
}
