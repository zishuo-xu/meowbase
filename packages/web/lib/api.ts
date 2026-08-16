export const baseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3200';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, init);
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
}

export interface ApprovalDto {
  id: string;
  threadId: string;
  writerAgentId: string;
  reviewerAgentId: string;
  status: string;
  diffStat: string;
  reviewComment?: string;
  createdAt: string;
}

export const api = {
  listThreads: () => request<ThreadDto[]>('/api/threads'),
  createThread: (title: string, primaryAgentId: string) =>
    request<ThreadDto>('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, primaryAgentId }),
    }),
  listMessages: (threadId: string) =>
    request<MessageDto[]>(`/api/threads/${threadId}/messages`),
  listApprovals: (threadId: string) =>
    request<ApprovalDto[]>(`/api/approvals?threadId=${threadId}`),
  sendMessage: (threadId: string, content: string) =>
    request<MessageDto>(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
};
