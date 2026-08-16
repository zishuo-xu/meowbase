import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';

export interface Mention {
  agentId: AgentId;
  offset: number;
}

export function parseMentions(
  content: string,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): Mention[] {
  const mentions: Mention[] = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  for (const match of content.matchAll(re)) {
    const agentId = resolveAlias(match[1] ?? '', catalog);
    if (!agentId) continue;
    mentions.push({ agentId, offset: match.index ?? 0 });
  }
  return mentions;
}

export function resolveTargetAgent(
  content: string,
  fallback: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId {
  const mentions = parseMentions(content, catalog);
  return mentions[0]?.agentId ?? fallback;
}
