import { clipBody } from './a2a.js';

/** 审计 subject 只取正文第一行,截到大约一行能扫完。 */
export const AUDIT_SUBJECT_MAX = 80;

export function clipAuditSubject(text: string, max = AUDIT_SUBJECT_MAX): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  return clipBody(firstLine, max);
}
