import type { AgentId } from './types.js';

export interface MentionSegment {
  agentId: AgentId;
  text: string;
}

const MENTION_TOKEN = /@(claude|gemini|opencode)\b/g;

/**
 * 把消息按 @mention 切成多段接力:
 * 每个 mention 之后的文本(到下个 mention 前)路由给该 agent;
 * 无 mention 时整段给 fallback;空段跳过。
 */
export function parseMentionSegments(
  content: string,
  fallback: AgentId,
): MentionSegment[] {
  const mentions = [...content.matchAll(MENTION_TOKEN)];
  if (mentions.length === 0) {
    return content.trim() ? [{ agentId: fallback, text: content.trim() }] : [];
  }

  const segments: MentionSegment[] = [];
  for (let i = 0; i < mentions.length; i++) {
    const mention = mentions[i];
    const nextStart = i + 1 < mentions.length ? (mentions[i + 1]?.index ?? content.length) : content.length;
    const text = content.slice((mention.index ?? 0) + mention[0].length, nextStart).trim();
    if (text) {
      segments.push({ agentId: mention[1] as AgentId, text });
    }
  }
  return segments;
}
