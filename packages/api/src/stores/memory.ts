import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { generateApprovalId, generateEvidenceId } from '@meowbase/shared';
import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  EvidenceEntry,
  Message,
  PendingHop,
  Skill,
  Thread,
} from '@meowbase/shared';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from './ports.js';

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

  async setPendingHop(threadId: string, hop: PendingHop | null): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`线程不存在: ${threadId}`);
    if (hop) thread.pendingHop = hop;
    else delete thread.pendingHop;
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
}
