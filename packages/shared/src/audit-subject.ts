import { clipBody } from './a2a.js';

/** 审计 subject 取第一个非空行,截到大约一行能扫完。 */
export const AUDIT_SUBJECT_MAX = 80;

export function clipAuditSubject(text: string, max = AUDIT_SUBJECT_MAX): string {
  const firstNonEmpty = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  return clipBody(firstNonEmpty, max);
}
