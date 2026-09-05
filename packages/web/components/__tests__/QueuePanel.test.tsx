import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueuePanel } from '../QueuePanel';

describe('QueuePanel', () => {
  it('空队不渲染', () => {
    const { container } = render(
      <QueuePanel pendingQueue={[]} inboundQueue={[]} nameOf={(id) => id ?? ''} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('列出交棒队谁交给谁和任务,以及人话正文', () => {
    render(
      <QueuePanel
        pendingQueue={[
          { id: 'h1', from: 'claude', to: 'gemini', task: '请审查加法' },
        ]}
        inboundQueue={[{ id: 'm1', content: '先别停,补一句' }]}
        nameOf={(id) => (id === 'claude' ? '墨墨' : id === 'gemini' ? '闪闪' : id ?? '')}
      />,
    );
    expect(screen.getByText('下一棒')).toBeTruthy();
    expect(screen.getByText('墨墨 → 闪闪')).toBeTruthy();
    expect(screen.getByText('请审查加法')).toBeTruthy();
    expect(screen.getByText('人说的')).toBeTruthy();
    expect(screen.getByText('先别停,补一句')).toBeTruthy();
  });

  it('收起时只留触发器,点开才列出条目', () => {
    render(
      <QueuePanel
        open={false}
        onToggle={vi.fn()}
        pendingQueue={[{ id: 'h1', from: 'claude', to: 'gemini', task: '请审查' }]}
        inboundQueue={[]}
        nameOf={(id) => (id === 'claude' ? '墨墨' : '闪闪')}
      />,
    );
    expect(screen.queryByText('下一棒')).toBeNull();
    expect(screen.getByRole('button', { name: /后面还有 1 棒/ })).toBeTruthy();
  });

  it('非队头显示上移,点了回调 beforeId', () => {
    const onSteer = vi.fn();
    render(
      <QueuePanel
        pendingQueue={[
          { id: 'h1', from: 'claude', to: 'gemini', task: '请审查加法' },
          { id: 'h2', from: 'opencode', to: 'gemini', task: '请审查乘法' },
        ]}
        inboundQueue={[
          { id: 'm1', content: '先补这句' },
          { id: 'm2', content: '再补那句', urgent: true },
        ]}
        nameOf={(id) => (id === 'claude' ? '墨墨' : id === 'gemini' ? '闪闪' : '团团')}
        onSteer={onSteer}
      />,
    );
    expect(screen.getByText('急')).toBeTruthy();
    const upButtons = screen.getAllByRole('button', { name: '上移' });
    expect(upButtons).toHaveLength(2);
    fireEvent.click(upButtons[0]!);
    expect(onSteer).toHaveBeenCalledWith({ kind: 'hop', id: 'h2', beforeId: 'h1' });
    fireEvent.click(upButtons[1]!);
    expect(onSteer).toHaveBeenCalledWith({ kind: 'inbound', id: 'm2', beforeId: 'm1' });
  });

  it('点触发器回调 onToggle', () => {
    const onToggle = vi.fn();
    render(
      <QueuePanel
        open
        onToggle={onToggle}
        pendingQueue={[{ id: 'h1', from: 'claude', to: 'gemini', task: '请审查' }]}
        inboundQueue={[]}
        nameOf={() => '猫'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /后面还有 1 棒/ }));
    expect(onToggle).toHaveBeenCalled();
  });
});
