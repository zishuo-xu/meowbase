import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StreamEvent } from '@/lib/use-thread-stream';

const streamCtl = vi.hoisted(() => {
  let lastEvent: StreamEvent | null = null;
  const subs = new Set<(event: StreamEvent | null) => void>();
  return {
    emit(event: StreamEvent) {
      lastEvent = event;
      for (const fn of subs) fn(event);
    },
    reset() {
      lastEvent = null;
    },
    subscribe(fn: (event: StreamEvent | null) => void) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    getLast() {
      return lastEvent;
    },
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    listThreads: vi.fn(),
    listApprovals: vi.fn(),
    getConfig: vi.fn(),
    createThread: vi.fn(),
    listMessages: vi.fn(),
    listEvidence: vi.fn(),
    deleteThread: vi.fn(),
    sendMessage: vi.fn(),
    cancelTurn: vi.fn(),
    fetchUsage: vi.fn(),
    fetchToolUsage: vi.fn(),
    steerQueue: vi.fn(),
  },
}));

vi.mock('@/lib/use-thread-stream', async () => {
  const react = await import('react');
  return {
    SYNC_REFRESH_DEBOUNCE_MS: 150,
    useThreadStream: () => {
      const [lastEvent, setLastEvent] = react.useState(streamCtl.getLast());
      react.useEffect(() => streamCtl.subscribe(setLastEvent), []);
      return { lastEvent };
    },
  };
});

import { api } from '@/lib/api';
import Home from '../page';

describe('Home 建会话', () => {
  beforeEach(() => {
    vi.mocked(api.listThreads).mockResolvedValue([]);
    vi.mocked(api.listApprovals).mockResolvedValue([]);
    vi.mocked(api.getConfig).mockResolvedValue({
      a2aMaxDepth: 3,
      defaultAgentId: 'claude',
      agents: [{ id: 'claude', name: '墨墨', role: '主架构师', aliases: ['墨墨'], bin: 'claude' }],
    });
  });

  afterEach(() => {
    streamCtl.reset();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('建会话 403 时展示允许的根', async () => {
    vi.mocked(api.createThread).mockRejectedValue(
      new Error('仓库路径不在允许的根下面。允许的根: /Users/me、/tmp'),
    );
    render(<Home />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新会话' })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('仓库路径（可选）'), {
      target: { value: '/etc/secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(await screen.findByText(/允许的根: \/Users\/me、\/tmp/)).toBeTruthy();
  });

  it('建会话 400 时展示服务端中文错误', async () => {
    vi.mocked(api.createThread).mockRejectedValue(new Error('仓库路径不存在'));
    render(<Home />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新会话' })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText('仓库路径（可选）'), {
      target: { value: '/no/such/repo' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(await screen.findByText('仓库路径不存在')).toBeTruthy();
  });
});

const thread = {
  id: 't-sync',
  title: '接力会话',
  primaryAgentId: 'claude' as const,
  workdir: 'work/t-sync',
  sessions: {},
  sop: { stage: 'doing' as const, holder: 'claude', note: '写手在干活。做完按家规交下一棒,不要问人要不要继续。' },
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('Home live-sync', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(api.listThreads).mockResolvedValue([thread]);
    vi.mocked(api.listApprovals).mockResolvedValue([]);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.listEvidence).mockResolvedValue([]);
    vi.mocked(api.fetchUsage).mockResolvedValue({ byAgent: {}, total: {} });
    vi.mocked(api.getConfig).mockResolvedValue({
      a2aMaxDepth: 3,
      defaultAgentId: 'claude',
      agents: [{ id: 'claude', name: '墨墨', role: '主架构师', aliases: ['墨墨'], bin: 'claude' }],
    });
  });

  afterEach(() => {
    streamCtl.reset();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function openThread() {
    render(<Home />);
    fireEvent.click(await screen.findByText('接力会话'));
    await waitFor(() => expect(api.listMessages).toHaveBeenCalledWith('t-sync'));
    vi.mocked(api.listMessages).mockClear();
    vi.mocked(api.listApprovals).mockClear();
    vi.mocked(api.listThreads).mockClear();
    vi.mocked(api.listEvidence).mockClear();
  }

  it('顶栏展示家规告示牌说明', async () => {
    await openThread();
    expect(screen.getByLabelText('家规告示牌').textContent).toContain('写手在干活');
  });

  it('收到 sync 后重拉 messages / approvals / threads', async () => {
    await openThread();
    vi.useFakeTimers();
    act(() => {
      streamCtl.emit({ type: 'sync', threadId: 't-sync' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(api.listMessages).toHaveBeenCalledWith('t-sync');
      expect(api.listApprovals).toHaveBeenCalled();
      expect(api.listThreads).toHaveBeenCalled();
    });
  });

  it('一串 sync 去抖成一轮重拉', async () => {
    await openThread();
    vi.useFakeTimers();
    act(() => {
      streamCtl.emit({ type: 'sync', threadId: 't-sync' });
      streamCtl.emit({ type: 'sync', threadId: 't-sync' });
      streamCtl.emit({ type: 'sync', threadId: 't-sync' });
    });
    expect(api.listMessages).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(149);
    });
    expect(api.listMessages).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await waitFor(() => expect(api.listMessages).toHaveBeenCalledTimes(1));
    expect(api.listThreads).toHaveBeenCalledTimes(1);
  });

  it('Hub 打开时 sync 去抖后刷新用量', async () => {
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: '团队' }));
    await waitFor(() => expect(api.fetchUsage).toHaveBeenCalled());
    vi.mocked(api.fetchUsage).mockClear();
    vi.useFakeTimers();
    act(() => {
      streamCtl.emit({ type: 'sync', threadId: 't-sync' });
    });
    expect(api.fetchUsage).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    vi.useRealTimers();
    await waitFor(() => expect(api.fetchUsage).toHaveBeenCalled());
  });
});
