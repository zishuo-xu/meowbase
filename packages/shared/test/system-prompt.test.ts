import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt.js';
import type { AgentProfile, EvidenceEntry } from '../src/types.js';

const profile: AgentProfile = {
  agentId: 'claude',
  name: '墨墨',
  personality: '沉稳细致',
  role: '主力写手',
  expertise: ['架构设计', 'TypeScript'],
  createdAt: '2026-08-16T00:00:00.000Z',
};

const evidence: EvidenceEntry = {
  id: 'ev_a1b2c3d4',
  threadId: 't1',
  kind: 'fact',
  title: '用户偏好 TS',
  content: '用户明确表示喜欢 TypeScript',
  status: 'confirmed',
  createdAt: '2026-08-16T00:00:00.000Z',
};

describe('buildSystemPrompt', () => {
  it('仅 profile:拼出身份段', () => {
    const prompt = buildSystemPrompt({ profile, evidenceRefs: [] });
    expect(prompt).toContain('你是 墨墨,主力写手');
    expect(prompt).toContain('性格:沉稳细致');
    expect(prompt).toContain('擅长:架构设计、TypeScript');
  });

  it('仅引用:拼出团队记忆段', () => {
    const prompt = buildSystemPrompt({ evidenceRefs: [evidence] });
    expect(prompt).toContain('团队记忆');
    expect(prompt).toContain('[fact] 用户偏好 TS: 用户明确表示喜欢 TypeScript');
  });

  it('两者都有:分段拼接', () => {
    const prompt = buildSystemPrompt({ profile, evidenceRefs: [evidence] });
    expect(prompt).toContain('你是 墨墨');
    expect(prompt).toContain('团队记忆');
    expect(prompt?.indexOf('团队记忆') ?? -1).toBeGreaterThan(prompt?.indexOf('你是 墨墨') ?? -1);
  });

  it('都为空返回 undefined', () => {
    expect(buildSystemPrompt({ evidenceRefs: [] })).toBeUndefined();
  });
});
