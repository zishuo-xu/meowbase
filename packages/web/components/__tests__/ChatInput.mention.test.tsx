import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '../ChatInput';

describe('ChatInput 提及补全', () => {
  it('输入 @ 弹出角色菜单,点击插入 @墨墨', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);

    fireEvent.change(input, { target: { value: '帮我 @', selectionStart: 4 } });
    expect(screen.getByText('墨墨')).toBeTruthy();
    expect(screen.getByText('闪闪')).toBeTruthy();
    expect(screen.getByText('团团')).toBeTruthy();

    fireEvent.click(screen.getByText('墨墨'));
    expect((input as HTMLTextAreaElement).value).toBe('帮我 @墨墨 ');
  });

  it('按中文过滤:@墨 只剩墨墨', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);

    fireEvent.change(input, { target: { value: '@墨', selectionStart: 2 } });
    expect(screen.getByText('墨墨')).toBeTruthy();
    expect(screen.queryByText('闪闪')).toBeNull();
  });

  it('回车选择当前高亮项', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);

    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 高亮移到闪闪
    fireEvent.keyDown(input, { key: 'Enter' });
    expect((input as HTMLTextAreaElement).value).toBe('@闪闪 ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Tab 选择当前高亮项且不提交', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const input = screen.getByPlaceholderText(/@墨墨/);

    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect((input as HTMLTextAreaElement).value).toBe('@闪闪 ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('补全菜单写明 Enter / Tab / 方向键 / Esc', () => {
    render(<ChatInput onSend={vi.fn()} />);
    const input = screen.getByPlaceholderText(/@墨墨/);
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    expect(screen.getByText('Enter / Tab 选中 · ↑↓ 移动 · Esc 关闭')).toBeTruthy();
  });
});
