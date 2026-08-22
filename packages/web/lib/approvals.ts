export function isPendingApprovalStatus(status: string | undefined): boolean {
  return (
    status === 'draft' ||
    status === 'reviewing' ||
    status === 'pending' ||
    status === 'approved'
  );
}

/** 侧栏要标「待确认」的会话。 */
export function pendingThreadIds(
  cards: readonly { threadId: string; status: string }[],
): string[] {
  const ids = new Set<string>();
  for (const card of cards) {
    if (isPendingApprovalStatus(card.status)) ids.add(card.threadId);
  }
  return [...ids];
}
