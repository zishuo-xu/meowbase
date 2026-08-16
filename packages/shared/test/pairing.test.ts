import { describe, expect, it } from 'vitest';
import { selectReviewer } from '../src/pairing.js';

describe('selectReviewer', () => {
  it('claude 写 → opencode 审', () => {
    expect(selectReviewer('claude', ['claude', 'opencode'])).toBe('opencode');
  });

  it('opencode 写 → claude 审', () => {
    expect(selectReviewer('opencode', ['claude', 'opencode'])).toBe('claude');
  });

  it('只有写手自己 → undefined', () => {
    expect(selectReviewer('claude', ['claude'])).toBeUndefined();
  });

  it('写手不可用时选第一个可用且不同的', () => {
    expect(selectReviewer('claude', ['gemini'])).toBe('gemini');
  });
});
