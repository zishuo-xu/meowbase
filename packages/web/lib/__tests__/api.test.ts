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

  it('listEvidence / deleteThread 打对应接口', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'ev_1' }],
      }),
    );
    await api.listEvidence('t1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/evidence?threadId=t1'),
      undefined,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    await api.deleteThread('t1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/threads/t1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );
    await api.cancelTurn('t1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/threads/t1/cancel'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('createThread 带仓库路径时写入 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 't2' }),
      }),
    );
    await api.createThread('绑仓', 'claude', {
      repoPath: '/tmp/myapp',
      baseBranch: 'main',
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/threads'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: '绑仓',
          primaryAgentId: 'claude',
          repoPath: '/tmp/myapp',
          baseBranch: 'main',
        }),
      }),
    );
  });

  it('createThread 不传仓库时 body 与现在一致', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 't3' }),
      }),
    );
    await api.createThread('hello', 'claude');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/threads'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'hello', primaryAgentId: 'claude' }),
      }),
    );
  });

  it('非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(api.createThread('x', 'claude')).rejects.toThrow();
  });

  it('400 时抛出服务端 error 文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: '仓库路径不存在' }),
      }),
    );
    await expect(api.createThread('x', 'claude', { repoPath: '/no/such' })).rejects.toThrow(
      '仓库路径不存在',
    );
  });

  it('网络失败抛出可读错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.listThreads()).rejects.toThrow(/无法连接 API/);
  });

  it('fetchUsage 带 threadId 打 /api/usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ byAgent: {}, total: {} }),
      }),
    );
    await api.fetchUsage('t1');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/usage?threadId=t1'),
      undefined,
    );
  });

  it('fetchUsage 不带 threadId 打全部', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ byAgent: {}, total: {} }),
      }),
    );
    await api.fetchUsage();
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/usage$/), undefined);
  });
});
