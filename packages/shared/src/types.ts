export type AgentId = 'claude' | 'gemini' | 'opencode';

export const AGENT_IDS: readonly AgentId[] = ['claude', 'gemini', 'opencode'];

/** 人在忙时插的话,当前棒跑完再送。 */
export interface InboundMessage {
  id: string;
  content: string;
  /** 行首 ! / 急 入队时置顶,仍在队里,不 abort 当前棒 */
  urgent?: boolean;
}

export type SopStage = 'idle' | 'doing' | 'reviewing' | 'waiting' | 'human';

/** 家规告示牌:平台派生,猫读、人看。不是状态机。 */
export interface SopBoard {
  stage: SopStage;
  holder?: AgentId;
  note: string;
}

/** 已交棒、下一跳还没跑。线程内最多一条。 */
export interface PendingHop {
  /** 这一棒的身份:跑完只清自己,重跑用它认消息 */
  id: string;
  to: AgentId;
  from: AgentId;
  task: string;
  goal: string;
  previousOutput: string;
  visited: AgentId[];
  firstAgent: AgentId;
  hop: number;
  /** 行首「等跑」记下的沙箱命令;跑完再叫醒同一只 */
  holdCommand?: string;
}

export interface Thread {
  id: string;
  title: string;
  primaryAgentId: AgentId;
  /** CLI 工作目录,相对 api 进程 cwd */
  workdir: string;
  /** 每个 agent 的 CLI 会话 ID(用于 --resume) */
  sessions: Partial<Record<AgentId, string>>;
  /** 交棒后本轮先结束时记下的下一跳 */
  pendingHop?: PendingHop;
  /** 槽里已有棒时,后来交的棒按 FIFO 排在后面 */
  pendingQueue?: PendingHop[];
  /** 猫还在跑时人插的话,FIFO,当前棒跑完再送 */
  inboundQueue?: InboundMessage[];
  /** 家规告示牌:平台派生,猫读、人看。不是状态机。 */
  sop?: SopBoard;
  /** 绑了真实仓库时:父仓路径、基准分支、本线程分支 */
  repo?: ThreadRepo;
  createdAt: string;
}

