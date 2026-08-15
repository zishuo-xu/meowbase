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
