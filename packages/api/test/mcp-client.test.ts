import { describe, expect, it, vi } from 'vitest';
import { callCollabTool } from '../src/mcp/client.js';

describe('callCollabTool', () => {
  it('search_messages 打 /api/collab/messages', async () => {
    const fetchImpl = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => [{ excerpt: '斑马纹' }],
    })) as unknown as typeof fetch;
    const data = (await callCollabTool(
      'search_messages',
      { q: '斑马' },
      fetchImpl,
      'http://127.0.0.1:3200',
    )) as Array<{ excerpt: string }>;
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/api/collab/messages?q=');
    expect(data[0]?.excerpt).toContain('斑马');
  });

  it('list_threads 打 /api/collab/threads', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 't1', title: '加法' }],
    })) as unknown as typeof fetch;
    const data = (await callCollabTool('list_threads', {}, fetchImpl, 'http://example.test')) as Array<{
      id: string;
    }>;
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('http://example.test/api/collab/threads');
    expect(data[0]?.id).toBe('t1');
  });
});
