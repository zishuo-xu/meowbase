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

  it('填了仓库路径后新建会带上绑仓参数', () => {
    const onCreate = vi.fn();
    render(
      <ThreadSidebar
        threads={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('仓库路径（可选）'), {
      target: { value: '/tmp/myapp' },
    });
    fireEvent.change(screen.getByPlaceholderText('基准分支（可选）'), {
      target: { value: 'main' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(onCreate).toHaveBeenCalledWith(expect.any(String), 'claude', {
      repoPath: '/tmp/myapp',
      baseBranch: 'main',
    });
    expect(onCreate.mock.calls[0]?.[2]).not.toHaveProperty('allowRemote', true);
  });

  it('勾选允许远程后新建会带上 allowRemote', () => {
    const onCreate = vi.fn();
    render(
      <ThreadSidebar
        threads={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('仓库路径（可选）'), {
      target: { value: '/tmp/myapp' },
    });
    fireEvent.click(screen.getByLabelText(/允许推送|会联网/));
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(onCreate).toHaveBeenCalledWith(expect.any(String), 'claude', {
      repoPath: '/tmp/myapp',
      allowRemote: true,
    });
  });

  it('仓库路径留空时允许远程勾不动,也不会悄悄带上', () => {
    const onCreate = vi.fn();
    render(
      <ThreadSidebar
        threads={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const box = screen.getByLabelText(/允许推送|会联网/) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(onCreate).toHaveBeenCalledWith(expect.any(String), 'claude', undefined);
  });

  it('仓库路径留空时新建不带绑仓参数', () => {
    const onCreate = vi.fn();
    render(
      <ThreadSidebar
        threads={[]}
        activeId={null}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ 新会话' }));
    expect(onCreate).toHaveBeenCalledWith(expect.any(String), 'claude', undefined);
  });

  it('绑仓线程显示仓库名、分支和模式,未绑的不显示', () => {
    render(
      <ThreadSidebar
        threads={[
          thread('a', '空沙箱'),
          {
            ...thread('b', '绑仓任务'),
            repo: { path: '/tmp/throwaway-app', baseBranch: 'main', branch: 'meow/b' },
          },
          {
            ...thread('c', '远程任务'),
            repo: {
              path: '/tmp/throwaway-app',
              baseBranch: 'main',
              branch: 'meow/c',
              allowRemote: true,
            },
          },
        ]}
        activeId="b"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('throwaway-app · meow/b · 本地')).toBeTruthy();
    expect(screen.getByText('throwaway-app · meow/c · 远程')).toBeTruthy();
    expect(screen.getByText('空沙箱').closest('button')?.textContent).not.toMatch(/meow\//);
  });

  it('有待批准卡片的会话标待确认', () => {
    render(
      <ThreadSidebar
        threads={[thread('a', '在沙箱写 add.ts'), thread('b', '你是谁')]}
        activeId="b"
        pendingIds={['a']}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('待确认')).toBeTruthy();
    expect(screen.getByText('在沙箱写 add.ts').closest('button')?.textContent).toContain('待确认');
    expect(screen.getByText('你是谁').closest('button')?.textContent).not.toContain('待确认');
  });
});
