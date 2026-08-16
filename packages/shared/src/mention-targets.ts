import type { AgentId } from './types.js';

const MENTION_TOKEN = /@(claude|gemini|opencode)\b/g;

/**
 * 多 @ 同题并行(对齐 clowder):提取消息中所有 @mention 目标,
 * 同一消息原文发给每个目标;无 mention 时用 fallback。
 */
export function parseMentionTargets(
  content: string,
  fallback: AgentId,
): AgentId[] {
  const targets: AgentId[] = [];
  for (const match of content.matchAll(MENTION_TOKEN)) {
    const id = match[1] as AgentId;
    if (!targets.includes(id)) targets.push(id);
  }
  return targets.length > 0 ? targets : [fallback];
}

/** 移除消息中的 @mention 标记(发给 agent 前清理) */
export function stripMentions(content: string): string {
  return content.replace(MENTION_TOKEN, '');
}
