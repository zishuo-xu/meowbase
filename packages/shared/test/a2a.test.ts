import { describe, expect, it } from 'vitest';
import {
  parseA2AHandoff,
  findInlineA2AMentions,
  formatA2AHandoffPrompt,
  formatDroppedBallNote,
} from '../src/a2a.js';

describe('parseA2AHandoff', () => {
  it('行首 mention → 解析目标与任务', () => {
    expect(
      parseA2AHandoff('写完了。\n@opencode 请审查这段代码\n重点看边界条件。', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查这段代码\n重点看边界条件。' });
  });

  it('行首中文名与英文 id 等价', () => {
    expect(
      parseA2AHandoff('写完了。\n@团团 请审查这段代码\n重点看边界条件。', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查这段代码\n重点看边界条件。' });
  });

  it('自调用不触发', () => {
    expect(parseA2AHandoff('@claude 我自己来', 'claude')).toBeNull();
  });

  it('行内 mention 不触发(仅行首)', () => {
    expect(parseA2AHandoff('请 @opencode 帮忙看看', 'claude')).toBeNull();
  });

  it('无 mention 返回 null', () => {
    expect(parseA2AHandoff('干完了,没有其他事。', 'claude')).toBeNull();
  });

  it('任务为空不触发', () => {
    expect(parseA2AHandoff('@opencode', 'claude')).toBeNull();
  });

  it('代码块里的 @ 不触发交接', () => {
    expect(
      parseA2AHandoff('示例:\n```\n@opencode 这不是交接\n```\n做完了。', 'claude'),
    ).toBeNull();
    expect(
      parseA2AHandoff('示例:\n```\n@opencode 这不是交接\n```\n@团团 请审查', 'claude'),
    ).toEqual({ target: 'opencode', task: '请审查' });
  });
});

describe('formatA2AHandoffPrompt', () => {
  it('轻量交接包带目标、文件、沙箱和收棒', () => {
    const prompt = formatA2AHandoffPrompt('墨墨', 'claude', '已写 add.ts\n自检:无测试\n@闪闪 请审查', '请审查 add.ts', {
      goal: '写一个 add.ts 并保存',
      files: ['add.ts'],
      closeout: 'reviewer',
    });
    expect(prompt).toContain('【A2A 交接包】');
    expect(prompt).toContain('用户目标: 写一个 add.ts 并保存');
    expect(prompt).toContain('改动文件: add.ts');
    expect(prompt).toContain('当前工作目录');
    expect(prompt).toContain('【你的任务】');
    expect(prompt).toContain('请审查 add.ts');
    expect(prompt).toContain('【收棒】');
    expect(prompt).toContain('不要再 @');
    expect(prompt).not.toContain('@闪闪 请审查');
  });

  it('默认收棒不禁止交下一棒', () => {
    const prompt = formatA2AHandoffPrompt('墨墨', 'claude', '写完了', '请落地脚本');
    expect(prompt).toContain('交下一棒');
    expect(prompt).toContain('接(能干就干)');
    expect(prompt).not.toContain('不要再 @ 任何人');
  });
});

describe('formatDroppedBallNote', () => {
  it('审查官写出通过或需修改不提示', () => {
    expect(
      formatDroppedBallNote({
        stop: 'no-handoff',
        lastContent: '## 结论\n通过',
        speakerName: '闪闪',
        role: '审查官',
        wasRelay: true,
      }),
    ).toBeNull();
    expect(
      formatDroppedBallNote({
        stop: 'reviewer-closeout',
        lastContent: '## 结论\n需修改\n- 补测试',
        speakerName: '闪闪',
        role: '审查官',
        wasRelay: true,
      }),
    ).toBeNull();
  });

  it('简单问答不提示', () => {
    expect(
      formatDroppedBallNote({
        stop: 'no-handoff',
        lastContent: '我是墨墨',
        speakerName: '墨墨',
        role: '主架构师',
        wasRelay: false,
      }),
    ).toBeNull();
  });

  it('收了棒却停住、或想交却交不了,要让人看见', () => {
    expect(
      formatDroppedBallNote({
        stop: 'no-handoff',
        lastContent: '看了一下还行',
        speakerName: '闪闪',
        role: '审查官',
        wasRelay: true,
      }),
    ).toContain('球还在地上');
    expect(
      formatDroppedBallNote({
        stop: 'blocked',
        lastContent: '@墨墨 你再看看',
        speakerName: '团团',
        role: '执行者',
        wasRelay: true,
        blockedTargetName: '墨墨',
      }),
    ).toContain('想交给墨墨');
  });

  it('句中 @ 已有提示时不再叠一句', () => {
    expect(
      formatDroppedBallNote({
        stop: 'no-handoff',
        lastContent: '请 @闪闪 审查',
        speakerName: '墨墨',
        role: '主架构师',
        wasRelay: true,
        hadInlineHint: true,
      }),
    ).toBeNull();
  });
});

describe('findInlineA2AMentions', () => {
  it('句中 @ 记为 inline,行首交接不算', () => {
    expect(findInlineA2AMentions('请 @团团 帮忙看看', 'claude')).toEqual(['opencode']);
    expect(findInlineA2AMentions('@团团 请审查这段代码', 'claude')).toEqual([]);
  });
});
