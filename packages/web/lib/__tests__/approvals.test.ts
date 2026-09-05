import { describe, expect, it } from 'vitest';
import { pendingApprovals, pendingThreadIds } from '../approvals';

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

  it('pendingApprovals 只留还没落地的卡', () => {
    expect(
      pendingApprovals([
        { id: '1', status: 'reviewing' },
        { id: '2', status: 'applied' },
        { id: '3', status: 'voided' },
        { id: '4', status: 'draft' },
      ]).map((c) => c.id),
    ).toEqual(['1', '4']);
  });
});
