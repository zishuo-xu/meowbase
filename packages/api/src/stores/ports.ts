import type {
  AgentId,
  AgentProfile,
  ApprovalCard,
  AuditAction,
  AuditActor,
  AuditRow,
  EvidenceEntry,
  EvidenceKind,
  InboundMessage,
  Message,
  PendingHop,
  Skill,
  SopBoard,
  SystemKind,
  SystemMeta,
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
    repo?: Pick<ThreadRepo, 'path' | 'baseBranch'> &
      Partial<Pick<ThreadRepo, 'branch' | 'lastApprovedSha' | 'allowRemote'>>;
  }): Promise<Thread>;
  /** 批准落地成功后记下 HEAD,下一张卡从这里开始 diff */
  setLastApprovedSha(threadId: string, sha: string): Promise<void>;
  /** PR 评论回流的指纹;只在消息落库成功后更新 */
  setSeenPrCommentIds(threadId: string, ids: string[]): Promise<void>;
  /** PR CI 回流的指纹;只在消息落库成功后更新 */
  setSeenPrCheckIds(threadId: string, ids: string[]): Promise<void>;
  /** PR 冲突回流的上次 mergeable;只在消息落库成功后更新 */
  setSeenPrMergeable(
    threadId: string,
    value: 'CONFLICTING' | 'MERGEABLE' | null,
  ): Promise<void>;
  get(id: string): Promise<Thread | null>;
  list(): Promise<Thread[]>;
  setSession(threadId: string, agentId: AgentId, sessionId: string): Promise<void>;
  setPendingHop(threadId: string, hop: PendingHop | null): Promise<void>;
  /** 槽里已有棒时,后来交的棒排进队尾。 */
  enqueuePendingHop(threadId: string, hop: PendingHop): Promise<void>;
  /** 槽空时把队头填进槽。槽里有人、或队空则 false。 */
  promoteQueuedHop(threadId: string): Promise<boolean>;
  /** 整队清掉,槽不动。 */
  clearPendingQueue(threadId: string): Promise<void>;
  /** 人话排进队尾。 */
  enqueueInbound(threadId: string, content: string): Promise<InboundMessage>;
  /** 取出队头;空则 null。 */
  shiftInbound(threadId: string): Promise<InboundMessage | null>;
  /** 人话队整队清掉。 */
  clearInboundQueue(threadId: string): Promise<void>;
  /** 写入家规告示牌。 */
  setSopBoard(threadId: string, board: SopBoard): Promise<void>;
  /** 把指定人话挪到队头。找不到 false。 */
  steerInbound(threadId: string, id: string): Promise<boolean>;
  /** 把指定交棒挪到队头。找不到 false。不碰槽里那一棒。 */
  steerPendingHop(threadId: string, hopId: string): Promise<boolean>;
  /** 只清自己那一棒:跑的过程中猫又交棒时槽里已是下一棒,不能无条件清。 */
  clearPendingHopIfSame(threadId: string, hopId: string): Promise<boolean>;
  /** 抢下这一棒的主人:抢到才跑,防止两个跑者跑同一 hop。 */
  claimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<boolean>;
  /** 开机那一次强抢:单实例下没有活着的主人,死者的租约不该拦住续跑。 */
  forceClaimPendingHop(threadId: string, runnerId: string, ttlMs: number): Promise<void>;
  /** 跑的时候续期;不是主人则 false。 */
  renewPendingHopLease(threadId: string, runnerId: string, ttlMs: number): Promise<boolean>;
  /** 跑完释放;不是主人则不动。 */
  releasePendingHopLease(threadId: string, runnerId: string): Promise<void>;
  rename(id: string, title: string): Promise<Thread | null>;
  delete(id: string): Promise<boolean>;
}

type AppendBase = {
  threadId: string;
  agentId?: AgentId;
  content: string;
  status: Message['status'];
  sessionId?: string;
  hopId?: string;
  usage?: Message['usage'];
  error?: string;
  skillIds?: string[];
  evidenceIds?: string[];
  activities?: Message['activities'];
};

/** role: system 必须带 kind,避免新写入点忘打标。user/assistant 禁止带 kind。 */
export type AppendMessageInput =
  | (AppendBase & {
      role: 'system';
      systemKind: SystemKind;
      systemMeta?: SystemMeta;
    })
  | (AppendBase & {
      role: 'user' | 'assistant';
      systemKind?: never;
      systemMeta?: never;
    });

export interface MessageStore {
  append(input: AppendMessageInput): Promise<Message>;
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
  /** 用文件里的确认条目覆盖索引。文件是真相。 */
  upsertConfirmed(entry: EvidenceEntry): Promise<void>;
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
  void(id: string, reason: string): Promise<ApprovalCard | null>;
}

export const AUDIT_LIST_DEFAULT = 100;
export const AUDIT_LIST_MAX = 500;
/** Redis 全局列表封顶,避免 audit:all 无限长。 */
export const AUDIT_GLOBAL_CAP = 5000;

export interface AuditListQuery {
  threadId?: string;
  actor?: AuditActor;
  action?: AuditAction;
  since?: string;
  limit?: number;
}

export interface AuditStore {
  append(input: Omit<AuditRow, 'id' | 'ts'>): Promise<AuditRow>;
  list(query?: AuditListQuery): Promise<AuditRow[]>;
}

export type AppStores = {
  threads: ThreadStore;
  messages: MessageStore;
  profiles: ProfileStore;
  evidence: EvidenceStore;
  skills: SkillStore;
  approvals: ApprovalStore;
  audit: AuditStore;
};

export function resolveAuditLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return AUDIT_LIST_DEFAULT;
  return Math.min(Math.max(1, Math.floor(limit)), AUDIT_LIST_MAX);
}

export function filterAuditRows(rows: AuditRow[], query?: AuditListQuery): AuditRow[] {
  const limit = resolveAuditLimit(query?.limit);
  return rows
    .filter((row) => {
      if (query?.threadId && row.threadId !== query.threadId) return false;
      if (query?.actor && row.actor !== query.actor) return false;
      if (query?.action && row.action !== query.action) return false;
      if (query?.since && row.ts < query.since) return false;
      return true;
    })
    .slice(0, limit);
}
