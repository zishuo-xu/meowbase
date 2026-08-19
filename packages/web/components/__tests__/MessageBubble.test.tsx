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

  it('接力条可点开交接包', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-relay',
          threadId: 't',
          role: 'system',
          content: '🤝 接力:墨墨 → 闪闪\n用户目标: 写 add.ts\n任务: 请审查 add.ts',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    expect(screen.getByText(/🤝 接力:墨墨 → 闪闪/)).toBeTruthy();
    expect(screen.queryByText(/用户目标: 写 add.ts/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /交接包/ }));
    expect(screen.getByText(/用户目标: 写 add.ts/)).toBeTruthy();
    expect(screen.getByText(/任务: 请审查 add.ts/)).toBeTruthy();
  });

  it('有 dropped kind 时改掉文案仍可点交给某只猫', () => {
    const onPass = vi.fn();
    render(
      <MessageBubble
        onPassBall={onPass}
        agents={[
          { id: 'claude', name: '墨墨' },
          { id: 'gemini', name: '闪闪' },
        ]}
        message={{
          id: 'm-ball-kind',
          threadId: 't',
          role: 'system',
          content: '球掉地上了',
          status: 'completed',
          createdAt: '',
          systemKind: 'dropped',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '交给闪闪' }));
    expect(onPass).toHaveBeenCalledWith('闪闪');
  });

  it('球还在地上可点交给某只猫', () => {
    const onPass = vi.fn();
    const onSpeak = vi.fn();
    render(
      <MessageBubble
        onPassBall={onPass}
        onSpeak={onSpeak}
        agents={[
          { id: 'claude', name: '墨墨' },
          { id: 'gemini', name: '闪闪' },
        ]}
        message={{
          id: 'm-ball',
          threadId: 't',
          role: 'system',
          content: '⚠️ 球还在地上:闪闪停棒了',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '交给闪闪' }));
    expect(onPass).toHaveBeenCalledWith('闪闪');
    fireEvent.click(screen.getByRole('button', { name: '我来说' }));
    expect(onSpeak).toHaveBeenCalled();
  });

  it('气泡里的 #ev_ 可点引用', () => {
    const onCite = vi.fn();
    render(
      <MessageBubble
        onCiteEvidence={onCite}
        message={{
          id: 'm-ev',
          threadId: 't',
          role: 'user',
          content: '对照 #ev_abcd1234',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '#ev_abcd1234' }));
    expect(onCite).toHaveBeenCalledWith('ev_abcd1234');
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
    expect(screen.getByText(/CLI · 1 个工具/)).toBeTruthy();
    expect(screen.queryByText('Write')).toBeNull();
    fireEvent.click(screen.getByText(/CLI · 1 个工具/));
    expect(screen.getByText('Write')).toBeTruthy();
    expect(screen.getByText('add.js')).toBeTruthy();
  });

  it('思考过程与工具分行,不混进正文', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-think',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '已写好 quicksort.ts',
          status: 'completed',
          createdAt: '',
          thinking: '先看目录再落文件',
          activities: [{ id: 't1', name: 'Write', arg: 'quicksort.ts', status: 'done' }],
        }}
      />,
    );
    expect(screen.getByText('思考过程')).toBeTruthy();
    expect(screen.queryByText('先看目录再落文件')).toBeNull();
    fireEvent.click(screen.getByText('思考过程'));
    expect(screen.getByText('先看目录再落文件')).toBeTruthy();
    expect(screen.getByText(/CLI · 1 个工具/)).toBeTruthy();
    expect(screen.getByText('已写好 quicksort.ts')).toBeTruthy();
  });

  it('流式思考默认不展开正文', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-stream-think',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '',
          status: 'streaming',
          createdAt: '',
          thinking: '先看目录再落文件，还要写测试。',
        }}
      />,
    );
    expect(screen.getByText('思考中…')).toBeTruthy();
    expect(screen.queryByText(/还要写测试/)).toBeNull();
  });

  it('流式空壳显示思考中,不独留光标', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-empty',
          threadId: 't',
          role: 'assistant',
          agentId: 'claude',
          content: '',
          status: 'streaming',
          createdAt: '',
        }}
      />,
    );
    expect(screen.getByText('思考中…')).toBeTruthy();
    expect(screen.getByText('墨墨')).toBeTruthy();
  });

  it('超时消息把进行中的工具显示为失败,不再转圈', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-timeout',
          threadId: 't',
          role: 'assistant',
          agentId: 'gemini',
          content: '',
          status: 'terminated',
          error: 'opencode 执行超时(300000ms)',
          createdAt: '',
          activities: [{ id: 't1', name: 'tool', status: 'running' }],
        }}
      />,
    );
    expect(screen.getByText('失败: opencode 执行超时(300000ms)')).toBeTruthy();
    fireEvent.click(screen.getByText(/CLI · 1 个工具/));
    expect(screen.getByLabelText('工具失败')).toBeTruthy();
    expect(screen.queryByLabelText('工具进行中')).toBeNull();
  });

  it('正文按 Markdown 渲染标题和加粗', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-md',
          threadId: 't',
          role: 'assistant',
          agentId: 'gemini',
          content: '## 结论\n\n**通过**',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: '结论' })).toBeTruthy();
    expect(screen.getByText('通过').tagName).toBe('STRONG');
    expect(screen.queryByText('## 结论')).toBeNull();
  });

  it('user 气泡保留换行,行首 @ 看起来就是行首', () => {
    const { container } = render(
      <MessageBubble
        message={{
          id: 'm-nl',
          threadId: 't',
          role: 'user',
          content: '在沙箱写 add.ts\n@墨墨',
          status: 'completed',
          createdAt: '',
        }}
      />,
    );
    const bubble = container.querySelector('.whitespace-pre-wrap');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('在沙箱写 add.ts');
    expect(bubble?.textContent).toContain('@墨墨');
    expect(bubble?.textContent).toMatch(/在沙箱写 add.ts\s*\n\s*@墨墨/);
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
    expect(screen.getByText('审查通过，待你确认')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '批准落地' }));
    expect(onApprove).toHaveBeenCalledWith('ap_a1b2c3d4');
    fireEvent.click(screen.getByRole('button', { name: '打回' }));
    fireEvent.change(screen.getByLabelText('打回理由'), { target: { value: '再改改' } });
    fireEvent.click(screen.getByRole('button', { name: '确认打回' }));
    expect(onReject).toHaveBeenCalledWith('ap_a1b2c3d4', '再改改');
  });

  it('已确认时不再显示批准按钮', () => {
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
    expect(screen.getByText('已确认')).toBeTruthy();
    expect(screen.getByText('改动已确认')).toBeTruthy();
    expect(screen.getByText('已记进这个会话的基线。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '批准落地' })).toBeNull();
    expect(screen.queryByRole('button', { name: '打回' })).toBeNull();
  });

  it('有 diff 时展示加减行,审查意见按 Markdown 渲染', () => {
    render(
      <ApprovalCardBlock
        approvalId="ap_a1b2c3d4"
        stat="quicksort.ts | 3 +"
        diff={
          'diff --git a/quicksort.ts b/quicksort.ts\n--- a/quicksort.ts\n+++ b/quicksort.ts\n@@ -0,0 +1,1 @@\n+export function qs() {}\n'
        }
        comment={'## 结论\n\n**通过**'}
        status="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('quicksort.ts')).toBeTruthy();
    expect(screen.getByText('export function qs() {}')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '结论' })).toBeTruthy();
    expect(screen.getByText('通过').tagName).toBe('STRONG');
  });

  it('审查未通过时标题改为待你决定', () => {
    render(
      <ApprovalCardBlock
        approvalId="ap_a1b2c3d4"
        stat="x.txt | 1 +"
        comment={'## 结论\n需修改'}
        status="pending"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByText('互审未通过，待你决定')).toBeTruthy();
    expect(screen.getByRole('button', { name: '批准落地' })).toBeTruthy();
  });

  it('incomplete 卡片标题是缺验证证据,不出现审查通过', () => {
    render(
      <MessageBubble
        message={{
          id: 'm-card',
          threadId: 't',
          role: 'system',
          content:
            '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:gemini)\n改动:x.txt | 1 +\n审查意见:结论:通过\n⚠️ 结论不算通过:没有本轮验证证据（命令+结果）。',
          status: 'completed',
          createdAt: '',
          systemKind: 'approval-pending',
          systemMeta: { verdict: 'incomplete' },
        }}
      />,
    );
    expect(screen.getByText('缺验证证据，待你决定')).toBeTruthy();
    expect(screen.queryByText('审查通过，待你确认')).toBeNull();
    expect(screen.queryByText(/审查通过/)).toBeNull();
  });
});
