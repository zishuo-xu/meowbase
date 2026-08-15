import { describe, expect, it } from 'vitest';
import {
  generateEvidenceId,
  parseConfirmCommand,
  parseEvidenceRefs,
  parseLearnCommand,
} from '../src/commands.js';

describe('generateEvidenceId', () => {
  it('生成 ev_ + 8 位 id,且不重复', () => {
    const a = generateEvidenceId();
    const b = generateEvidenceId();
    expect(a).toMatch(/^ev_[a-f0-9]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('parseConfirmCommand', () => {
  it('解析 #confirm ev_xxx', () => {
    expect(parseConfirmCommand('#confirm ev_ab12cd34')).toEqual({ id: 'ev_ab12cd34' });
  });

  it('普通消息返回 null', () => {
    expect(parseConfirmCommand('今天天气不错')).toBeNull();
    expect(parseConfirmCommand('#confirm 不是证据id')).toBeNull();
  });
});

describe('parseLearnCommand', () => {
  it('解析 #learn 标题', () => {
    expect(parseLearnCommand('#learn 用户偏好 TypeScript')).toEqual({ title: '用户偏好 TypeScript' });
  });

  it('标题为空返回 null', () => {
    expect(parseLearnCommand('#learn   ')).toBeNull();
    expect(parseLearnCommand('普通消息')).toBeNull();
  });
});

describe('parseEvidenceRefs', () => {
  it('解析多个 #ev_ 引用', () => {
    expect(parseEvidenceRefs('查一下 #ev_a1b2c3d4 和 #ev_ef012345')).toEqual([
      'ev_a1b2c3d4',
      'ev_ef012345',
    ]);
  });

  it('无引用返回空数组', () => {
    expect(parseEvidenceRefs('没有引用')).toEqual([]);
  });
});
