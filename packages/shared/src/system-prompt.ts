import type { AgentId, AgentProfile, EvidenceEntry, Skill } from './types.js';
import { DEFAULT_ROSTER, type TeamMember } from './catalog.js';

export type { TeamMember };

function rosterLines(team: readonly TeamMember[]): string {
  return team
    .map((m) => `- ${m.name}(@${m.name}/@${m.agentId}): ${m.role}`)
    .join('\n');
}

function mentionTo(
  self: TeamMember | undefined,
  team: readonly TeamMember[],
): string {
  if (!self?.handoffTo) return '@另一位成员';
  const peer = team.find((m) => m.agentId === self.handoffTo);
  return peer ? `@${peer.name}` : '@另一位成员';
}

function fillTo(lines: readonly string[], to: string): string {
  return lines.map((line) => `- ${line.replaceAll('{to}', to)}`).join('\n');
}

function workflowFor(
  selfAgentId: AgentId | undefined,
  team: readonly TeamMember[],
): string {
  const self = team.find((m) => m.agentId === selfAgentId);
  const to = mentionTo(self, team);
  const handoff = self?.handoff ?? [];
  const doneWhen = self?.doneWhen ?? [];
  const handoffBlock =
    handoff.length > 0
      ? `何时必须交接:\n${fillTo(handoff, to)}\n`
      : `何时必须交接:\n- 下一步明显属于别人的职责时,做完自己这段就交出去。\n`;
  const doneBlock =
    doneWhen.length > 0
      ? `怎样算做完:\n${fillTo(doneWhen, to)}\n`
      : `怎样算做完:\n- 本职做完,该交的已经行首交接,不要把下一步丢给人。\n`;
  return `${handoffBlock}${doneBlock}`;
}

export function buildA2AProtocol(
  team: readonly TeamMember[] = DEFAULT_ROSTER,
  selfAgentId?: AgentId,
): string {
  return (
    `团队成员:\n${rosterLines(team)}\n` +
    `团队纪律:\n` +
    `- 人只说目标。不要问「要不要交给某某」「要不要继续」「还要我做什么吗」。\n` +
    `- 本职没做完不算完;做完就按交接条目交下一棒。\n` +
    `- 改了文件必须先自检再交审查;没有对照任务和验证的改动不要交。\n` +
    `分工纪律:要不要交接、交给谁,由你根据角色判断。\n` +
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
