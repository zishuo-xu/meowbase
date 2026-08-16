import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { generateApprovalId, generateEvidenceId } from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  EvidenceEntry,
  Message,
  Thread,
} from '@meowbase/shared';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  ThreadStore,
} from './ports.js';

function threadKey(id: string): string {
  return `thread:${id}`;
}

function messageKey(threadId: string): string {
  return `thread:${threadId}:messages`;
}

export class RedisThreadStore implements ThreadStore {
  constructor(private readonly redis: Redis) {}

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
    const existing = all[index];
    if (!existing) throw new Error(`消息不存在: ${messageId}`);
    const updated = { ...existing, ...patch };
    all[index] = updated;
    await this.redis.set(messageKey(threadId), JSON.stringify(all));
    return updated;
  }
}

function profileKey(agentId: string): string {
  return `profile:${agentId}`;
}

function evidenceKey(id: string): string {
  return `evidence:${id}`;
}

export class RedisProfileStore implements ProfileStore {
  constructor(private readonly redis: Redis) {}

  async create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile> {
    const record: AgentProfile = { ...profile, createdAt: new Date().toISOString() };
    await this.redis
      .multi()
      .hset(profileKey(record.agentId), {
        agentId: record.agentId,
        name: record.name,
        personality: record.personality,
        role: record.role,
        expertise: JSON.stringify(record.expertise),
        createdAt: record.createdAt,
      })
      .sadd('profile:index', record.agentId)
      .exec();
    return record;
  }

  private async hydrate(agentId: string): Promise<AgentProfile | null> {
    const raw = await this.redis.hgetall(profileKey(agentId));
    if (!raw.agentId) return null;
    return {
      agentId: raw.agentId as AgentId,
      name: raw.name ?? '',
      personality: raw.personality ?? '',
      role: raw.role ?? '',
      expertise: JSON.parse(raw.expertise ?? '[]') as string[],
      createdAt: raw.createdAt ?? '',
    };
  }

  async get(agentId: string): Promise<AgentProfile | null> {
    return this.hydrate(agentId);
  }

  async list(): Promise<AgentProfile[]> {
    const ids = await this.redis.smembers('profile:index');
    const profiles: AgentProfile[] = [];
    for (const id of ids) {
      const profile = await this.hydrate(id);
      if (profile) profiles.push(profile);
    }
    return profiles;
  }
}

export class RedisEvidenceStore implements EvidenceStore {
  constructor(private readonly redis: Redis) {}

  private async hydrate(id: string): Promise<EvidenceEntry | null> {
    const raw = await this.redis.hgetall(evidenceKey(id));
    if (!raw.id) return null;
    return {
      id: raw.id,
      threadId: raw.threadId ?? '',
      kind: (raw.kind as EvidenceEntry['kind']) ?? 'fact',
      title: raw.title ?? '',
      content: raw.content ?? '',
      status: (raw.status as EvidenceEntry['status']) ?? 'draft',
      createdAt: raw.createdAt ?? '',
    };
  }

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
    await this.redis
      .multi()
      .hset(evidenceKey(entry.id), {
        id: entry.id,
        threadId: entry.threadId,
        kind: entry.kind,
        title: entry.title,
        content: entry.content,
        status: entry.status,
        createdAt: entry.createdAt,
      })
      .sadd('evidence:index', entry.id)
      .exec();
    return entry;
  }

  async confirm(id: string): Promise<EvidenceEntry | null> {
    const entry = await this.hydrate(id);
    if (!entry || entry.status !== 'draft') return null;
    await this.redis.hset(evidenceKey(id), 'status', 'confirmed');
    return this.hydrate(id);
  }

  async get(id: string): Promise<EvidenceEntry | null> {
    return this.hydrate(id);
  }

  async list(threadId?: string): Promise<EvidenceEntry[]> {
    const ids = await this.redis.smembers('evidence:index');
    const entries: EvidenceEntry[] = [];
    for (const id of ids) {
      const entry = await this.hydrate(id);
      if (entry && (!threadId || entry.threadId === threadId)) entries.push(entry);
    }
    return entries;
  }
}

function approvalKey(id: string): string {
  return `approval:${id}`;
}

export class RedisApprovalStore implements ApprovalStore {
  constructor(private readonly redis: Redis) {}

  private async hydrate(id: string): Promise<ApprovalCard | null> {
    const raw = await this.redis.hgetall(approvalKey(id));
    if (!raw.id) return null;
    return {
      id: raw.id,
      threadId: raw.threadId ?? '',
      writerAgentId: (raw.writerAgentId as AgentId) ?? 'claude',
      reviewerAgentId: (raw.reviewerAgentId as AgentId) ?? 'opencode',
      status: (raw.status as ApprovalCard['status']) ?? 'draft',
      diffText: raw.diffText ?? '',
      diffStat: raw.diffStat ?? '',
      reviewComment: raw.reviewComment || undefined,
      rejectReason: raw.rejectReason || undefined,
      createdAt: raw.createdAt ?? '',
    };
  }

  private async write(card: ApprovalCard): Promise<void> {
    await this.redis.hset(approvalKey(card.id), {
      id: card.id,
      threadId: card.threadId,
      writerAgentId: card.writerAgentId,
      reviewerAgentId: card.reviewerAgentId,
      status: card.status,
      diffText: card.diffText,
      diffStat: card.diffStat,
      reviewComment: card.reviewComment ?? '',
      rejectReason: card.rejectReason ?? '',
      createdAt: card.createdAt,
    });
  }

  async create(input: Parameters<ApprovalStore['create']>[0]): Promise<ApprovalCard> {
    const card: ApprovalCard = {
      id: generateApprovalId(),
      threadId: input.threadId,
      writerAgentId: input.writerAgentId,
      reviewerAgentId: input.reviewerAgentId,
      status: 'draft',
      diffText: input.diffText,
      diffStat: input.diffStat,
      createdAt: new Date().toISOString(),
    };
    await this.write(card);
    await this.redis.sadd('approval:index', card.id);
    return card;
  }

  async get(id: string): Promise<ApprovalCard | null> {
    return this.hydrate(id);
  }

  async list(threadId?: string): Promise<ApprovalCard[]> {
    const ids = await this.redis.smembers('approval:index');
    const cards: ApprovalCard[] = [];
    for (const id of ids) {
      const card = await this.hydrate(id);
      if (card && (!threadId || card.threadId === threadId)) cards.push(card);
    }
    return cards;
  }

  async setReviewComment(id: string, comment: string): Promise<ApprovalCard | null> {
    const card = await this.hydrate(id);
    if (!card) return null;
    const updated: ApprovalCard = { ...card, reviewComment: comment, status: 'reviewing' };
    await this.write(updated);
    return updated;
  }

  async approve(id: string): Promise<ApprovalCard | null> {
    const card = await this.hydrate(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'approved' };
    await this.write(updated);
    return updated;
  }

  async reject(id: string, reason: string): Promise<ApprovalCard | null> {
    const card = await this.hydrate(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'rejected', rejectReason: reason };
    await this.write(updated);
    return updated;
  }

  async markApplied(id: string): Promise<ApprovalCard | null> {
    const card = await this.hydrate(id);
    if (!card || card.status !== 'approved') return null;
    const updated: ApprovalCard = { ...card, status: 'applied' };
    await this.write(updated);
    return updated;
  }
}
