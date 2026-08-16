import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  EvidenceEntry,
  EvidenceKind,
  Message,
  Skill,
  Thread,
} from '@meowbase/shared';

export interface ThreadStore {
  create(input: {
    title: string;
    primaryAgentId: AgentId;
    /** 线程工作目录的基准路径;不传时默认相对路径 'work'(与历史行为一致) */
    workdirBase?: string;
  }): Promise<Thread>;
  get(id: string): Promise<Thread | null>;
  list(): Promise<Thread[]>;
  setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void>;
}

export interface MessageStore {
  append(input: {
    threadId: string;
    role: Message['role'];
    agentId?: AgentId;
    content: string;
    status: Message['status'];
    sessionId?: string;
    usage?: Message['usage'];
    error?: string;
  }): Promise<Message>;
  get(threadId: string, messageId: string): Promise<Message | null>;
  list(threadId: string): Promise<Message[]>;
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
