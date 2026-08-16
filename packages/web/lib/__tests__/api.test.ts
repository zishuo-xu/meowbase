import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('createThread 发 POST 并返回线程', async () => {
    const thread = { id: 't1', title: 'hello', primaryAgentId: 'claude' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => thread,
      }),
    );
    const result = await api.createThread('hello', 'claude');
    expect(result.id).toBe('t1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/threads'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sendMessage 发 POST 并返回消息', async () => {
    const msg = { id: 'm1', content: 'ok' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => msg,
      }),
    );
    const result = await api.sendMessage('t1', '@claude hi');
    expect(result.id).toBe('m1');
  });

  it('非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(api.createThread('x', 'claude')).rejects.toThrow();
  });

  it('网络失败抛出可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.listThreads()).rejects.toThrow(/无法连接 API/);
  });
});
