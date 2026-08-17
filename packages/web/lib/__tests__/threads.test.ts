import { describe, expect, it } from 'vitest';
import {
  defaultSessionTitle,
  isNoiseThreadTitle,
  isPlaceholderTitle,
  sortThreadsByCreated,
  titleFromUserMessage,
} from '../threads';

describe('isNoiseThreadTitle', () => {
  it('认出 redis 单测残留', () => {
    expect(isNoiseThreadTitle('redis-t')).toBe(true);
    expect(isNoiseThreadTitle('redis-m')).toBe(true);
    expect(isNoiseThreadTitle('验证球权')).toBe(false);
  });
});

describe('defaultSessionTitle', () => {
  it('用月日时间,不叫新线程', () => {
    const title = defaultSessionTitle(new Date('2026-08-17T18:51:00+08:00'));
    expect(title).toMatch(/8.*17/);
    expect(title).not.toContain('线程');
  });
});

describe('isPlaceholderTitle', () => {
  it('认出时间占位,不误伤人手标题', () => {
    expect(isPlaceholderTitle('8/17 19:28')).toBe(true);
    expect(isPlaceholderTitle('新会话')).toBe(true);
    expect(isPlaceholderTitle('验证球权')).toBe(false);
  });
});

describe('titleFromUserMessage', () => {
  it('去掉 @ 后截一段', () => {
    expect(titleFromUserMessage('@墨墨 在沙箱写 add.ts')).toBe('在沙箱写 add.ts');
    expect(titleFromUserMessage('@闪闪')).toBeNull();
  });
});

describe('sortThreadsByCreated', () => {
  it('新的在前', () => {
    const sorted = sortThreadsByCreated([
      { createdAt: '2026-08-17T10:00:00.000Z' },
      { createdAt: '2026-08-17T12:00:00.000Z' },
    ]);
    expect(sorted[0]?.createdAt).toBe('2026-08-17T12:00:00.000Z');
  });
});
