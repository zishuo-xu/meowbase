import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThreadSidebar } from '../ThreadSidebar';
import type { ThreadDto } from '@/lib/api';

const thread = (id: string, title: string): ThreadDto => ({
  id,
  title,
  primaryAgentId: 'claude',
  workdir: `work/${id}`,
  sessions: {},
  createdAt: '2026-08-17T12:00:00.000Z',
});

describe('ThreadSidebar', () => {
  it('新建按钮叫新会话,不叫新线程', () => {
    const onCreate = vi.fn();
    render(
      <ThreadSidebar
        threads={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByRole('button', { name: '+ 新会话' })).toBeTruthy();
    expect(screen.queryByText(/新线程/)).toBeNull();
    expect(screen.getByText(/还没有会话/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(onCreate).toHaveBeenCalled();
    expect(onCreate.mock.calls[0]?.[0]).not.toMatch(/线程/);
  });

  it('默认藏起 redis 测试残留,可展开再删', () => {
    const onDelete = vi.fn();
    render(
      <ThreadSidebar
        threads={[thread('a', '验证球权'), thread('b', 'redis-t')]}
        activeId="a"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onDelete={onDelete}
      />,
    );
    expect(screen.getByText('验证球权')).toBeTruthy();
    expect(screen.queryByText('redis-t')).toBeNull();
    fireEvent.click(screen.getByText(/1 条测试残留/));
    expect(screen.getByText('redis-t')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除 redis-t' }));
    expect(onDelete).toHaveBeenCalledWith('b');
  });
});
