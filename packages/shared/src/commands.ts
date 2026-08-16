import { randomBytes } from 'node:crypto';

export function generateEvidenceId(): string {
  return `ev_${randomBytes(4).toString('hex')}`;
}

const CONFIRM_PATTERN = /#confirm\s+(ev_[a-f0-9]{8})\b/;

export function parseConfirmCommand(content: string): { id: string } | null {
  const match = content.match(CONFIRM_PATTERN);
  const id = match?.[1];
  return id ? { id } : null;
}

const LEARN_PATTERN = /#learn\s+(.+)$/;

export function parseLearnCommand(content: string): { title: string } | null {
  const match = content.match(LEARN_PATTERN);
  if (!match) return null;
  const title = match[1]?.trim() ?? '';
  return title ? { title } : null;
}

const EVIDENCE_REF_PATTERN = /#ev_([a-f0-9]{8})\b/g;

export function parseEvidenceRefs(content: string): string[] {
  return [...content.matchAll(EVIDENCE_REF_PATTERN)]
    .map((m) => (m[1] ? `ev_${m[1]}` : undefined))
    .filter((x): x is string => x !== undefined);
}

const APPROVE_PATTERN = /#approve\s+(ap_[a-f0-9]{8})\b/;

export function parseApproveCommand(content: string): { id: string } | null {
  const match = content.match(APPROVE_PATTERN);
  const id = match?.[1];
  return id ? { id } : null;
}

const REJECT_PATTERN = /#reject\s+(ap_[a-f0-9]{8})(?:\s+(.*))?$/;

export function parseRejectCommand(content: string): { id: string; reason: string } | null {
  const match = content.match(REJECT_PATTERN);
  const id = match?.[1];
  if (!id) return null;
  return { id, reason: (match?.[2] ?? '').trim() };
}

export function generateApprovalId(): string {
  return `ap_${randomBytes(4).toString('hex')}`;
}
