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
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByText('批准'));
    fireEvent.click(screen.getByText('打回'));
    expect(onApprove).toHaveBeenCalledWith('ap_a1b2c3d4');
    expect(onReject).toHaveBeenCalledWith('ap_a1b2c3d4');
  });
});
