import { describe, expect, it } from 'vitest';
import { AUDIT_SUBJECT_MAX, clipAuditSubject } from '../src/audit-subject.js';

describe('clipAuditSubject', () => {
  it('只取第一个非空行并截到约 80 字,不保留全文', () => {
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

  it('以空行开头时取第一个非空行', () => {
    expect(clipAuditSubject('\n\n审查通过：边界覆盖了。')).toBe('审查通过：边界覆盖了。');
  });

  it('只有空白字符的行也算空,继续往下找', () => {
    expect(clipAuditSubject('  \n\t\n  通过')).toBe('通过');
  });

  it('认 \\r\\n 换行', () => {
    expect(clipAuditSubject('\r\n\r\n落地 slug.ts\r\n第二行')).toBe('落地 slug.ts');
  });

  it('整段全空返回空串', () => {
    expect(clipAuditSubject('')).toBe('');
    expect(clipAuditSubject('\n\n  \n\t')).toBe('');
  });

  it('第一个非空行超长仍按 AUDIT_SUBJECT_MAX 截断', () => {
    const long = '审'.repeat(AUDIT_SUBJECT_MAX + 20);
    const subject = clipAuditSubject(`\n\n${long}\n第二行不该出现`);
    expect(subject.length).toBeLessThanOrEqual(AUDIT_SUBJECT_MAX + 1);
    expect(subject).not.toContain('第二行');
    expect(subject.endsWith('…')).toBe(true);
  });
});
