import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  EvidenceEntry,
  EvidenceKind,
  Message,
  PendingHop,
  Skill,
  Thread,
  ThreadRepo,
} from '@meowbase/shared';

export interface ThreadStore {
  create(input: {
    title: string;
    primaryAgentId: AgentId;
    /** 线程工作目录的基准路径;不传时默认相对路径 'work'(与历史行为一致) */
    workdirBase?: string;
    /** 绑真实仓库时只传 path + baseBranch;store 补全 branch 为 meow/<id> */
    repo?: Pick<ThreadRepo, 'path' | 'baseBranch'> & Partial<Pick<ThreadRepo, 'branch'>>;
  }): Promise<Thread>;
  get(id: string): Promise<Thread | null>;
  list(): Promise<Thread[]>;
  setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void>;
  setPendingHop(threadId: string, hop: PendingHop | null): Promise<void>;
  /** 只清自己那一棒:跑的过程中猫又交棒时槽里已是下一棒,不能无条件清。 */
  clearPendingHopIfSame(threadId: string, hopId: string): Promise<boolean>;
  /** 抢下这一棒的主人:抢到才跑,防止两个跑者跑同一 hop。 */
  claimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<boolean>;
  /** 跑的时候续期;不是主人则 false。 */
  renewPendingHopLease(threadId: string, runnerId: string, ttlMs: number): Promise<boolean>;
  /** 跑完释放;不是主人则不动。 */
  releasePendingHopLease(threadId: string, runnerId: string): Promise<void>;
  rename(id: string, title: string): Promise<Thread | null>;
  delete(id: string): Promise<boolean>;
}

export interface MessageStore {
  append(input: {
    threadId: string;
    role: Message['role'];
    agentId?: AgentId;
    content: string;
    status: Message['status'];
    sessionId?: string;
    hopId?: string;
    usage?: Message['usage'];
    error?: string;
  }): Promise<Message>;
  get(threadId: string, messageId: string): Promise<Message | null>;
  list(threadId: string): Promise<Message[]>;
  deleteAll(threadId: string): Promise<void>;
  patch(
    threadId: string,
    messageId: string,
    patch: Partial<Omit<Message, 'id' | 'threadId' | 'createdAt'>>,
  ): Promise<Message>;
}

export interface ProfileStore {
  create(profile: Omit<AgentProfile, 'createdAt'>): Promise<AgentProfile>;
  get(agentId: AgentId): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
  /** 更新审批策略(身份字段不可变,仅 autoApprove 可改) */
  updateAutoApprove(agentId: AgentId, autoApprove: boolean): Promise<AgentProfile | null>;
}

export interface EvidenceStore {
  createDraft(input: {
    threadId: string;
    kind: EvidenceKind;
    title: string;
    content: string;
  }): Promise<EvidenceEntry>;
  confirm(id: string): Promise<EvidenceEntry | null>;
  get(id: string): Promise<EvidenceEntry | null>;
  list(threadId?: string): Promise<EvidenceEntry[]>;
}

export interface SkillStore {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill | null>;
}

export interface ApprovalStore {
  create(input: {
    threadId: string;
    writerAgentId: AgentId;
    reviewerAgentId: AgentId;
    diffText: string;
    diffStat: string;
  }): Promise<ApprovalCard>;
  get(id: string): Promise<ApprovalCard | null>;
  list(threadId?: string): Promise<ApprovalCard[]>;
  setReviewComment(id: string, comment: string): Promise<ApprovalCard | null>;
  approve(id: string): Promise<ApprovalCard | null>;
  reject(id: string, reason: string): Promise<ApprovalCard | null>;
  markApplied(id: string): Promise<ApprovalCard | null>;
}
