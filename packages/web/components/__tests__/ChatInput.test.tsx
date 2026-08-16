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
