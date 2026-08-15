import { describe, expect, it } from 'vitest';
import { matchSkills } from '../src/skills.js';
import type { Skill } from '../src/types.js';

const skills: Skill[] = [
  { id: 'tdd', name: '测试驱动开发', description: 'd', triggers: ['tdd', '测试驱动'], prompt: '红绿重构' },
  { id: 'review', name: '代码审查', description: 'd', triggers: ['review', '审查'], prompt: '审查清单' },
];

describe('matchSkills', () => {
  it('命中英文触发词(大小写不敏感)', () => {
    expect(matchSkills('帮我 REVIEW 一下', skills).map((s) => s.id)).toEqual(['review']);
  });

  it('命中中文触发词', () => {
    expect(matchSkills('用测试驱动来写', skills).map((s) => s.id)).toEqual(['tdd']);
  });

  it('多技能同时命中', () => {
    expect(matchSkills('先 tdd 再 review', skills).map((s) => s.id)).toEqual(['tdd', 'review']);
  });

  it('无命中返回空数组', () => {
    expect(matchSkills('今天天气不错', skills)).toEqual([]);
  });
});
