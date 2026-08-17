import { describe, expect, it } from 'vitest';
import { isNoiseThreadTitle, sortThreadsByCreated } from '../threads';

describe('isNoiseThreadTitle', () => {
  it('认出 redis 单测残留', () => {
    expect(isNoiseThreadTitle('redis-t')).toBe(true);
    expect(isNoiseThreadTitle('redis-m')).toBe(true);
    expect(isNoiseThreadTitle('验证球权')).toBe(false);
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
