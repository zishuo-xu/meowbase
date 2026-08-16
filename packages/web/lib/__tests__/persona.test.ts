import { describe, expect, it } from 'vitest';
import { AGENT_ORDER, getPersona, PERSONAS } from '../persona';

describe('persona', () => {
  it('三只猫 + 用户都有 persona', () => {
    expect(Object.keys(PERSONAS)).toEqual(['claude', 'gemini', 'opencode', 'user']);
    expect(getPersona('claude').name).toBe('墨墨');
    expect(getPersona('user').badge).toBeTruthy();
  });

  it('AGENT_ORDER 稳定', () => {
    expect(AGENT_ORDER).toEqual(['claude', 'gemini', 'opencode']);
  });

  it('未知 id 回退用户 persona', () => {
    expect(getPersona('unknown' as never).name).toBe('你');
  });
});
