export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const COLLAB_TOOLS = [
  {
    name: 'search_messages',
    description: '按关键词搜消息正文',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        agentId: { type: 'string' },
        threadId: { type: 'string' },
      },
      required: ['q'],
    },
  },
  {
    name: 'list_threads',
    description: '列出线程标题和阶段',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

export function handleMcpRequest(
  raw: string,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<JsonRpcResponse | null> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return Promise.resolve(null);
  }
  if (req.jsonrpc !== '2.0' || !req.method) return Promise.resolve(null);
  const id = req.id ?? null;
  return dispatch(req, id, callTool);
}

async function dispatch(
  req: JsonRpcRequest,
  id: number | string | null,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<JsonRpcResponse> {
  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'meowbase-collab', version: '0.1.0' },
      },
    };
  }
  if (req.method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: COLLAB_TOOLS } };
  }
  if (req.method === 'tools/call') {
    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
    const name = params.name ?? '';
    try {
      const data = await callTool(name, params.arguments ?? {});
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : '工具失败' },
      };
    }
  }
  if (req.method === 'notifications/initialized' || req.method.startsWith('notifications/')) {
    return { jsonrpc: '2.0', id, result: {} };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `未知方法:${req.method}` } };
}

export function mcpCliArgs(binKind: 'claude' | 'gemini' | 'opencode', command: string): string[] {
  if (!command) return [];
  if (binKind === 'claude') {
    return ['--mcp-config', JSON.stringify({ mcpServers: { meowbase: { command, args: [] } } })];
  }
  if (binKind === 'gemini') return ['--allowed-mcp-server-names', 'meowbase'];
  return [];
}

export interface McpProvision {
  command: string;
  apiUrl: string;
  claude: { mcpServers: { meowbase: { command: string; args: string[] } } };
  gemini: { allowedMcpServerNames: string[] };
  env: { MEOW_MCP_COMMAND: string; MEOW_API_URL: string };
}

/** 换项目能粘贴的 MCP 片段。不写别人的仓。 */
export function formatMcpProvision(input: { command: string; apiUrl: string }): McpProvision {
  const command = input.command.trim();
  const apiUrl = input.apiUrl.trim().replace(/\/+$/, '') || 'http://127.0.0.1:3200';
  return {
    command,
    apiUrl,
    claude: { mcpServers: { meowbase: { command, args: [] } } },
    gemini: { allowedMcpServerNames: ['meowbase'] },
    env: { MEOW_MCP_COMMAND: command, MEOW_API_URL: apiUrl },
  };
}
