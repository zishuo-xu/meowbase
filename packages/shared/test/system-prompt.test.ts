import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/system-prompt.js';
import type { AgentProfile, EvidenceEntry, Skill } from '../src/types.js';

const profile: AgentProfile = {
  agentId: 'claude',
  name: '墨墨',
  personality: '沉稳细致',
  role: '主架构师',
  expertise: ['架构设计', 'TypeScript'],
  createdAt: '2026-08-16T00:00:00.000Z',
};

const reviewerProfile: AgentProfile = {
  agentId: 'gemini',
  name: '闪闪',
  personality: '严谨直接',
  role: '审查官',
  expertise: ['代码审查'],
  createdAt: '2026-08-16T00:00:00.000Z',
};

const executorProfile: AgentProfile = {
  agentId: 'opencode',
  name: '团团',
  personality: '圆润可靠',
  role: '执行者',
  expertise: ['脚本'],
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
  it('仅 profile:拼出身份段与团队交接规则', () => {
    const prompt = buildSystemPrompt({ profile, evidenceRefs: [] });
    expect(prompt).toContain('你是 墨墨,主架构师');
    expect(prompt).toContain('性格:沉稳细致');
    expect(prompt).toContain('擅长:架构设计、TypeScript');
    expect(prompt).toContain('团队成员:');
    expect(prompt).toContain('墨墨(@墨墨/@claude)');
    expect(prompt).toContain('团团(@团团/@opencode)');
    expect(prompt).toContain('交接规则');
    expect(prompt).toContain('行首写');
    expect(prompt).toContain('何时必须交接');
    expect(prompt).toContain('不要问');
    expect(prompt).toContain('@闪闪');
    expect(prompt).toContain('请审查');
    expect(prompt).not.toContain('@团团 请审查');
    expect(prompt).toContain('团队纪律');
    expect(prompt).toContain('要不要继续');
    expect(prompt).toContain('怎样算做完');
    expect(prompt).toContain('自检');
    expect(prompt).toContain('接(能干就干)');
    expect(prompt).toContain('退');
    expect(prompt).toContain('升');
    expect(prompt).toContain('持');
    expect(prompt).toContain('@人');
    expect(prompt).toContain('@owner');
    expect(prompt).toContain('出口检查');
    expect(prompt).toContain('本轮命令和结果');
    expect(prompt).toContain('不能写通过');
  });

  it('交接条目来自 team.handoff,{to} 填对手名字', () => {
    const prompt = buildSystemPrompt({
      profile,
      team: [
        {
          agentId: 'claude',
          name: '墨墨',
          role: '主架构师',
          handoffTo: 'opencode',
          handoff: ['写完交 {to} 审一下'],
        },
        { agentId: 'opencode', name: '团团', role: '执行者' },
      ],
      evidenceRefs: [],
    });
    expect(prompt).toContain('写完交 @团团 审一下');
    expect(prompt).not.toContain('{to}');
    expect(prompt).not.toContain('@闪闪');
  });

  it('怎样算做完来自 team.doneWhen', () => {
    const prompt = buildSystemPrompt({
      profile,
      team: [
        {
          agentId: 'claude',
          name: '墨墨',
          role: '主架构师',
          doneWhen: ['沙箱里有实现和测试'],
        },
      ],
      evidenceRefs: [],
    });
    expect(prompt).toContain('怎样算做完');
    expect(prompt).toContain('沙箱里有实现和测试');
  });

  it('闪闪:写出结论即停,需修改由平台打回', () => {
    const prompt = buildSystemPrompt({ profile: reviewerProfile, evidenceRefs: [] });
    expect(prompt).toContain('你是 闪闪,审查官');
    expect(prompt).toContain('通过');
    expect(prompt).toContain('需修改');
    expect(prompt).toContain('写出结论即停');
    expect(prompt).toContain('不要再 @');
    expect(prompt).not.toContain('另起一行 @墨墨');
    expect(prompt).not.toContain('@团团 请审查');
  });

  it('团团:做完交闪闪审查', () => {
    const prompt = buildSystemPrompt({ profile: executorProfile, evidenceRefs: [] });
    expect(prompt).toContain('你是 团团,执行者');
    expect(prompt).toContain('@闪闪');
    expect(prompt).toContain('请审查');
    expect(prompt).not.toContain('@墨墨 请审查');
  });

  it('显式 team 覆盖默认名册', () => {
    const prompt = buildSystemPrompt({
      profile,
      team: [{ agentId: 'claude', name: '小墨', role: '写手' }],
      evidenceRefs: [],
    });
    expect(prompt).toContain('小墨(@小墨/@claude): 写手');
    expect(prompt).not.toContain('闪闪');
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

  it('传入 workdir 时钉死线程沙箱绝对路径', () => {
    const prompt = buildSystemPrompt({
      profile,
      evidenceRefs: [],
      workdir: '/tmp/meowbase-work/t1',
    });
    expect(prompt).toContain('/tmp/meowbase-work/t1');
    expect(prompt).toContain('不要上溯');
    expect(prompt).toContain('packages/');
  });
});

const skill: Skill = {
  id: 'tdd',
  name: '测试驱动开发',
  description: 'd',
  triggers: ['tdd'],
  prompt: '红-绿-重构循环',
};

describe('buildSystemPrompt 技能段', () => {
  it('命中技能时注入技能段,位于身份之后记忆之前', () => {
    const prompt = buildSystemPrompt({ profile, skills: [skill], evidenceRefs: [evidence] });
    expect(prompt).toContain('[技能:测试驱动开发] 红-绿-重构循环');
    const idxIdentity = prompt?.indexOf('你是 墨墨') ?? -1;
    const idxSkill = prompt?.indexOf('[技能:测试驱动开发]') ?? -1;
    const idxMemory = prompt?.indexOf('团队记忆') ?? -1;
    expect(idxSkill).toBeGreaterThan(idxIdentity);
    expect(idxMemory).toBeGreaterThan(idxSkill);
  });

  it('无技能时不输出技能段', () => {
    const prompt = buildSystemPrompt({ profile, skills: [], evidenceRefs: [] });
    expect(prompt).not.toContain('[技能:');
  });
});
