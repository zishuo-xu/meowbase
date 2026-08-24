import { describe, expect, it } from 'vitest';
import { pendingThreadIds } from '../approvals';

describe('pendingThreadIds', () => {
  it('只收还没落地的卡片', () => {
    expect(
      pendingThreadIds([
        { threadId: 'a', status: 'reviewing' },
        { threadId: 'b', status: 'applied' },
        { threadId: 'c', status: 'draft' },
        { threadId: 'b', status: 'rejected' },
        { threadId: 'd', status: 'approved' },
        { threadId: 'e', status: 'voided' },
      ]),
    ).toEqual(['a', 'c', 'd']);
  });
});
