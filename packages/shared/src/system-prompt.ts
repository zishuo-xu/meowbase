import type { AgentId, AgentProfile, EvidenceEntry, Skill, ThreadRepo } from './types.js';
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
    `- 收棒后三选一:接(能干就干)、退(行首 @ 对的那只并说明)、升(行首 @人 或 @owner 并写清要拍板的事)、持(行首写 等 原因;要跑测试或构建时行首写 等跑 命令,只认白名单内的形状如 npm test / git status,平台跑完再叫醒你)。不要把人当路由器。\n` +
    `- 出口检查:发出去之前问「到我这里结束了吗」。需要对方动手才行首 @;写完结论或问人要不要继续都不算交棒。\n` +
    `- 改了文件必须先自检再交审查;没有对照任务和验证的改动不要交。\n` +
    `- 没有本轮命令和结果,不能声称完成,审查官也不能写通过。跑不了就写「跑不了:原因」。不因缺测试文件就禁止交接。\n` +
    `- 审查官写出「通过」或「需修改」后停棒,不要再 @ 别人、不要问人要不要继续。\n` +
    `分工纪律:要不要交接、交给谁,由你根据角色判断。\n` +
    workflowFor(selfAgentId, team) +
    `何时不要交接:简单问答、自我介绍、纯解释、已经在审别人的产出。\n` +
    `怎么交(交接规则):必须另起一行,行首写 @名字 或 @id,空格后写具体任务。升给人则行首写 @人 或 @owner。句中的 @ 不会交接。不要 @ 自己。`
  );
}

export function buildSystemPrompt(input: {
  profile?: AgentProfile;
  team?: readonly TeamMember[];
  skills?: Skill[];
  evidenceRefs: EvidenceEntry[];
  workdir?: string;
  repo?: ThreadRepo;
}): string | undefined {
  const parts: string[] = [];
  if (input.profile) {
    const p = input.profile;
    const pin = input.workdir ? `当前工作目录是 ${input.workdir}。` : '';
    const workdirRule = input.repo
      ? `这是真实仓库 ${input.repo.path} 的 worktree,绝对路径 ${input.workdir ?? ''}。当前分支 ${input.repo.branch} 是你自己的,可以 push 你自己这根 ${input.repo.branch},也可以对自己这根开 PR(gh pr create --base ${input.repo.baseBranch})。不许自己把 PR 合进去,合不合由人在审批卡上定。不许碰 ${input.repo.baseBranch}、不许动 .git、不许切分支。所有文件创建/修改都发生在当前工作目录内,只使用相对路径,禁止读写工作目录以外的路径。`
      : `${pin}所有文件创建/修改都发生在当前工作目录(线程沙箱)内,只使用相对路径,禁止读写工作目录以外的路径。不要上溯到平台仓库的 packages/。`;
    parts.push(
      `你是 ${p.name},${p.role}。性格:${p.personality}。擅长:${p.expertise.join('、')}。` +
        `\n工作区规则:${workdirRule}`,
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
