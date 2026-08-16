import type { AgentId, MessageStatus, TokenUsage } from '@meowbase/shared';

export interface AgentTurnInput {
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  workdir: string;
  timeoutMs?: number;
  onIncrement?: (delta: string) => void;
}

export interface AgentTurnOutput {
  sessionId: string;
  content: string;
  status: MessageStatus;
  usage?: TokenUsage;
  error?: string;
}

export interface AgentService {
  readonly agentId: AgentId;
  runTurn(input: AgentTurnInput): Promise<AgentTurnOutput>;
}

export interface AgentRegistry {
  get(agentId: AgentId): AgentService | undefined;
  list(): AgentId[];
}
