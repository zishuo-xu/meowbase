import { describe, expect, it } from 'vitest';
import { isPlaceholderTitle, titleFromUserMessage } from '../src/thread-title.js';

describe('isPlaceholderTitle', () => {
  it('认出默认时间标题和新会话', () => {
    expect(isPlaceholderTitle('8/17 19:28')).toBe(true);
    expect(isPlaceholderTitle('8月17日 19:28')).toBe(true);
    expect(isPlaceholderTitle('新会话')).toBe(true);
    expect(isPlaceholderTitle('验证球权')).toBe(false);
    expect(isPlaceholderTitle('在沙箱写 add.ts')).toBe(false);
  });
});

describe('titleFromUserMessage', () => {
  it('去掉 @ 后截一段', () => {
    expect(titleFromUserMessage('@墨墨 在沙箱写 add.ts，导出 add(a,b)，写完自检')).toBe(
      '在沙箱写 add.ts，导出 add(a,b)…',
    );
    expect(titleFromUserMessage('你是谁')).toBe('你是谁');
    expect(titleFromUserMessage('@闪闪')).toBeNull();
  });
});
