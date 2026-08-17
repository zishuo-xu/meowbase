import type { AgentId, MessageStatus, TokenUsage, ToolActivity } from '@meowbase/shared';

export interface AgentTurnInput {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  workdir: string;
  timeoutMs?: number;
  onIncrement?: (delta: string) => void;
  onActivity?: (activity: ToolActivity) => void;
  onThinking?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface AgentTurnOutput {
  sessionId: string;
  content: string;
  status: MessageStatus;
  usage?: TokenUsage;
  error?: string;
}

export interface AdapterOpts {
  agentId?: AgentId;
  bin?: string;
  model?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface AgentService {
  readonly agentId: AgentId;
  runTurn(input: AgentTurnInput): Promise<AgentTurnOutput>;
}

export interface AgentRegistry {
  get(agentId: AgentId): AgentService | undefined;
  list(): AgentId[];
  register(service: AgentService): void;
}
