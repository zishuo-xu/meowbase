import { describe, expect, it } from 'vitest';
import { AUDIT_SUBJECT_MAX, clipAuditSubject } from '../src/audit-subject.js';

describe('clipAuditSubject', () => {
  it('只取第一行并截到约 80 字,不保留全文', () => {
    const rest = '第二行不该出现。'.repeat(20);
    const first = '这是第一行摘要，后面还会跟着很长的正文。';
    const full = `${first}\n${rest}`;
    const subject = clipAuditSubject(full);
    expect(subject.length).toBeLessThanOrEqual(AUDIT_SUBJECT_MAX + 1);
    expect(subject).not.toContain('第二行');
    expect(full.includes(subject.replace(/…$/, ''))).toBe(true);
    expect(subject).not.toBe(full);
  });

  it('短单行原样返回', () => {
    expect(clipAuditSubject('你好')).toBe('你好');
  });
});
