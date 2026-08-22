import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '../ChatInput';

describe('ChatInput', () => {
  it('输入内容回车提交;空内容不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '@claude 你好' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('@claude 你好');

    onSend.mockClear();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Shift+Enter 不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '第一行' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('第一行');
  });

  it('输入法组合中(IME)的回车不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '写个函数' } });
    // 中文输入法选词的回车会带 keyCode 229
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('写个函数');
  });

  it('nativeEvent.isComposing 时回车不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '写个函数' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('写个函数');
  });

  it('输入区提示 Enter 发送与 Shift+Enter 换行', () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByPlaceholderText(/⇧↵换行/)).toBeTruthy();
    expect(screen.getByText('Enter 发送 · Shift+Enter 换行')).toBeTruthy();
  });

  it('sending 且有 onAbort 时显示中止', () => {
    const onAbort = vi.fn();
    render(<ChatInput sending onSend={vi.fn()} onAbort={onAbort} />);
    fireEvent.click(screen.getByRole('button', { name: '中止' }));
    expect(onAbort).toHaveBeenCalled();
  });

  it('sending 时回车不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput sending onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '@claude 你好' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '发送中' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('insert 把 #ev_ 写进输入框', () => {
    const onInserted = vi.fn();
    render(
      <ChatInput
        onSend={vi.fn()}
        insert={{ id: 1, text: '#ev_abcd1234' }}
        onInserted={onInserted}
      />,
    );
    const input = screen.getByPlaceholderText(/@墨墨/) as HTMLTextAreaElement;
    expect(input.value).toContain('#ev_abcd1234');
    expect(onInserted).toHaveBeenCalled();
  });

  it('compositionstart 后回车不提交,compositionend 后回车才提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '写个 python' } });
    // 输入法开始组合(输入英文候选)
    fireEvent.compositionStart(input);
    // 组合中回车确认候选词(此时 keydown 的 isComposing 可能已是 false)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    // 组合结束,再回车才是发送
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('写个 python');
  });
});
