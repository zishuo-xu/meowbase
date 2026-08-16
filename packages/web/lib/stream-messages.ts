import type { MessageDto } from './api';

export interface StreamIncrement {
  messageId: string;
  delta: string;
  agentId?: string;
}

/** 把一条 WS 增量合并进消息列表;尚未出现的 messageId 新建一条 streaming 气泡 */
export function applyStreamIncrement(
  messages: MessageDto[],
  event: StreamIncrement,
  threadId: string,
): MessageDto[] {
  const idx = messages.findIndex((m) => m.id === event.messageId);
  if (idx >= 0) {
    const current = messages[idx];
    if (!current) return messages;
    const next = [...messages];
    next[idx] = {
      ...current,
      content: current.content + event.delta,
      status: 'streaming',
    };
    return next;
  }
  return [
    ...messages,
    {
      id: event.messageId,
      threadId,
      role: 'assistant',
      agentId: event.agentId,
      content: event.delta,
      status: 'streaming',
      createdAt: new Date().toISOString(),
    },
  ];
}

export type PipelinePhase = 'idle' | 'working' | 'reviewing';

/** sending 未结束时:已有写手回复则视为审查中,避免气泡已出还一直「干活」 */
export function pipelinePhase(
  messages: Pick<MessageDto, 'role' | 'status'>[],
  sending: boolean,
): PipelinePhase {
  if (!sending) return 'idle';
  let lastUser = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') lastUser = i;
  }
  if (lastUser < 0) return 'working';
  const settled = messages
    .slice(lastUser + 1)
    .some(
      (m) =>
        m.role === 'assistant' &&
        (m.status === 'completed' || m.status === 'failed' || m.status === 'terminated'),
    );
  return settled ? 'reviewing' : 'working';
}

/**
 * 服务端快照与本地流式状态合并:
 * - 同 id 保留更长的 content(避免轮询/刷新把正在打的字盖掉)
 * - 本地 `local-` 乐观用户气泡:服务端已有相同正文则丢掉,否则保留
 * - 仅出现在 streamed 里的 assistant(WS 抢先到达)予以保留
 */
export function mergeCanonicalMessages(
  canonical: MessageDto[],
  streamed: MessageDto[],
  threadId: string,
): MessageDto[] {
  const local = streamed.filter((m) => m.threadId === threadId);
  const streamedById = new Map(local.map((m) => [m.id, m]));
  const merged = canonical.map((m) => {
    const s = streamedById.get(m.id);
    if (!s || s.content.length <= m.content.length) return m;
    const settled =
      m.status === 'completed' || m.status === 'failed' || m.status === 'terminated';
    return { ...m, content: s.content, status: settled ? m.status : s.status };
  });
  const ids = new Set(canonical.map((m) => m.id));
  for (const s of local) {
    if (ids.has(s.id)) continue;
    if (s.id.startsWith('local-')) {
      const duplicated = merged.some((m) => m.role === 'user' && m.content === s.content);
      if (duplicated) continue;
    }
    merged.push(s);
  }
  return merged;
}
