import type { MessageDto, ToolActivity } from './api';

export interface StreamIncrement {
  messageId: string;
  delta: string;
  agentId?: string;
}

export interface StreamActivity {
  messageId: string;
  activity: ToolActivity;
  agentId?: string;
}

export function upsertToolActivity(list: ToolActivity[], next: ToolActivity): ToolActivity[] {
  const idx = list.findIndex((a) => a.id === next.id);
  if (idx < 0) return [...list, next];
  const prev = list[idx];
  if (!prev) return [...list, next];
  return list.map((item, i) =>
    i === idx
      ? {
          id: prev.id,
          name: next.name && next.name !== 'tool' ? next.name : prev.name,
          arg: next.arg ?? prev.arg,
          status: next.status,
        }
      : item,
  );
}

function assistantShell(
  event: { messageId: string; agentId?: string },
  threadId: string,
  extra: Partial<MessageDto>,
): MessageDto {
  return {
    id: event.messageId,
    threadId,
    role: 'assistant',
    agentId: event.agentId,
    content: '',
    status: 'streaming',
    createdAt: new Date().toISOString(),
    ...extra,
  };
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

/** 把一条 CLI 工具过程合并进消息;尚未出现的 messageId 新建空气泡 */
export function applyStreamActivity(
  messages: MessageDto[],
  event: StreamActivity,
  threadId: string,
): MessageDto[] {
  const idx = messages.findIndex((m) => m.id === event.messageId);
  if (idx >= 0) {
    const current = messages[idx];
    if (!current) return messages;
    const next = [...messages];
    next[idx] = {
      ...current,
      status: current.status === 'completed' ? current.status : 'streaming',
      activities: upsertToolActivity(current.activities ?? [], event.activity),
    };
    return next;
  }
  return [
    ...messages,
    assistantShell(event, threadId, {
      activities: [event.activity],
    }),
  ];
}

/** CLI 尚未吐字时先占位,避免页面只剩「干活」药丸 */
export function applyStreamStart(
  messages: MessageDto[],
  event: { messageId: string; agentId?: string },
  threadId: string,
): MessageDto[] {
  if (messages.some((m) => m.id === event.messageId)) return messages;
  return [...messages, assistantShell(event, threadId, {})];
}

/** 思考增量单独累积,不进对用户说的话 */
export function applyStreamThinking(
  messages: MessageDto[],
  event: { messageId: string; delta: string; agentId?: string },
  threadId: string,
): MessageDto[] {
  const idx = messages.findIndex((m) => m.id === event.messageId);
  if (idx >= 0) {
    const current = messages[idx];
    if (!current) return messages;
    const next = [...messages];
    next[idx] = {
      ...current,
      status: current.status === 'completed' ? current.status : 'streaming',
      thinking: (current.thinking ?? '') + event.delta,
    };
    return next;
  }
  return [...messages, assistantShell(event, threadId, { thinking: event.delta })];
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

/** 只有名字和光标、还没有任何思考/工具/正文的流式空壳 */
export function isEmptyStreamShell(message: Pick<MessageDto, 'role' | 'status' | 'content' | 'thinking' | 'activities'>): boolean {
  return (
    message.role === 'assistant' &&
    message.status === 'streaming' &&
    !message.content.trim() &&
    !message.thinking?.trim() &&
    !(message.activities && message.activities.length > 0)
  );
}

/** 发送已结束时丢掉空气泡,避免 API 中断后页面上留一只空墨墨 */
export function dropAbandonedStreamShells(messages: MessageDto[], sending: boolean): MessageDto[] {
  if (sending) return messages;
  return messages.filter((m) => !isEmptyStreamShell(m));
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
    if (!s) return m;
    const activities =
      (s.activities?.length ?? 0) > (m.activities?.length ?? 0) ? s.activities : m.activities;
    const thinking =
      (s.thinking?.length ?? 0) > (m.thinking?.length ?? 0) ? s.thinking : m.thinking;
    if (s.content.length <= m.content.length) {
      return {
        ...m,
        ...(activities ? { activities } : {}),
        ...(thinking ? { thinking } : {}),
      };
    }
    const settled =
      m.status === 'completed' || m.status === 'failed' || m.status === 'terminated';
    return { ...m, content: s.content, status: settled ? m.status : s.status, activities, thinking };
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
