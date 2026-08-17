import { describe, expect, it } from 'vitest';
import { matchSkills } from '../src/skills.js';
import type { Skill } from '../src/types.js';

const skills: Skill[] = [
  { id: 'tdd', name: '测试驱动开发', description: 'd', triggers: ['tdd', '测试驱动'], prompt: '红绿重构' },
  { id: 'review', name: '代码审查', description: 'd', triggers: ['review', '审查'], prompt: '审查清单' },
  { id: 'quality-gate', name: '自检门', description: 'd', triggers: [], prompt: '先自检再交审', always: true },
  { id: 'scaffold', name: '脚手架', description: 'd', triggers: ['脚手架'], prompt: '停看终态' },
];

describe('matchSkills', () => {
  it('命中英文触发词(大小写不敏感)', () => {
    expect(matchSkills('帮我 REVIEW 一下', skills).map((s) => s.id)).toEqual([
      'review',
      'quality-gate',
    ]);
  });

  it('命中中文触发词', () => {
    expect(matchSkills('用测试驱动来写', skills).map((s) => s.id)).toEqual(['tdd', 'quality-gate']);
  });

  it('多技能同时命中', () => {
    expect(matchSkills('先 tdd 再 review', skills).map((s) => s.id)).toEqual([
      'tdd',
      'review',
      'quality-gate',
    ]);
  });

  it('无命中返回空数组', () => {
    expect(matchSkills('今天天气不错', skills.filter((s) => !s.always))).toEqual([]);
  });

  it('always 技能即使没有触发词也挂上', () => {
    expect(matchSkills('写一个快排', skills).map((s) => s.id)).toEqual(['quality-gate']);
  });

  it('命中拉闸词脚手架', () => {
    expect(matchSkills('脚手架', skills).map((s) => s.id)).toEqual(['quality-gate', 'scaffold']);
  });
});
