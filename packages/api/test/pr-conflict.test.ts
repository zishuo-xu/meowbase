import { describe, expect, it } from 'vitest';
import {
  formatPrConflictNote,
  formatPrConflictWakeTask,
  parsePrMergeableJson,
} from '../src/services/pr.js';

describe('parsePrMergeableJson', () => {
  it('CONFLICTING 冲突,MERGEABLE 可合,UNKNOWN 丢掉', () => {
    expect(parsePrMergeableJson('{"mergeable":"CONFLICTING"}')).toBe('CONFLICTING');
    expect(parsePrMergeableJson('{"mergeable":"MERGEABLE"}')).toBe('MERGEABLE');
    expect(parsePrMergeableJson('{"mergeable":"UNKNOWN"}')).toBeNull();
  });

  it('不是 JSON 返回 null', () => {
    expect(parsePrMergeableJson('not json')).toBeNull();
    expect(parsePrMergeableJson('{}')).toBeNull();
  });
});

describe('formatPrConflict', () => {
  it('冲突和解开文案带 PR 号', () => {
    expect(formatPrConflictNote({ number: 42, url: 'https://x', conflicting: true })).toContain(
      '合不进去',
    );
    expect(formatPrConflictNote({ number: 42, url: 'https://x', conflicting: false })).toContain(
      '冲突解开了',
    );
    expect(formatPrConflictWakeTask({ number: 42, url: 'https://x' })).toContain('合不进去');
  });
});
