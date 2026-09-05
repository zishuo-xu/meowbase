import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import {
  generateApprovalId,
  generateEvidenceId,
  isUrgentInbound,
  isVoidableApprovalStatus,
  moveQueueItem,
} from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  AuditRow,
  EvidenceEntry,
  InboundMessage,
  Message,
  PendingHop,
  SopBoard,
  Thread,
  ThreadRepo,
} from '@meowbase/shared';
import type {
  ApprovalStore,
  AuditListQuery,
  AuditStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  ThreadStore,
} from './ports.js';
import { AUDIT_GLOBAL_CAP, filterAuditRows } from './ports.js';

function moveToFront<T>(list: T[] | undefined, match: (item: T) => boolean): T[] | null {
  if (!list || list.length === 0) return null;
  const index = list.findIndex(match);
  if (index < 0) return null;
  if (index === 0) return [...list];
  const item = list[index]!;
  return [item, ...list.slice(0, index), ...list.slice(index + 1)];
}

function threadKey(id: string): string {
  return `thread:${id}`;
}

function messageKey(threadId: string): string {
  return `thread:${threadId}:messages`;
}

function hopLeaseKey(threadId: string): string {
  return `hoplease:${threadId}`;
}

const RENEW_HOP_LEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_HOP_LEASE = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

/** 比独立 pendingHopId 字段,避免 Lua 里 cjson.decode。写 hop 时一起写这个字段。 */
const CLEAR_PENDING_HOP_IF_SAME = `
if redis.call('hget', KEYS[1], 'pendingHopId') == ARGV[1] then
  redis.call('hdel', KEYS[1], 'pendingHop', 'pendingHopId')
  return 1
end
return 0
`;

export class RedisThreadStore implements ThreadStore {
  constructor(private readonly redis: Redis) {}

