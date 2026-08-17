export const baseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3200';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new Error(`无法连接 API ${baseUrl}${path}(请确认后端已启动)`);
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface ThreadDto {
  id: string;
  title: string;
  primaryAgentId: string;
  workdir: string;
  sessions: Record<string, string>;
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
    }>('/api/config/models/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createThread: (title: string, primaryAgentId: string) =>
    request<ThreadDto>('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, primaryAgentId }),
    }),
  listMessages: (threadId: string) =>
    request<MessageDto[]>(`/api/threads/${threadId}/messages`),
  listApprovals: (threadId?: string) =>
    request<ApprovalDto[]>(
      threadId ? `/api/approvals?threadId=${threadId}` : '/api/approvals',
    ),
  listEvidence: (threadId: string) =>
    request<EvidenceDto[]>(`/api/evidence?threadId=${threadId}`),
  deleteThread: (threadId: string) =>
    request<{ ok: boolean }>(`/api/threads/${threadId}`, { method: 'DELETE' }),
  sendMessage: (threadId: string, content: string) =>
    request<MessageDto>(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  cancelTurn: (threadId: string) =>
    request<{ ok: boolean }>(`/api/threads/${threadId}/cancel`, { method: 'POST' }),
};
