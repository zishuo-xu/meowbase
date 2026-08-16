import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../MessageBubble';
import { ApprovalCardBlock } from '../ApprovalCardBlock';

describe('MessageBubble', () => {
  it('assistant 气泡带猫耳类名与名字', () => {
    render(
      <MessageBubble
        message={{
          id: 'm1',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '你好',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    const bubble = screen.getByText('你好').closest('[data-cat-ear]');
    expect(bubble).not.toBeNull();
    expect(screen.getByText('墨墨')).toBeTruthy();
  });

  it('失败且无正文时显示错误', () => {
    render(
      <MessageBubble
        agentName="闪闪"
        message={{
          id: 'm-fail',
          threadId: 't',
          role: 'assistant',
          agentId: 'gemini',
          content: '',
          status: 'failed',
          error: 'gemini 退出码 1: API key not found',
          createdAt: '',
        }}
      />,
    );
    expect(screen.getByText('闪闪')).toBeTruthy();
    expect(screen.getByText(/失败: gemini 退出码 1/)).toBeTruthy();
  });

  it('可配置名字覆盖内置名册', () => {
    render(
      <MessageBubble
        agentName="墨墨酱"
        message={{
          id: 'm1',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '你好',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    expect(screen.getByText('墨墨酱')).toBeTruthy();
    expect(screen.queryByText('墨墨')).toBeNull();
  });

  it('assistant 带工具过程时显示 CLI 行', () => {
    render(
      <MessageBubble
        message={{
          id: 'm1',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '已创建 add.js',
          status: 'completed',
          createdAt: '',
          activities: [{ id: 't1', name: 'Write', arg: 'add.js', status: 'done' }],
        }}
      />,
    );
    expect(screen.getByText('Write')).toBeTruthy();
    expect(screen.getByText('add.js')).toBeTruthy();
  });

  it('user 气泡无猫耳', () => {
    const { container } = render(
      <MessageBubble
        message={{
          id: 'm2',
          threadId: 't',
          role: 'user',
          content: '你好',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    expect(container.querySelector('[data-cat-ear]')).toBeNull();
  });
});

describe('ApprovalCardBlock', () => {
  it('按钮触发回调', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ApprovalCardBlock
        approvalId="ap_a1b2c3d4"
        stat="x.txt | 1 +"
        comment="通过"
        writerName="墨墨"
        reviewerName="团团"
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    expect(screen.getByText('墨墨 写 · 团团 审')).toBeTruthy();
    expect(screen.getByText('待你确认')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批准落地' }));
    expect(onApprove).toHaveBeenCalledWith('ap_a1b2c3d4');
    fireEvent.click(screen.getByRole('button', { name: '打回' }));
    fireEvent.change(screen.getByLabelText('打回理由'), { target: { value: '再改改' } });
    fireEvent.click(screen.getByRole('button', { name: '确认打回' }));
    expect(onReject).toHaveBeenCalledWith('ap_a1b2c3d4', '再改改');
  });

  it('已落地时不再显示批准按钮', () => {
    render(
      <ApprovalCardBlock
        approvalId="ap_a1b2c3d4"
        stat="x.txt | 1 +"
        comment="通过"
        status="applied"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('已落地')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '批准落地' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打回' })).toBeNull();
  });
});
