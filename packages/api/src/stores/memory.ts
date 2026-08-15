import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentId, Message, Thread } from '@meowbase/shared';
import type { MessageStore, ThreadStore } from './ports.js';

export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, Thread>();

  async create(input: {
    title: string;
    primaryAgentId: AgentId;
    workdirBase?: string;
  }): Promise<Thread> {
    const id = randomUUID();
    const thread: Thread = {
      id,
      title: input.title,
      primaryAgentId: input.primaryAgentId,
      workdir: join(input.workdirBase ?? 'work', id),
      sessions: {},
      createdAt: new Date().toISOString(),
    };
    this.threads.set(id, thread);
    return thread;
  }

  async get(id: string): Promise<Thread | null> {
    return this.threads.get(id) ?? null;
  }

  async list(): Promise<Thread[]> {
    return [...this.threads.values()];
  }

  async setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    thread.sessions[agentId] = sessionId;
  }
}

export class InMemoryMessageStore implements MessageStore {
  private readonly messages = new Map<string, Message[]>();

  private listRaw(threadId: string): Message[] {
    return this.messages.get(threadId) ?? [];
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
    const list = this.listRaw(input.threadId);
    list.push(message);
    this.messages.set(input.threadId, list);
    return message;
  }

  async get(threadId: string, messageId: string): Promise<Message | null> {
    return this.listRaw(threadId).find((m) => m.id === messageId) ?? null;
  }

  async list(threadId: string): Promise<Message[]> {
    return [...this.listRaw(threadId)];
  }

  async patch(
    threadId: string,
    messageId: string,
    patch: Partial<Omit<Message, 'id' | 'threadId' | 'createdAt'>>,
  ): Promise<Message> {
    const list = this.listRaw(threadId);
    const index = list.findIndex((m) => m.id === messageId);
    const existing = list[index];
    if (!existing) throw new Error(`消息不存在: ${messageId}`);
    const updated = { ...existing, ...patch };
    list[index] = updated;
    return updated;
  }
}
