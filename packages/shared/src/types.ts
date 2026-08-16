export type AgentId = 'claude' | 'gemini' | 'opencode';

export const AGENT_IDS: readonly AgentId[] = ['claude', 'gemini', 'opencode'];

export interface Thread {
  id: string;
  title: string;
  primaryAgentId: AgentId;
  /** CLI 工作目录,相对 api 进程 cwd */
  workdir: string;
  /** 每个 agent 的 CLI 会话 ID(用于 --resume) */
  sessions: Partial<Record<AgentId, string>>;
  createdAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type MessageStatus = 'streaming' | 'completed' | 'failed' | 'terminated';

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
  usage?: TokenUsage;
  error?: string;
  createdAt: string;
  /** CLI 工具过程(Read/Write/Bash 等),页面 CLI 块用 */
  activities?: ToolActivity[];
  /** 模型思考过程,与对用户说的话分开 */
  thinking?: string;
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

export type ApprovalStatus = 'draft' | 'reviewing' | 'approved' | 'rejected' | 'applied';

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
  createdAt: string;
}
