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
}

export type EvidenceKind = 'fact' | 'lesson' | 'decision';
export type EvidenceStatus = 'draft' | 'confirmed';

export interface AgentProfile {
  agentId: AgentId;
  name: string;
  personality: string;
  role: string;
  expertise: string[];
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
