import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { AgentId, Message, Thread } from '@meowbase/shared';
import type { MessageStore, ThreadStore } from './ports.js';

function threadKey(id: string): string {
  return `thread:${id}`;
}

function messageKey(threadId: string): string {
  return `thread:${threadId}:messages`;
}

export class RedisThreadStore implements ThreadStore {
  constructor(private readonly redis: Redis) {}

  async create(input: { title: string; primaryAgentId: AgentId }): Promise<Thread> {
    const id = randomUUID();
    const thread: Thread = {
      id,
      title: input.title,
      primaryAgentId: input.primaryAgentId,
      workdir: `work/${id}`,
      sessions: {},
      createdAt: new Date().toISOString(),
    };
    await this.redis
      .multi()
      .hset(threadKey(id), {
        id: thread.id,
        title: thread.title,
        primaryAgentId: thread.primaryAgentId,
        workdir: thread.workdir,
        sessions: JSON.stringify(thread.sessions),
        createdAt: thread.createdAt,
      })
      .sadd('thread:index', id)
      .exec();
    return thread;
  }

  private async hydrate(id: string): Promise<Thread | null> {
    const raw = await this.redis.hgetall(threadKey(id));
    if (!raw.id) return null;
    return {
      id: raw.id,
      title: raw.title ?? '',
      primaryAgentId: (raw.primaryAgentId as AgentId) ?? 'claude',
      workdir: raw.workdir ?? '',
      sessions: JSON.parse(raw.sessions ?? '{}') as Partial<Record<AgentId, string>>,
      createdAt: raw.createdAt ?? '',
    };
  }

  async get(id: string): Promise<Thread | null> {
    return this.hydrate(id);
  }

  async list(): Promise<Thread[]> {
    const ids = await this.redis.smembers('thread:index');
    const threads: Thread[] = [];
    for (const id of ids) {
      const thread = await this.hydrate(id);
      if (thread) threads.push(thread);
    }
    return threads;
  }

  async setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    thread.sessions[agentId] = sessionId;
    await this.redis.hset(threadKey(threadId), 'sessions', JSON.stringify(thread.sessions));
  }
}

export class RedisMessageStore implements MessageStore {
  constructor(private readonly redis: Redis) {}

  private async readAll(threadId: string): Promise<Message[]> {
    const raw = await this.redis.get(messageKey(threadId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  }

  async append(input: Parameters<MessageStore['append']>[0]): Promise<Message> {
    const message: Message = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      agentId: input.agentId,
      content: input.content,
      status: input.status,
      sessionId: input.sessionId,
      usage: input.usage,
      error: input.error,
      createdAt: new Date().toISOString(),
    };
    const all = await this.readAll(input.threadId);
    all.push(message);
    await this.redis.set(messageKey(input.threadId), JSON.stringify(all));
    return message;
  }

  async get(threadId: string, messageId: string): Promise<Message | null> {
    return (await this.readAll(threadId)).find((m) => m.id === messageId) ?? null;
  }

  async list(threadId: string): Promise<Message[]> {
    return this.readAll(threadId);
  }

  async patch(
    threadId: string,
    messageId: string,
    patch: Partial<Omit<Message, 'id' | 'threadId' | 'createdAt'>>,
  ): Promise<Message> {
    const all = await this.readAll(threadId);
    const index = all.findIndex((m) => m.id === messageId);
    if (index < 0) throw new Error(`消息不存在: ${messageId}`);
    const updated = { ...all[index], ...patch };
    all[index] = updated;
    await this.redis.set(messageKey(threadId), JSON.stringify(all));
    return updated;
  }
}