  async create(input: {
    title: string;
    primaryAgentId: AgentId;
    workdirBase?: string;
    repo?: Pick<ThreadRepo, 'path' | 'baseBranch'> &
      Partial<Pick<ThreadRepo, 'branch' | 'lastApprovedSha' | 'allowRemote'>>;
  }): Promise<Thread> {
    const id = randomUUID();
    const thread: Thread = {
      id,
      title: input.title,
      primaryAgentId: input.primaryAgentId,
      workdir: join(input.workdirBase ?? 'work', id),
      sessions: {},
      createdAt: new Date().toISOString(),
      ...(input.repo
        ? {
            repo: {
              path: input.repo.path,
              baseBranch: input.repo.baseBranch,
              branch: input.repo.branch ?? `meow/${id}`,
              ...(input.repo.lastApprovedSha
                ? { lastApprovedSha: input.repo.lastApprovedSha }
                : {}),
              ...(input.repo.allowRemote === true ? { allowRemote: true } : {}),
            },
          }
        : {}),
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
        ...(thread.repo ? { repo: JSON.stringify(thread.repo) } : {}),
      })
      .sadd('thread:index', id)
      .exec();
    return thread;
  }

  /** 旧记录没有 id 时补一个并写回,开机扫才不会炸,清棒才对得上。 */
  private async hydratePendingHop(
    threadId: string,
    raw: string,
    storedId?: string,
  ): Promise<PendingHop> {
    const hop = JSON.parse(raw) as PendingHop;
    if (hop.id) return hop;
    hop.id = storedId || randomUUID();
    await this.redis.hset(threadKey(threadId), {
      pendingHop: JSON.stringify(hop),
      pendingHopId: hop.id,
    });
    return hop;
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
      ...(raw.pendingHop
        ? { pendingHop: await this.hydratePendingHop(id, raw.pendingHop, raw.pendingHopId) }
        : {}),
      ...(raw.pendingQueue
        ? { pendingQueue: JSON.parse(raw.pendingQueue) as PendingHop[] }
        : {}),
      ...(raw.inboundQueue
        ? { inboundQueue: JSON.parse(raw.inboundQueue) as InboundMessage[] }
        : {}),
      ...(raw.sop ? { sop: JSON.parse(raw.sop) as SopBoard } : {}),
      ...(raw.relayPairs ? { relayPairs: JSON.parse(raw.relayPairs) as Record<string, number> } : {}),
      ...(raw.repo ? { repo: JSON.parse(raw.repo) as ThreadRepo } : {}),
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

  async setLastApprovedSha(threadId: string, sha: string): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread?.repo) return;
    thread.repo = { ...thread.repo, lastApprovedSha: sha };
    await this.redis.hset(threadKey(threadId), 'repo', JSON.stringify(thread.repo));
  }

  async setSeenPrCommentIds(threadId: string, ids: string[]): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread?.repo) return;
    thread.repo = { ...thread.repo, seenPrCommentIds: ids };
    await this.redis.hset(threadKey(threadId), 'repo', JSON.stringify(thread.repo));
  }

  async setSeenPrCheckIds(threadId: string, ids: string[]): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread?.repo) return;
    thread.repo = { ...thread.repo, seenPrCheckIds: ids };
    await this.redis.hset(threadKey(threadId), 'repo', JSON.stringify(thread.repo));
  }

  async setSeenPrMergeable(
    threadId: string,
    value: 'CONFLICTING' | 'MERGEABLE' | null,
  ): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread?.repo) return;
    const { seenPrMergeable: _drop, ...rest } = thread.repo;
    thread.repo = value ? { ...rest, seenPrMergeable: value } : rest;
    await this.redis.hset(threadKey(threadId), 'repo', JSON.stringify(thread.repo));
  }

  async setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    thread.sessions[agentId] = sessionId;
    await this.redis.hset(threadKey(threadId), 'sessions', JSON.stringify(thread.sessions));
  }

  async setPendingHop(threadId: string, hop: PendingHop | null): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (hop) {
      await this.redis.hset(threadKey(threadId), {
        pendingHop: JSON.stringify(hop),
        pendingHopId: hop.id,
      });
    } else {
      await this.redis.hdel(threadKey(threadId), 'pendingHop', 'pendingHopId');
    }
  }

  async enqueuePendingHop(threadId: string, hop: PendingHop): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    const queue = [...(thread.pendingQueue ?? []), hop];
    await this.redis.hset(threadKey(threadId), 'pendingQueue', JSON.stringify(queue));
  }

  async promoteQueuedHop(threadId: string): Promise<boolean> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (thread.pendingHop) return false;
    const next = thread.pendingQueue?.[0];
    if (!next) return false;
    const rest = thread.pendingQueue?.slice(1) ?? [];
    if (rest.length > 0) {
      await this.redis.hset(threadKey(threadId), {
        pendingHop: JSON.stringify(next),
        pendingHopId: next.id,
        pendingQueue: JSON.stringify(rest),
      });
    } else {
      await this.redis
        .multi()
        .hset(threadKey(threadId), {
          pendingHop: JSON.stringify(next),
          pendingHopId: next.id,
        })
        .hdel(threadKey(threadId), 'pendingQueue')
        .exec();
    }
    return true;
  }

  async clearPendingQueue(threadId: string): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    await this.redis.hdel(threadKey(threadId), 'pendingQueue');
  }

  async enqueueInbound(threadId: string, content: string): Promise<InboundMessage> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    const urgent = isUrgentInbound(content);
    const item: InboundMessage = { id: randomUUID(), content, ...(urgent ? { urgent: true } : {}) };
    const queue = thread.inboundQueue ?? [];
    const next = urgent ? [item, ...queue] : [...queue, item];
    await this.redis.hset(threadKey(threadId), 'inboundQueue', JSON.stringify(next));
    return item;
  }

  async shiftInbound(threadId: string): Promise<InboundMessage | null> {
    const thread = await this.hydrate(threadId);
    if (!thread) return null;
    const next = thread.inboundQueue?.[0];
    if (!next) return null;
    const rest = thread.inboundQueue?.slice(1) ?? [];
    if (rest.length > 0) {
      await this.redis.hset(threadKey(threadId), 'inboundQueue', JSON.stringify(rest));
    } else {
      await this.redis.hdel(threadKey(threadId), 'inboundQueue');
    }
    return next;
  }

  async clearInboundQueue(threadId: string): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    await this.redis.hdel(threadKey(threadId), 'inboundQueue');
  }

  async steerInbound(threadId: string, id: string, beforeId?: string | null): Promise<boolean> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    const steered = moveQueueItem(thread.inboundQueue ?? [], id, beforeId);
    if (!steered) return false;
    await this.redis.hset(threadKey(threadId), 'inboundQueue', JSON.stringify(steered));
    return true;
  }

  async steerPendingHop(threadId: string, hopId: string, beforeId?: string | null): Promise<boolean> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    const steered = moveQueueItem(thread.pendingQueue ?? [], hopId, beforeId);
    if (!steered) return false;
    await this.redis.hset(threadKey(threadId), 'pendingQueue', JSON.stringify(steered));
    return true;
  }

  async setSopBoard(threadId: string, board: SopBoard): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    await this.redis.hset(threadKey(threadId), 'sop', JSON.stringify(board));
  }

  async setRelayPairs(threadId: string, pairs: Record<string, number>): Promise<void> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    await this.redis.hset(threadKey(threadId), 'relayPairs', JSON.stringify(pairs));
  }

  async clearPendingHopIfSame(threadId: string, hopId: string): Promise<boolean> {
    const thread = await this.hydrate(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    const n = await this.redis.eval(CLEAR_PENDING_HOP_IF_SAME, 1, threadKey(threadId), hopId);
    return n === 1;
  }

  async claimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<boolean> {
    const reply = await this.redis.set(hopLeaseKey(threadId), runnerId, 'PX', ttlMs, 'NX');
    return reply === 'OK';
  }

  async forceClaimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<void> {
    await this.redis.set(hopLeaseKey(threadId), runnerId, 'PX', ttlMs);
  }

  async renewPendingHopLease(threadId: string, runnerId: string, ttlMs: number): Promise<boolean> {
    const n = await this.redis.eval(RENEW_HOP_LEASE, 1, hopLeaseKey(threadId), runnerId, String(ttlMs));
    return n === 1;
  }

  async releasePendingHopLease(threadId: string, runnerId: string): Promise<void> {
    await this.redis.eval(RELEASE_HOP_LEASE, 1, hopLeaseKey(threadId), runnerId);
  }

  async rename(id: string, title: string): Promise<Thread | null> {
    const thread = await this.hydrate(id);
    if (!thread) return null;
    thread.title = title;
    await this.redis.hset(threadKey(id), 'title', title);
    return thread;
  }

  async delete(id: string): Promise<boolean> {
    const existed = await this.hydrate(id);
    if (!existed) return false;
    await this.redis.multi().del(threadKey(id)).srem('thread:index', id).exec();
    return true;
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
      hopId: input.hopId,
      usage: input.usage,
      error: input.error,
      ...(input.skillIds && input.skillIds.length > 0 ? { skillIds: input.skillIds } : {}),
      ...(input.evidenceIds && input.evidenceIds.length > 0 ? { evidenceIds: input.evidenceIds } : {}),
      ...(input.activities && input.activities.length > 0 ? { activities: input.activities } : {}),
      createdAt: new Date().toISOString(),
      ...(input.role === 'system'
        ? {
            systemKind: input.systemKind,
            ...(input.systemMeta ? { systemMeta: input.systemMeta } : {}),
          }
        : {}),
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

  async deleteAll(threadId: string): Promise<void> {
    await this.redis.del(messageKey(threadId));
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
      autoApprove: raw.autoApprove === 'true',
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

  async updateAutoApprove(
    agentId: string,
    autoApprove: boolean,
  ): Promise<AgentProfile | null> {
    const existing = await this.hydrate(agentId);
    if (!existing) return null;
    await this.redis.hset(profileKey(agentId), 'autoApprove', String(autoApprove));
    return this.hydrate(agentId);
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
      ...(raw.confirmedAt ? { confirmedAt: raw.confirmedAt } : {}),
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
    const confirmedAt = new Date().toISOString();
    await this.redis.hset(evidenceKey(id), { status: 'confirmed', confirmedAt });
    return this.hydrate(id);
  }

  async upsertConfirmed(entry: EvidenceEntry): Promise<void> {
    await this.redis
      .multi()
      .hset(evidenceKey(entry.id), {
        id: entry.id,
        threadId: entry.threadId,
        kind: entry.kind,
        title: entry.title,
        content: entry.content,
        status: 'confirmed',
        createdAt: entry.createdAt,
        ...(entry.confirmedAt ? { confirmedAt: entry.confirmedAt } : {}),
      })
      .sadd('evidence:index', entry.id)
      .exec();
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
      voidReason: raw.voidReason || undefined,
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
      voidReason: card.voidReason ?? '',
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

  async void(id: string, reason: string): Promise<ApprovalCard | null> {
    const card = await this.hydrate(id);
    if (!card || !isVoidableApprovalStatus(card.status)) return null;
    const updated: ApprovalCard = { ...card, status: 'voided', voidReason: reason };
    await this.write(updated);
    return updated;
  }
}

function auditThreadKey(threadId: string): string {
  return `audit:${threadId}`;
}

const AUDIT_ALL_KEY = 'audit:all';

export class RedisAuditStore implements AuditStore {
  constructor(private readonly redis: Redis) {}

  async append(input: Omit<AuditRow, 'id' | 'ts'>): Promise<AuditRow> {
    const row: AuditRow = {
      ...input,
      id: randomUUID(),
      ts: new Date().toISOString(),
    };
    const json = JSON.stringify(row);
    await this.redis
      .multi()
      .lpush(auditThreadKey(input.threadId), json)
      .lpush(AUDIT_ALL_KEY, json)
      .ltrim(AUDIT_ALL_KEY, 0, AUDIT_GLOBAL_CAP - 1)
      .exec();
    return row;
  }

  async list(query?: AuditListQuery): Promise<AuditRow[]> {
    const key = query?.threadId ? auditThreadKey(query.threadId) : AUDIT_ALL_KEY;
    const raw = await this.redis.lrange(key, 0, -1);
    const rows: AuditRow[] = [];
    for (const item of raw) {
      try {
        rows.push(JSON.parse(item) as AuditRow);
      } catch {
        // 坏行跳过,不当成整次 list 失败
      }
    }
    return filterAuditRows(rows, query);
  }
}
