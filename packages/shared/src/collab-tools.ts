import type { AgentId, Message, SopStage, Thread } from './types.js';

export interface CollabMessageHit {
  threadId: string;
  messageId: string;
  agentId?: AgentId;
  role: Message['role'];
  excerpt: string;
}

export interface CollabThreadRow {
  id: string;
  title: string;
  primaryAgentId: AgentId;
  stage?: SopStage;
}

const DEFAULT_LIMIT = 20;
const EXCERPT = 160;

export function searchMessages(
  messages: ReadonlyArray<Pick<Message, 'id' | 'threadId' | 'role' | 'agentId' | 'content'>>,
  input: { query: string; agentId?: AgentId; limit?: number },
): CollabMessageHit[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_LIMIT, 50));
  const hits: CollabMessageHit[] = [];
  for (const message of messages) {
    if (!message.content?.toLowerCase().includes(query)) continue;
    if (input.agentId && message.agentId !== input.agentId) continue;
    hits.push({
      threadId: message.threadId,
      messageId: message.id,
      ...(message.agentId ? { agentId: message.agentId } : {}),
      role: message.role,
      excerpt: clipExcerpt(message.content, EXCERPT),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function listThreadIndex(
  threads: ReadonlyArray<Pick<Thread, 'id' | 'title' | 'primaryAgentId' | 'sop'>>,
): CollabThreadRow[] {
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    primaryAgentId: thread.primaryAgentId,
    ...(thread.sop?.stage ? { stage: thread.sop.stage } : {}),
  }));
}

function clipExcerpt(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}
