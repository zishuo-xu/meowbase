import type {
  AgentId,
  Message,
  ToolActivity,
} from '@meowbase/shared';
import type { AgentRegistry, AgentTurnOutput } from '../../providers/types.js';
import type {
  ApprovalStore,
  EvidenceStore,
  MessageStore,
  ProfileStore,
  SkillStore,
  ThreadStore,
} from '../../stores/ports.js';
import type { AgentSpec } from '../../config.js';

/** A2A 接力链深上限(借鉴 clowder F046):链上最多出现 MAX_A2A_DEPTH 个 agent */
export const MAX_A2A_DEPTH = 3;
/** 审查需修改时,最多打回写手这么多轮;仍不通过才把卡片交给人 */
export const MAX_REVIEW_FIX_ROUNDS = 2;

export type ThreadRuntime = {
  id: string;
  workdir: string;
  sessions: Partial<Record<AgentId, string>>;
  primaryAgentId: AgentId;
};

export interface TurnContext {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
    skills: SkillStore;
    approvals: ApprovalStore;
  };
  registry: AgentRegistry;
  /** A2A 接力链深上限,默认 MAX_A2A_DEPTH */
  a2aMaxDepth?: number;
  /** 团队名册(来自 meowbase.config.json);有则用其别名做 @ 解析 */
  agents?: AgentSpec[];
  onIncrement?: (
    threadId: string,
    messageId: string,
    delta: string,
    agentId?: AgentId,
  ) => void;
  onActivity?: (
    threadId: string,
    messageId: string,
    activity: ToolActivity,
    agentId?: AgentId,
  ) => void;
  onStart?: (threadId: string, messageId: string, agentId?: AgentId) => void;
  onThinking?: (threadId: string, messageId: string, delta: string, agentId?: AgentId) => void;
  signal?: AbortSignal;
}

export interface SegmentRunResult {
  lastAssistant: Message;
  lastOutput: AgentTurnOutput;
  visited: Set<AgentId>;
  firstAgent: AgentId;
}

/** 串行化存储写操作:并行组并发 append/patch 时避免 Redis lost-update */
export type WriteQueue = <T>(fn: () => Promise<T>) => Promise<T>;
