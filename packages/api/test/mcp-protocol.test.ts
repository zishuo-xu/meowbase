import { describe, expect, it, vi } from 'vitest';
import { COLLAB_TOOLS, formatMcpProvision, handleMcpRequest, mcpCliArgs } from '../src/mcp/protocol.js';

describe('MCP protocol', () => {
  it('initialize 和 tools/list 列出搜消息和列线程', async () => {
    const init = await handleMcpRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      async () => ({}),
    );
    expect(init?.result).toMatchObject({ serverInfo: { name: 'meowbase-collab' } });
    const listed = await handleMcpRequest(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      async () => ({}),
    );
    const names = (listed?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(['search_messages', 'list_threads']);
    expect(COLLAB_TOOLS).toHaveLength(2);
  });

  it('tools/call 把参数交给 callTool', async () => {
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) => ({ name, args }));
    const res = await handleMcpRequest(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_messages', arguments: { q: '斑马' } },
      }),
      callTool,
    );
    expect(callTool).toHaveBeenCalledWith('search_messages', { q: '斑马' });
    expect(JSON.stringify(res?.result)).toContain('斑马');
  });

  it('claude 挂 MCP 用 --mcp-config,gemini 带允许名单,opencode 本篇不传', () => {
    expect(mcpCliArgs('claude', 'node mcp.js')[0]).toBe('--mcp-config');
    expect(mcpCliArgs('gemini', 'node mcp.js')[0]).toBe('--allowed-mcp-server-names');
    expect(mcpCliArgs('opencode', 'node mcp.js')).toEqual([]);
  });

  it('可携带片段形状对得上 claude --mcp-config', () => {
    const provision = formatMcpProvision({
      command: 'node mcp.js',
      apiUrl: 'http://127.0.0.1:3200/',
    });
    expect(provision.claude.mcpServers.meowbase).toEqual({ command: 'node mcp.js', args: [] });
    expect(JSON.parse(mcpCliArgs('claude', provision.command)[1] ?? '{}')).toEqual(provision.claude);
    expect(provision.gemini.allowedMcpServerNames).toEqual(['meowbase']);
    expect(provision.env).toEqual({
      MEOW_MCP_COMMAND: 'node mcp.js',
      MEOW_API_URL: 'http://127.0.0.1:3200',
    });
  });
});
