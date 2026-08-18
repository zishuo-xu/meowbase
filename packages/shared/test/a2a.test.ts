import { describe, expect, it } from 'vitest';
import {
  parseA2AHandoff,
  findInlineA2AMentions,
  findInlineEscalateTokens,
  formatA2AHandoffPrompt,
  formatA2ARelayNote,
  formatAbortedBallNote,
  formatDroppedBallNote,
  formatEscalatedBallNote,
  formatFreezeBallNote,
  formatFailedBallNote,
  formatHoldBallNote,
  formatPickupCommand,
  formatExitNudgeNote,
  formatExitNudgePrompt,
  isDroppedBallNote,
  isEscalatedBallNote,
  isExitNudgeNote,
  isFreezeBallNote,
  isHoldBallNote,
  parseA2ARelayNote,
  parseHoldExit,
  shouldNudgeExit,
  shouldResumePending,
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

  it('行首 @人 / @owner 升给人,空任务也算', () => {
    expect(parseA2AHandoff('方向定不了。\n@人 这个方案做不做', 'claude')).toEqual({
      target: 'human',
      task: '这个方案做不做',
    });
    expect(parseA2AHandoff('@owner', 'gemini')).toEqual({
      target: 'human',
      task: '请拍板',
    });
  });

  it('句中 @人 不升级', () => {
    expect(parseA2AHandoff('请 @人 拍板', 'claude')).toBeNull();
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
    expect(prompt).toContain('没证据不能写通过');
    expect(prompt).toContain('上一棒未附带本轮命令和结果');
    expect(prompt).not.toContain('@闪闪 请审查');
  });

  it('上一棒带了命令和结果时交接包标已验证', () => {
    const prompt = formatA2AHandoffPrompt(
      '墨墨',
      'claude',
      '已实际运行 `add(2,3)`,返回 5\n@闪闪 请审查',
      '请审查',
    );
    expect(prompt).toContain('上一棒附了本轮命令和结果');
  });

  it('传入 workdir 时交接包钉死沙箱绝对路径', () => {
    const prompt = formatA2AHandoffPrompt('墨墨', 'claude', '写完了', '请审查', {
      workdir: '/tmp/meowbase-work/t1',
    });
    expect(prompt).toContain('当前工作目录是 /tmp/meowbase-work/t1');
    expect(prompt).toContain('packages/');
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

describe('findInlineEscalateTokens', () => {
  it('句中 @人 记为 inline,行首升级不算', () => {
    expect(findInlineEscalateTokens('请 @人 拍板')).toEqual(['人']);
    expect(findInlineEscalateTokens('@人 这个方案做不做')).toEqual([]);
  });
});

describe('formatA2ARelayNote', () => {
  it('接力条带目标、文件、验证,给人点开', () => {
    const note = formatA2ARelayNote({
      fromName: '墨墨',
      toName: '闪闪',
      goal: '写 add.ts',
      files: ['add.ts'],
      task: '请审查 add.ts',
      previousOutput: '已实际运行 `add(2,3)`,返回 5',
    });
    expect(note).toContain('🤝 接力:墨墨 → 闪闪');
    expect(note).toContain('用户目标: 写 add.ts');
    expect(note).toContain('改动文件: add.ts');
    expect(note).toContain('验证: 有本轮命令和结果');
    expect(note).toContain('任务: 请审查 add.ts');
    expect(parseA2ARelayNote(note)).toEqual({
      headline: '🤝 接力:墨墨 → 闪闪',
      details: [
        '用户目标: 写 add.ts',
        '改动文件: add.ts',
        '验证: 有本轮命令和结果',
        '任务: 请审查 add.ts',
        '下一棒平台接着跑',
      ],
    });
  });
});

describe('shouldResumePending', () => {
  it('没点名或点名就是下一只则续跑', () => {
    expect(shouldResumePending('继续', 'gemini')).toBe(true);
    expect(shouldResumePending('@闪闪 接着做', 'gemini')).toBe(true);
  });

  it('点名另一只或行首 @人不续跑', () => {
    expect(shouldResumePending('@墨墨 重做', 'gemini')).toBe(false);
    expect(shouldResumePending('@人 我来拍板', 'gemini')).toBe(false);
  });
});

describe('formatEscalatedBallNote', () => {
  it('升级给人不是球掉地上', () => {
    const note = formatEscalatedBallNote('墨墨', '这个方案做不做');
    expect(note).toContain('球在人手里');
    expect(note).toContain('墨墨请求拍板');
    expect(note).toContain('这个方案做不做');
    expect(isEscalatedBallNote(note)).toBe(true);
    expect(isDroppedBallNote(note)).toBe(false);
    expect(
      formatDroppedBallNote({
        stop: 'escalated',
        lastContent: '@人 这个方案做不做',
        speakerName: '墨墨',
        role: '主架构师',
        wasRelay: false,
      }),
    ).toBeNull();
  });
});

describe('parseHoldExit', () => {
  it('行首等/HOLD 才是持球,句中等等不算', () => {
    expect(parseHoldExit('写到一半。\n等 测试跑完')).toBe('测试跑完');
    expect(parseHoldExit('HOLD:等 CI 绿')).toBe('等 CI 绿');
    expect(parseHoldExit('先等等看再交')).toBeNull();
    expect(parseHoldExit('等等再说')).toBeNull();
  });

  it('持球不是掉地上,也不补问', () => {
    const note = formatHoldBallNote('墨墨', '测试跑完');
    expect(isHoldBallNote(note)).toBe(true);
    expect(note).toContain('球在等:墨墨');
    expect(note).toContain('测试跑完');
    expect(isDroppedBallNote(note)).toBe(false);
    expect(
      formatDroppedBallNote({
        stop: 'held',
        lastContent: '等 测试跑完',
        speakerName: '墨墨',
        role: '主架构师',
        wasRelay: false,
      }),
    ).toBeNull();
    expect(
      shouldNudgeExit({
        wasRelay: false,
        hadInlineHint: false,
        isReviewer: false,
        hasExplicitVerdict: false,
        hasDiff: true,
        hasHold: true,
      }),
    ).toBe(false);
  });
});

describe('formatFreezeBallNote', () => {
  it('拉闸后球在人手里,不是掉地上', () => {
    const note = formatFreezeBallNote();
    expect(isFreezeBallNote(note)).toBe(true);
    expect(note).toContain('已拉闸');
    expect(isDroppedBallNote(note)).toBe(false);
    expect(isEscalatedBallNote(note)).toBe(false);
  });
});

describe('出口补问', () => {
  it('问答收尾不问,该交棒才问', () => {
    expect(
      shouldNudgeExit({
        wasRelay: false,
        hadInlineHint: false,
        isReviewer: false,
        hasExplicitVerdict: false,
        hasDiff: false,
      }),
    ).toBe(false);
    expect(
      shouldNudgeExit({
        wasRelay: false,
        hadInlineHint: false,
        isReviewer: false,
        hasExplicitVerdict: false,
        hasDiff: true,
      }),
    ).toBe(true);
    expect(
      shouldNudgeExit({
        wasRelay: true,
        hadInlineHint: false,
        isReviewer: true,
        hasExplicitVerdict: false,
        hasDiff: false,
      }),
    ).toBe(true);
    expect(
      shouldNudgeExit({
        wasRelay: true,
        hadInlineHint: false,
        isReviewer: true,
        hasExplicitVerdict: true,
        hasDiff: false,
      }),
    ).toBe(false);
    expect(
      shouldNudgeExit({
        wasRelay: true,
        hadInlineHint: false,
        isReviewer: false,
        hasExplicitVerdict: true,
        hasDiff: false,
      }),
    ).toBe(false);
    expect(
      shouldNudgeExit({
        wasRelay: false,
        hadInlineHint: true,
        isReviewer: false,
        hasExplicitVerdict: false,
        hasDiff: false,
      }),
    ).toBe(true);
  });

  it('补问句给人看,prompt 不替猫写 @', () => {
    const note = formatExitNudgeNote('墨墨');
    expect(isExitNudgeNote(note)).toBe(true);
    expect(note).toContain('墨墨');
    const prompt = formatExitNudgePrompt({
      previousOutput: '写完了,请闪闪看',
      handoffName: '闪闪',
      isReviewer: false,
    });
    expect(prompt).toContain('只再问一次');
    expect(prompt).toContain('写完了,请闪闪看');
    expect(prompt).toContain('@闪闪');
    expect(prompt).toContain('@人');
  });
});

describe('捡球', () => {
  it('认出球还在地上,拼出交接命令', () => {
    expect(isDroppedBallNote('⚠️ 球还在地上:闪闪停棒了')).toBe(true);
    expect(isDroppedBallNote(formatAbortedBallNote())).toBe(true);
    expect(isDroppedBallNote(formatFailedBallNote())).toBe(true);
    expect(formatFailedBallNote()).toContain('失败');
    expect(isDroppedBallNote('🤝 接力:墨墨 → 闪闪')).toBe(false);
    expect(formatPickupCommand('闪闪')).toBe('@闪闪 接着做');
    expect(formatPickupCommand('@墨墨')).toBe('@墨墨 接着做');
  });
});
