export const baseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3200';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new Error(`无法连接 API ${baseUrl}${path}(请确认后端已启动)`);
  }
  if (!res.ok) {
    let message = `API ${res.status}: ${path}`;
    try {
      if (typeof res.json === 'function') {
        const body = (await res.json()) as { error?: string; allowedRoots?: unknown };
        if (typeof body?.error === 'string' && body.error.trim()) {
          message = body.error;
          if (Array.isArray(body.allowedRoots) && body.allowedRoots.length > 0) {
            const roots = body.allowedRoots.filter((item): item is string => typeof item === 'string');
            if (roots.length > 0) message = `${body.error}。允许的根: ${roots.join('、')}`;
          }
        }
      }
    } catch {
      // 没有 JSON 体时沿用状态码文案
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface ThreadRepoDto {
  path: string;
  baseBranch: string;
  branch: string;
  lastApprovedSha?: string;
  allowRemote?: boolean;
}

export interface ThreadDto {
  id: string;
  title: string;
  primaryAgentId: string;
  workdir: string;
  sessions: Record<string, string>;
  pendingHop?: { id: string; to: string; from: string; task?: string };
  pendingQueue?: { id: string; to: string; from: string; task?: string }[];
  inboundQueue?: { id: string; content: string }[];
  sop?: { stage: 'idle' | 'doing' | 'reviewing' | 'waiting' | 'human'; holder?: string; note: string };
  repo?: ThreadRepoDto;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  agentId?: string;
  content: string;
  status: 'streaming' | 'completed' | 'failed' | 'terminated';
  createdAt: string;
  error?: string;
  activities?: ToolActivity[];
  thinking?: string;
  systemKind?: string;
  systemMeta?: {
    from?: string;
    to?: string;
    verdict?: 'pass' | 'revise' | 'incomplete';
    fromThreadId?: string;
  };
}

export interface ToolActivity {
  id: string;
  name: string;
  arg?: string;
  status: 'running' | 'done' | 'error';
}

export interface EvidenceDto {
  id: string;
  threadId: string;
  kind: string;
  title: string;
  content: string;
  status: 'draft' | 'confirmed';
  createdAt: string;
  confirmedAt?: string;
}

export interface ApprovalDto {
  id: string;
  threadId: string;
  writerAgentId: string;
  reviewerAgentId: string;
  status: string;
  diffStat: string;
  diffText?: string;
  reviewComment?: string;
  voidReason?: string;
  createdAt: string;
}

export interface ModelPresetDto {
  id: string;
  label: string;
  bin: string;
  bins?: string[];
  protocol?: 'anthropic' | 'openai' | 'gemini';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  hasApiKey?: boolean;
}

export interface AgentConfigDto {
  id: string;
  name: string;
  role: string;
  aliases: string[];
  bin: string;
  personality?: string;
  expertise?: string[];
  model?: string;
  modelId?: string;
  autoApprove?: boolean;
}

export interface AppConfigDto {
  a2aMaxDepth: number;
  defaultAgentId: string;
  agents: AgentConfigDto[];
  models?: ModelPresetDto[];
  budgetUsd?: number;
}

export interface TokenUsageDto {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  costEstimated?: boolean;
}

export interface UsageDto {
  byAgent: Record<string, TokenUsageDto>;
  total: TokenUsageDto;
}

export interface ToolUsageDto {
  skills: Array<{ id: string; count: number }>;
  tools: Array<{ name: string; category: 'builtin' | 'skill' | 'mcp'; count: number }>;
  total: { skillInjections: number; toolCalls: number };
}

export interface MemoryRecallDto {
  items: Array<{ id: string; injections: number; citations: number }>;
  total: { injections: number; citations: number };
}

export interface AgentPatchDto {
  name?: string;
  aliases?: string[];
  role?: string;
  personality?: string;
  expertise?: string[];
  bin?: string;
  model?: string;
  modelId?: string;
  autoApprove?: boolean;
}

export const api = {
  listThreads: () => request<ThreadDto[]>('/api/threads'),
  getConfig: () => request<AppConfigDto>('/api/config'),
  patchConfig: (body: {
    a2aMaxDepth?: number;
    defaultAgentId?: string;
    models?: ModelPresetDto[];
    applyModel?: { model: string; agentIds: string[]; bin?: string };
  }) =>
    request<AppConfigDto>('/api/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  patchAgent: (agentId: string, body: AgentPatchDto) =>
    request<AgentConfigDto>(`/api/config/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  verifyModel: (body: {
    bin: string;
    model?: string;
    modelId?: string;
    protocol?: 'anthropic' | 'openai' | 'gemini';
    baseUrl?: string;
    apiKey?: string;
  }) =>
    request<{
      ok: boolean;
      stage: 'bin' | 'model';
      latencyMs: number;
      error?: string;
      preview?: string;
      usage?: TokenUsageDto;
    }>('/api/config/models/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createThread: (
    title: string,
    primaryAgentId: string,
    opts?: { repoPath?: string; baseBranch?: string; allowRemote?: boolean },
  ) => {
    const repoPath = opts?.repoPath?.trim();
    const baseBranch = opts?.baseBranch?.trim();
    return request<ThreadDto>('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title,
        primaryAgentId,
        ...(repoPath ? { repoPath } : {}),
        ...(baseBranch ? { baseBranch } : {}),
        ...(opts?.allowRemote === true ? { allowRemote: true } : {}),
      }),
    });
  },
  listMessages: (threadId: string) =>
    request<MessageDto[]>(`/api/threads/${threadId}/messages`),
  listApprovals: (threadId?: string) =>
    request<ApprovalDto[]>(
      threadId ? `/api/approvals?threadId=${threadId}` : '/api/approvals',
    ),
  listEvidence: (threadId: string) =>
    request<EvidenceDto[]>(`/api/evidence?threadId=${threadId}&scope=recall`),
  deleteThread: (threadId: string) =>
    request<{ ok: boolean }>(`/api/threads/${threadId}`, { method: 'DELETE' }),
  sendMessage: (threadId: string, content: string) =>
    request<MessageDto>(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  steerQueue: (threadId: string, body: { kind: 'inbound' | 'hop'; id: string }) =>
    request<{
      ok: boolean;
      pendingQueue: ThreadDto['pendingQueue'];
      inboundQueue: ThreadDto['inboundQueue'];
    }>(`/api/threads/${threadId}/queue/steer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  cancelTurn: (threadId: string) =>
    request<{ ok: boolean }>(`/api/threads/${threadId}/cancel`, { method: 'POST' }),
  crossPost: (fromThreadId: string, toThreadId: string, content: string) =>
    request<MessageDto>(`/api/threads/${fromThreadId}/cross-post`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toThreadId, content }),
    }),
  fetchUsage: (threadId?: string) =>
    request<UsageDto>(threadId ? `/api/usage?threadId=${threadId}` : '/api/usage'),
  fetchToolUsage: (threadId?: string) =>
    request<ToolUsageDto>(threadId ? `/api/usage/tools?threadId=${threadId}` : '/api/usage/tools'),
  fetchMemoryRecall: (threadId?: string) =>
    request<MemoryRecallDto>(threadId ? `/api/usage/memory?threadId=${threadId}` : '/api/usage/memory'),
};
