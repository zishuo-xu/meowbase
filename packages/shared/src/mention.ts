import type { AgentId } from './types.js';

export interface Mention {
  agentId: AgentId;
  offset: number;
}

const MENTION_PATTERN = /@(claude|gemini|opencode)\b/g;

export function parseMentions(content: string): Mention[] {
  const mentions: Mention[] = [];
  for (const match of content.matchAll(MENTION_PATTERN)) {
    mentions.push({ agentId: match[1] as AgentId, offset: match.index ?? 0 });
  }
  return mentions;
}

export function resolveTargetAgent(content: string, fallback: AgentId): AgentId {
  const mentions = parseMentions(content);
  return mentions[0]?.agentId ?? fallback;
}
