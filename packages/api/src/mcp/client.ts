const DEFAULT_API = 'http://127.0.0.1:3200';

export async function callCollabTool(
  name: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  apiBase = process.env.MEOW_API_URL ?? DEFAULT_API,
): Promise<unknown> {
  const base = apiBase.replace(/\/+$/, '');
  if (name === 'list_threads') {
    const res = await fetchImpl(`${base}/api/collab/threads`);
    if (!res.ok) throw new Error(`list_threads ${res.status}`);
    return res.json();
  }
  if (name === 'search_messages') {
    const q = String(args.q ?? '');
    const params = new URLSearchParams({ q });
    if (typeof args.agentId === 'string' && args.agentId) params.set('agentId', args.agentId);
    if (typeof args.threadId === 'string' && args.threadId) params.set('threadId', args.threadId);
    const res = await fetchImpl(`${base}/api/collab/messages?${params.toString()}`);
    if (!res.ok) throw new Error(`search_messages ${res.status}`);
    return res.json();
  }
  throw new Error(`未知工具:${name}`);
}
