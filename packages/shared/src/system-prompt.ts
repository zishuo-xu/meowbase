import type { AgentId, AgentProfile, EvidenceEntry, Skill } from './types.js';
import { DEFAULT_ROSTER, type TeamMember } from './catalog.js';

export type { TeamMember };

function rosterLines(team: readonly TeamMember[]): string {
  return team
    .map((m) => `- ${m.name}(@${m.name}/@${m.agentId}): ${m.role}`)
    .join('\n');
}

function othersOf(
  team: readonly TeamMember[],
  selfAgentId?: AgentId,
): TeamMember[] {
  return team.filter((m) => m.agentId !== selfAgentId);
}

function pickPeer(
  team: readonly TeamMember[],
  selfAgentId: AgentId | undefined,
  preferredId: AgentId,
  roleHint: RegExp,
): TeamMember | undefined {
  const others = othersOf(team, selfAgentId);
  return (
    others.find((m) => m.agentId === preferredId) ??
    others.find((m) => roleHint.test(m.role)) ??
    others[0]
  );
}

function mentionOf(member: TeamMember | undefined): string {
  return member ? `@${member.name}` : '@另一位成员';
}

function workflowFor(
  selfAgentId: AgentId | undefined,
  team: readonly TeamMember[],
): string {
  const reviewer = mentionOf(pickPeer(team, selfAgentId, 'gemini', /审查/));
  const author = mentionOf(pickPeer(team, selfAgentId, 'claude', /架构|写/));
  if (selfAgentId === 'gemini') {
    return (
      `何时必须交接:\n` +
      `- 审查结束后,另起一行 ${author} 给结论,必须写明「通过」或「需修改」;需修改时列出要点,不要问人,不要 @ 其他人。\n` +
      `- 你自己写完代码后交 ${author} 看一眼,不要自己审自己。\n`
    );
  }
  if (selfAgentId === 'opencode') {
    return (
      `何时必须交接:\n` +
      `- 脚本或落地做完后,另起一行 ${reviewer} 请审查(不要自己审自己)。\n` +
      `- 你缺第二视角、或遇到做不了的部分时。\n`
    );
  }
  return (
    `何时必须交接:\n` +
    `- 你写完或改完代码后,另起一行 ${reviewer} 请审查(不要自己审自己)。\n` +
    `- 下一步明显属于别人的职责(审查/脚本落地)时,做完自己这段就交出去。\n` +
    `- 你缺工具、缺第二视角、或遇到做不了的部分时。\n`
  );
}

export function buildA2AProtocol(
  team: readonly TeamMember[] = DEFAULT_ROSTER,
  selfAgentId?: AgentId,
): string {
  return (
    `团队成员:\n${rosterLines(team)}\n` +
    `分工纪律:人只表达要做什么。要不要交接、交给谁,由你根据角色判断,不要问「要不要交给某某」。\n` +
    workflowFor(selfAgentId, team) +
    `何时不要交接:简单问答、自我介绍、纯解释、已经在审别人的产出。\n` +
    `怎么交(交接规则):必须另起一行,行首写 @名字 或 @id,空格后写具体任务。句中的 @ 不会交接。不要 @ 自己。`
  );
}

export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  team?: readonly TeamMember[];
  skills?: Skill[];
  evidenceRefs: EvidenceEntry[];
}): string | undefined {
  const parts: string[] = [];
  if (input.profile) {
    const p = input.profile;
    parts.push(
      `你是 ${p.name},${p.role}。性格:${p.personality}。擅长:${p.expertise.join('、')}。` +
        `\n工作区规则:所有文件创建/修改都发生在当前工作目录(线程沙箱)内,只使用相对路径,禁止读写工作目录以外的路径。`,
    );
  }
  const team = input.team ?? (input.profile ? DEFAULT_ROSTER : undefined);
  if (team && team.length > 0) {
    parts.push(buildA2AProtocol(team, input.profile?.agentId));
  }
  if (input.skills && input.skills.length > 0) {
    const lines = input.skills.map((s) => `[技能:${s.name}] ${s.prompt}`);
    parts.push(`本轮请遵循以下技能:\n${lines.join('\n\n')}`);
  }
  if (input.evidenceRefs.length > 0) {
    const lines = input.evidenceRefs.map(
      (e) => `- [${e.kind}] ${e.title}: ${e.content}`,
    );
    parts.push(`团队记忆:\n${lines.join('\n')}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
