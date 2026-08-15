import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { generateEvidenceId } from '@meowbase/shared';
import type { AgentId, AgentProfile, EvidenceEntry, Message, Thread } from '@meowbase/shared';
import type { EvidenceStore, MessageStore, ProfileStore, ThreadStore } from './ports.js';

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

export class InMemoryProfileStore implements ProfileStore {
  private readonly profiles = new Map<string, AgentProfile>();

  async create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile> {
    const record: AgentProfile = { ...profile, createdAt: new Date().toISOString() };
    this.profiles.set(record.agentId, record);
    return record;
  }

  async get(agentId: string): Promise<AgentProfile | null> {
    return this.profiles.get(agentId) ?? null;
  }

  async list(): Promise<AgentProfile[]> {
    return [...this.profiles.values()];
  }
}

export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly entries = new Map<string, EvidenceEntry>();

  async createDraft(input: {
    threadId: string;
    kind: EvidenceEntry['kind'];
    title: string;
    content: string;
  }): Promise<EvidenceEntry> {
    const entry: EvidenceEntry = {
      id: generateEvidenceId(),
      threadId: input.threadId,
      kind: input.kind,
      title: input.title,
      content: input.content,
      status: 'draft',
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.id, entry);
    return entry;
  }

  async confirm(id: string): Promise<EvidenceEntry | null> {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'draft') return null;
    const updated: EvidenceEntry = { ...entry, status: 'confirmed' };
    this.entries.set(id, updated);
    return updated;
  }

  async get(id: string): Promise<EvidenceEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async list(threadId?: string): Promise<EvidenceEntry[]> {
    const all = [...this.entries.values()];
    return threadId ? all.filter((e) => e.threadId === threadId) : all;
  }
}
