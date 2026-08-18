import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
  },
}));

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

  afterEach(() => vi.clearAllMocks());

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
