import { describe, expect, it } from 'vitest';
import { parseParallelGroups } from '../src/parallel-groups.js';

describe('parseParallelGroups', () => {
  it('按 | 切成并行组,去除空组', () => {
    expect(parseParallelGroups('@claude 写 X | @opencode 写 Y')).toEqual([
      '@claude 写 X',
      '@opencode 写 Y',
    ]);
  });

  it('无 | 返回整段', () => {
    expect(parseParallelGroups('@claude 写 X')).toEqual(['@claude 写 X']);
  });

  it('组内可含多个 @(串行接力)', () => {
    expect(parseParallelGroups('@claude 写 @opencode 审 | @gemini 独立任务')).toEqual([
      '@claude 写 @opencode 审',
      '@gemini 独立任务',
    ]);
  });

  it('空组与纯空白组被丢弃', () => {
    expect(parseParallelGroups('@claude 写 X |   | @opencode 写 Y')).toEqual([
      '@claude 写 X',
      '@opencode 写 Y',
    ]);
  });
});