/** 线程绑真实仓库时的 worktree 地址 */
export interface ThreadRepo {
  path: string;
  baseBranch: string;
  branch: string;
  /** 人上次批准落地时的 HEAD；没有则审批 diff 回退到与基准分支的分叉点 */
  lastApprovedSha?: string;
  /** 准不准出仓。缺失 = 本地,不查 PR、不许推 */
  allowRemote?: boolean;
  /** 已回流过的 PR 评论 id;投成功的才记,投丢下轮再投 */
  seenPrCommentIds?: string[];
  /** 已回流过的 PR 检查指纹 name:state;投成功的才记 */
  seenPrCheckIds?: string[];
  /** 上次落地的 PR mergeable:CONFLICTING / MERGEABLE */
  seenPrMergeable?: 'CONFLICTING' | 'MERGEABLE';
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'streaming' | 'completed' | 'failed' | 'terminated';

/** 平台自己写的系统消息种类。一个 formatter / 写入语义一个 kind。老消息没有。 */
export type SystemKind =
  | 'relay'
  | 'dropped'
  | 'escalated'
  | 'hold'
  | 'hold-command-done'
  | 'hold-command-restart'
  | 'freeze'
  | 'aborted'
  | 'failed'
  | 'exit-nudge'
  | 'approval-pending'
  | 'approval-applied'
  | 'approval-failed'
  | 'git-move'
  | 'git-overstep'
  | 'pr-opened'
  | 'pr-merged'
  /** PR 评论回流:不参与球权,叫醒靠 pendingHop */
  | 'pr-review'
  /** PR CI 回流:不参与球权,红了才叫醒写手 */
  | 'pr-ci'
  /** PR 冲突回流:不参与球权,合不进去才叫醒写手 */
  | 'pr-conflict'
  /** 预算闸:花超了拒跑,不参与球权 */
  | 'budget'
  /** 跨线程传话:带出处,不参与球权,不当本线程助手 */
  | 'cross-post'
  | 'routing-hint'
  /** 有系统正文、但不参与球权/时间线的写入(证据回执、空任务、链上限、审查开场等) */
  | 'notice';

/** 渲染球权/时间线/审批卡真正要用的字段。 */
export interface SystemMeta {
  from?: AgentId;
  to?: AgentId;
  /** 验证门已经算好的审查结论；老消息没有，前端退回正文判断 */
  verdict?: 'pass' | 'revise' | 'incomplete';
  /** 越界那条:动的是哪根基准分支、前后 sha */
  baseBranch?: string;
  beforeSha?: string;
  afterSha?: string;
  /** 越界那条:碰基准远端 / 碰基准本地 / 本地模式下推了自己这根 */
  side?: 'remote' | 'local' | 'push';
  /** PR 那条:number + 当时的 head sha,不用 FETCH_HEAD */
  prNumber?: number;
  prUrl?: string;
  headRefOid?: string;
  /** 审查那条:本轮 diff 命中的风险面(按风险面选审查官) */
  risk?: 'safety' | 'contract' | 'default';
  /** 跨线程传话:原寄件线程 */
  fromThreadId?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  costEstimated?: boolean;
}

export type ToolActivityStatus = 'running' | 'done' | 'error';

export interface ToolActivity {
  id: string;
  name: string;
  arg?: string;
  status: ToolActivityStatus;
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  /** assistant 消息对应的 agent */
  agentId?: AgentId;
  content: string;
  status: MessageStatus;
  sessionId?: string;
  /** 这一跳属于哪一棒;重跑时用来认半截/已完成的助手消息 */
  hopId?: string;
  usage?: TokenUsage;
  error?: string;
  createdAt: string;
  /** 这一跳实际塞进 system prompt 的技能 id */
  skillIds?: string[];
  /** 这一跳实际塞进 system prompt 的证据 id */
  evidenceIds?: string[];
  /** CLI 工具过程(Read/Write/Bash 等),页面 CLI 块用 */
  activities?: ToolActivity[];
  /** 模型思考过程,与对用户说的话分开 */
  thinking?: string;
  /** 平台系统消息的类型;老消息没有,前端走散文兜底 */
  systemKind?: SystemKind;
  /** 接力等场景的 from/to,用 agentId 不是显示名 */
  systemMeta?: SystemMeta;
}

export type EvidenceKind = 'fact' | 'lesson' | 'decision';
export type EvidenceStatus = 'draft' | 'confirmed';

export interface AgentProfile {
  agentId: AgentId;
  name: string;
  personality: string;
  role: string;
  expertise: string[];
  /** 审批策略:true = 该角色的 diff 自动批准落地(默认 false = 人工批准) */
  autoApprove?: boolean;
  createdAt: string;
}

export interface EvidenceEntry {
  id: string;
  threadId: string;
  kind: EvidenceKind;
  title: string;
  content: string;
  status: EvidenceStatus;
  createdAt: string;
  /** 人点确认的时间。老数据没有,注入时落「确认时间未记」,不许拿 createdAt 顶替 */
  confirmedAt?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  prompt: string;
  /** 无触发词也每轮注入,用于自检门这类常驻工序 */
  always?: boolean;
}

export type ApprovalStatus = 'draft' | 'reviewing' | 'approved' | 'rejected' | 'applied' | 'voided';

export interface ApprovalCard {
  id: string;
  threadId: string;
  writerAgentId: AgentId;
  reviewerAgentId: AgentId;
  status: ApprovalStatus;
  diffText: string;
  diffStat: string;
  reviewComment?: string;
  rejectReason?: string;
  voidReason?: string;
  createdAt: string;
}

/** 谁做了这件事:猫 / 人 / 平台。 */
export type AuditActor = AgentId | 'human' | 'platform';

/**
 * 平台决定的种类。系统消息复用 SystemKind,不再另造中文 action。
 * 其余是 store 边界派生或不经 store 的租约/重跑。
 */
export type AuditAction =
  | SystemKind
  | 'user-say'
  | 'hop-done'
  | 'hop-failed'
  | 'hop-rerun'
  | 'approval-created'
  | 'approval-approved'
  | 'approval-rejected'
  | 'approval-applied'
  | 'approval-voided'
  | 'lease-claim'
  | 'lease-steal'
  | 'lease-release'
  | 'hop-skip-stale';

/** 邮局收发存根:只存指针和短摘要,不存消息全文。 */
export interface AuditRow {
  id: string;
  /** ISO 时间 */
  ts: string;
  threadId: string;
  actor: AuditActor;
  action: AuditAction;
  subject?: string;
  meta?: Record<string, unknown>;
}
