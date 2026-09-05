import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  generateApprovalId,
  generateEvidenceId,
  isVoidableApprovalStatus,
} from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  AuditRow,
  EvidenceEntry,
  Message,
  PendingHop,
  Skill,
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
  SkillStore,
  ThreadStore,
} from './ports.js';
import { filterAuditRows } from './ports.js';

export class InMemoryThreadStore implements ThreadStore {
  private readonly threads = new Map<string, Thread>();
  private readonly leases = new Map<string, { owner: string; expiresAt: number }>();

  private liveLease(threadId: string): { owner: string; expiresAt: number } | null {
    const cur = this.leases.get(threadId);
    if (!cur) return null;
    if (cur.expiresAt <= Date.now()) {
      this.leases.delete(threadId);
      return null;
    }
    return cur;
  }

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
    this.threads.set(id, thread);
    return thread;
  }

  private ensureHopId(thread: Thread): Thread {
    if (thread.pendingHop && !thread.pendingHop.id) {
      thread.pendingHop.id = randomUUID();
    }
    return thread;
  }

  async get(id: string): Promise<Thread | null> {
    const thread = this.threads.get(id);
    return thread ? this.ensureHopId(thread) : null;
  }

  async list(): Promise<Thread[]> {
    return [...this.threads.values()].map((t) => this.ensureHopId(t));
  }

  async setLastApprovedSha(threadId: string, sha: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread?.repo) return;
    thread.repo = { ...thread.repo, lastApprovedSha: sha };
  }

  async setSeenPrCommentIds(threadId: string, ids: string[]): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread?.repo) return;
    thread.repo = { ...thread.repo, seenPrCommentIds: ids };
  }

  async setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    thread.sessions[agentId] = sessionId;
  }

  async setPendingHop(threadId: string, hop: PendingHop | null): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (hop) thread.pendingHop = hop;
    else delete thread.pendingHop;
  }

  async enqueuePendingHop(threadId: string, hop: PendingHop): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    thread.pendingQueue = [...(thread.pendingQueue ?? []), hop];
  }

  async promoteQueuedHop(threadId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (thread.pendingHop) return false;
    const next = thread.pendingQueue?.[0];
    if (!next) return false;
    thread.pendingHop = next;
    const rest = thread.pendingQueue?.slice(1) ?? [];
    if (rest.length > 0) thread.pendingQueue = rest;
    else delete thread.pendingQueue;
    return true;
  }

  async clearPendingQueue(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    delete thread.pendingQueue;
  }

  async clearPendingHopIfSame(threadId: string, hopId: string): Promise<boolean> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (thread.pendingHop?.id !== hopId) return false;
    delete thread.pendingHop;
    return true;
  }

  async claimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<boolean> {
    if (this.liveLease(threadId)) return false;
    this.leases.set(threadId, { owner: runnerId, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async forceClaimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<void> {
    this.leases.set(threadId, { owner: runnerId, expiresAt: Date.now() + ttlMs });
  }

  async renewPendingHopLease(threadId: string, runnerId: string, ttlMs: number): Promise<boolean> {
    const cur = this.liveLease(threadId);
    if (!cur || cur.owner !== runnerId) return false;
    cur.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async releasePendingHopLease(threadId: string, runnerId: string): Promise<void> {
    const cur = this.liveLease(threadId);
    if (!cur || cur.owner !== runnerId) return;
    this.leases.delete(threadId);
  }

  async rename(id: string, title: string): Promise<Thread | null> {
    const thread = this.threads.get(id);
    if (!thread) return null;
    thread.title = title;
    return thread;
  }

  async delete(id: string): Promise<boolean> {
    return this.threads.delete(id);
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
      hopId: input.hopId,
      usage: input.usage,
      error: input.error,
      createdAt: new Date().toISOString(),
      ...(input.role === 'system'
        ? {
            systemKind: input.systemKind,
            ...(input.systemMeta ? { systemMeta: input.systemMeta } : {}),
          }
        : {}),
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

  async deleteAll(threadId: string): Promise<void> {
    this.messages.delete(threadId);
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

  async updateAutoApprove(
    agentId: string,
    autoApprove: boolean,
  ): Promise<AgentProfile | null> {
    const existing = this.profiles.get(agentId);
    if (!existing) return null;
    const updated: AgentProfile = { ...existing, autoApprove };
    this.profiles.set(agentId, updated);
    return updated;
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
    const updated: EvidenceEntry = {
      ...entry,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
    };
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

export class InMemorySkillStore implements SkillStore {
  private readonly skills = new Map<string, Skill>();

  constructor(skills: Skill[] = []) {
    for (const skill of skills) this.skills.set(skill.id, skill);
  }

  async list(): Promise<Skill[]> {
    return [...this.skills.values()];
  }

  async get(id: string): Promise<Skill | null> {
    return this.skills.get(id) ?? null;
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly cards = new Map<string, ApprovalCard>();

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
    this.cards.set(card.id, card);
    return card;
  }

  async get(id: string): Promise<ApprovalCard | null> {
    return this.cards.get(id) ?? null;
  }

  async list(threadId?: string): Promise<ApprovalCard[]> {
    const all = [...this.cards.values()];
    return threadId ? all.filter((c) => c.threadId === threadId) : all;
  }

  async setReviewComment(id: string, comment: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card) return null;
    const updated: ApprovalCard = { ...card, reviewComment: comment, status: 'reviewing' };
    this.cards.set(id, updated);
    return updated;
  }

  async approve(id: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'approved' };
    this.cards.set(id, updated);
    return updated;
  }

  async reject(id: string, reason: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'rejected', rejectReason: reason };
    this.cards.set(id, updated);
    return updated;
  }

  async markApplied(id: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || card.status !== 'approved') return null;
    const updated: ApprovalCard = { ...card, status: 'applied' };
    this.cards.set(id, updated);
    return updated;
  }

  async void(id: string, reason: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || !isVoidableApprovalStatus(card.status)) return null;
    const updated: ApprovalCard = { ...card, status: 'voided', voidReason: reason };
    this.cards.set(id, updated);
    return updated;
  }
}

export class InMemoryAuditStore implements AuditStore {
  private readonly rows: AuditRow[] = [];

  async append(input: Omit<AuditRow, 'id' | 'ts'>): Promise<AuditRow> {
    const row: AuditRow = {
      ...input,
      id: randomUUID(),
      ts: new Date().toISOString(),
    };
    this.rows.unshift(row);
    return row;
  }

  async list(query?: AuditListQuery): Promise<AuditRow[]> {
    return filterAuditRows(this.rows, query);
  }
}
