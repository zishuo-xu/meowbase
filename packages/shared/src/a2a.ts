import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';
import { extractMentionTargets } from './mention-targets.js';
import { hasExplicitReviewVerdict } from './review-verdict.js';
import { hasVerificationEvidence } from './verification.js';

/** 行首 @人 / @owner 升给人,不是 registry 里的猫(对齐 clowder @owner)。 */
export const HUMAN_ESCALATE_TOKENS = ['人', 'owner', 'co-worker', 'coworker'] as const;

export type A2AHandoffTarget = AgentId | 'human';

export interface A2AHandoff {
  target: A2AHandoffTarget;
  task: string;
}

export function isHumanEscalateToken(token: string): boolean {
  const key = token.trim().toLowerCase();
  return HUMAN_ESCALATE_TOKENS.some((item) => item.toLowerCase() === key);
}

const LINE_START = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)\s*(.*)$/;
const LINE_START_ANY = /^\s*@([a-zA-Z][a-zA-Z0-9_-]*|[\u4e00-\u9fa5]+)/;

/**
 * A2A 接力检测(借鉴 clowder F046):解析 agent 回复文本中
 * 行首的 @mention → 平台把任务自动交接给目标 agent。
 * 仅行首 mention 触发;过滤自调用;任务为空不触发。
 * 中文名与英文 id 等价(@墨墨 = @claude)。
 */
export function parseA2AHandoff(
  text: string,
  currentAgentId?: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): A2AHandoff | null {
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(LINE_START);
    if (!match) continue;
    const token = match[1] ?? '';
    const rest = lines
      .slice(i + 1)
      .filter((l) => !LINE_START_ANY.test(l))
      .join('\n')
      .trim();
    const task = [match[2]?.trim(), rest].filter(Boolean).join('\n').trim();
    if (isHumanEscalateToken(token)) {
      return { target: 'human', task: task || '请拍板' };
    }
    const target = resolveAlias(token, catalog);
    if (!target || target === currentAgentId) continue;
    if (task) return { target, task };
  }
  return null;
}

/** 句中(非行首)的有效 @mention — 用于提示「这样写不会交接」 */
export function findInlineA2AMentions(
  text: string,
  currentAgentId?: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): AgentId[] {
  const found: AgentId[] = [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const start = line.match(LINE_START);
    const startId = start ? resolveAlias(start[1] ?? '', catalog) : undefined;
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    for (const match of line.matchAll(re)) {
      const id = resolveAlias(match[1] ?? '', catalog);
      if (!id || id === currentAgentId) continue;
      const atLineStart = startId === id && match.index === line.search(/@/);
      if (atLineStart) continue;
      if (!found.includes(id)) found.push(id);
    }
  }
  return found;
}

/** 句中 @人 / @owner — 用于提示「这样写不会升级」。 */
export function findInlineEscalateTokens(text: string): string[] {
  const found: string[] = [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const lines = stripped.split('\n');
  for (const line of lines) {
    if (!line) continue;
    const start = line.match(LINE_START);
    const startHuman = start ? isHumanEscalateToken(start[1] ?? '') : false;
    const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
    for (const match of line.matchAll(re)) {
      const token = match[1] ?? '';
      if (!isHumanEscalateToken(token)) continue;
      const atLineStart = startHuman && match.index === line.search(/@/);
      if (atLineStart) continue;
      const label = token.toLowerCase() === 'owner' || token.toLowerCase().startsWith('co-')
        ? token
        : '人';
      if (!found.includes(label)) found.push(label);
    }
  }
  return found;
}

export interface A2AHandoffExtras {
  goal?: string;
  files?: string[];
  closeout?: 'reviewer' | 'default';
  workdir?: string;
}

function stripHandoffLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !LINE_START_ANY.test(line))
    .join('\n')
    .trim();
}

function clipBody(text: string, max = 1800): string {
  const one = text.trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max)}…`;
}

/** 把上一棒的输出包装成下一棒能读懂的轻量交接包(对齐 clowder 的 thread packet,不建 mailbox) */
export function formatA2AHandoffPrompt(
  fromName: string,
  fromId: AgentId,
  previousOutput: string,
  task: string,
  extras: A2AHandoffExtras = {},
): string {
  const body = clipBody(stripHandoffLines(previousOutput) || previousOutput);
  const files = (extras.files ?? []).filter(Boolean);
  const closeout =
    extras.closeout === 'reviewer'
      ? '结论必须单独写明「通过」或「需修改」。没看到或没亲手跑出命令+结果,不能写通过。跑不了就写「跑不了:原因」并写需修改。写完结论即停:不要问人要不要继续,不要再 @ 任何人。需修改由平台打回写手。'
      : '做完按交接条目交下一棒。交棒前尽量附上本轮命令和结果;没有证据也可以交,但下一棒不能当通过。接(能干就干)/退(行首 @ 对的那只)/升(行首 @人 或 @owner)/持(行首 等 原因)。不要问人要不要继续。';
  const verified = hasVerificationEvidence(previousOutput);
  return [
    `【A2A 交接包】`,
    `来自: ${fromName} (@${fromId})`,
    extras.goal ? `用户目标: ${extras.goal}` : undefined,
    files.length > 0 ? `改动文件: ${files.join(', ')}` : undefined,
    verified
      ? '验证: 上一棒附了本轮命令和结果。'
      : '验证: 上一棒未附带本轮命令和结果;你必须自己跑一遍再下结论,没证据不能写通过。',
    extras.workdir
      ? `沙箱: 当前工作目录是 ${extras.workdir}。只使用该目录的相对路径,不要审或改平台仓库里的 packages/。`
      : `沙箱: 只使用当前工作目录的相对路径,不要审或改平台仓库里的 packages/。`,
    `上一棒原话:\n${body}`,
    `---`,
    `【你的任务】`,
    task,
    `【收棒】`,
    closeout,
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}

export function formatA2ARelayNote(input: {
  fromName: string;
  toName: string;
  goal?: string;
  files?: readonly string[];
  task: string;
  previousOutput?: string;
}): string {
  const files = (input.files ?? []).filter(Boolean);
  const verified = input.previousOutput
    ? hasVerificationEvidence(input.previousOutput)
    : false;
  return [
    `🤝 接力:${input.fromName} → ${input.toName}`,
    input.goal ? `用户目标: ${clipBody(input.goal, 80)}` : undefined,
    files.length > 0 ? `改动文件: ${files.join(', ')}` : undefined,
    verified ? '验证: 有本轮命令和结果' : '验证: 未附带,下一棒需自跑',
    input.task ? `任务: ${clipBody(input.task, 80)}` : undefined,
    '下一棒平台接着跑',
  ]
    .filter((line): line is string => line != null)
    .join('\n');
}

/** 有 pending 时:没点名叫别人就续跑下一跳;行首 @人 或点名另一只则不续。 */
export function shouldResumePending(
  content: string,
  pendingTo: AgentId,
  catalog: MentionCatalog = DEFAULT_CATALOG,
): boolean {
  for (const line of content.split('\n')) {
    const match = line.match(LINE_START);
    if (match && isHumanEscalateToken(match[1] ?? '')) return false;
  }
  const targets = extractMentionTargets(content, catalog);
  if (targets.length === 0) return true;
  return targets[0] === pendingTo;
}

export function parseA2ARelayNote(text: string): { headline: string; details: string[] } | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headline = lines[0];
  if (!headline?.includes('🤝 接力:')) return null;
  return { headline, details: lines.slice(1) };
}

export type A2AStopKind = 'no-handoff' | 'reviewer-closeout' | 'blocked' | 'escalated' | 'held';

const HOLD_LINE = /^\s*(?:HOLD|hold|等)[:：\s]+(\S.*)$/;
const HOLD_COMMAND_LINE = /^\s*(?:HOLDCMD|holdcmd|等跑)[:：\s]+(\S.*)$/;

/** 行首「等跑 / HOLDCMD」+ 命令:持球,并由平台在沙箱跑。 */
export function parseHoldCommand(text: string): string | null {
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  for (const line of stripped.split('\n')) {
    const match = line.match(HOLD_COMMAND_LINE);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

/** 行首「等 / HOLD」+ 原因是持球出口,不是掉地上,也不是升级给人。「等跑」也算持球。 */
export function parseHoldExit(text: string): string | null {
  const command = parseHoldCommand(text);
  if (command) return `跑 \`${clipBody(command, 60)}\``;
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  for (const line of stripped.split('\n')) {
    const match = line.match(HOLD_LINE);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function formatHoldCommandDoneNote(input: {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): string {
  const cmd = clipBody(input.command, 60);
  const head = input.timedOut
    ? `跑完: \`${cmd}\` 超时`
    : `跑完: \`${cmd}\` 退出 ${input.exitCode ?? '?'}`;
  return [head, tailBlock('stdout', input.stdout), tailBlock('stderr', input.stderr)]
    .filter(Boolean)
    .join('\n');
}

/** 半截助手消息:进程死在这一跳没写完。 */
export function formatHopInterruptedNote(): string {
  return '平台重启,这一跳没写完';
}

/** 开机/收尸捡到等跑 hop:命令不重跑,只告诉人/猫平台重启了。 */
export function formatHoldCommandRestartNote(command: string): string {
  const cmd = clipBody(command, 60);
  return `平台重启,等跑 \`${cmd}\` 没跑完。同一只猫被叫醒后自己决定要不要再跑。`;
}

/** 叫醒同一只:命令没跑完,由它决定要不要再开。 */
export function formatHoldCommandRestartWakePrompt(input: {
  command: string;
  previousOutput: string;
}): string {
  return [
    '【命令中断】平台重启,你写下的等跑命令没有跑完。自己决定要不要再跑。要交棒就行首 @。',
    `命令: ${input.command}`,
    '上一棒原话:',
    clipBody(input.previousOutput),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatHoldCommandWakePrompt(input: {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  previousOutput: string;
}): string {
  const status = input.timedOut ? '超时' : `退出 ${input.exitCode ?? '?'}`;
  return [
    '【命令跑完】平台已在沙箱跑完你写下的命令。根据结果继续。要交棒就行首 @。',
    `命令: ${input.command}`,
    `结果: ${status}`,
    tailBlock('stdout', input.stdout),
    tailBlock('stderr', input.stderr),
    '上一棒原话:',
    clipBody(input.previousOutput),
  ]
    .filter(Boolean)
    .join('\n');
}

function tailBlock(label: string, text: string): string {
  const tail = clipTail(text, 4000);
  return tail ? `${label}:\n${tail}` : '';
}

function clipTail(text: string, max: number): string {
  const trimmed = text.replace(/\s+$/u, '');
  if (!trimmed) return '';
  if (trimmed.length <= max) return trimmed;
  return `…${trimmed.slice(-max)}`;
}

export function formatHoldBallNote(speakerName: string, reason?: string): string {
  const detail = reason?.trim() ? ` — ${clipBody(reason.trim(), 60)}` : '';
  return `⏳ 球在等:${speakerName}${detail}。人开口即取消。`;
}

export function isHoldBallNote(text: string): boolean {
  return text.includes('球在等') && text.includes('人开口即取消');
}

export interface DroppedBallInput {
  stop: A2AStopKind;
  lastContent: string;
  speakerName: string;
  role?: string;
  wasRelay: boolean;
  hadInlineHint?: boolean;
  blockedTargetName?: string;
}

/** 链停了但球没落地时给人看的一句;问答收尾和审查官明确结论不提示。 */
export function formatDroppedBallNote(input: DroppedBallInput): string | null {
  const reviewer = Boolean(input.role?.includes('审查'));
  if (reviewer && hasExplicitReviewVerdict(input.lastContent)) return null;
  if (parseHoldExit(input.lastContent) || parseHoldCommand(input.lastContent)) return null;
  if (input.hadInlineHint) return null;
  if (input.stop === 'escalated' || input.stop === 'held') return null;
  if (input.stop === 'blocked') {
    const to = input.blockedTargetName ?? '下一棒';
    return `⚠️ 球还在地上:${input.speakerName}想交给${to},但这只猫本轮已经出场或不可用,接力已停。`;
  }
  if (input.stop === 'reviewer-closeout' || input.wasRelay) {
    return `⚠️ 球还在地上:${input.speakerName}停棒了,但没有行首交给下一棒。需要对方动手时,另起一行 @名字 再跟任务。`;
  }
  return null;
}

export function isDroppedBallNote(text: string): boolean {
  return text.includes('球还在地上');
}

export function formatEscalatedBallNote(speakerName: string, task?: string): string {
  const detail = task?.trim() && task.trim() !== '请拍板' ? ` — ${clipBody(task.trim(), 60)}` : '';
  return `📋 球在人手里:${speakerName}请求拍板${detail}`;
}

export function isEscalatedBallNote(text: string): boolean {
  return text.includes('球在人手里') && text.includes('请求拍板');
}

export function formatFreezeBallNote(): string {
  return '🛑 已拉闸:星星罐子。球在人手里,等你开口。';
}

export function isFreezeBallNote(text: string): boolean {
  return text.includes('已拉闸') && text.includes('星星罐子');
}

export function formatAbortedBallNote(): string {
  return '⚠️ 本轮已中止。球还在地上:点下面交给下一只,或自己说。';
}

export function formatFailedBallNote(): string {
  return '⚠️ 本轮失败。球还在地上:点下面交给下一只,或自己说。';
}

/** 人捡球:发出去就会走现有 @ 路由。 */
export function formatPickupCommand(agentName: string): string {
  const name = agentName.replace(/^@/, '').trim();
  return `@${name} 接着做`;
}

export interface ExitNudgeInput {
  wasRelay: boolean;
  hadInlineHint: boolean;
  isReviewer: boolean;
  hasExplicitVerdict: boolean;
  hasDiff: boolean;
  hasHold?: boolean;
}

/** 该交棒却没出口时,再问同一只;问答收尾、已写结论、持球不问。 */
export function shouldNudgeExit(input: ExitNudgeInput): boolean {
  if (input.hasHold) return false;
  if (input.hasExplicitVerdict) return false;
  if (input.wasRelay) return true;
  if (input.hadInlineHint) return true;
  if (input.hasDiff) return true;
  if (input.isReviewer) return true;
  return false;
}

export function formatExitNudgeNote(speakerName: string): string {
  return `📬 出口未明:${speakerName}停棒了但没有行首交给下一棒或 @人。平台再问一次。`;
}

export function isExitNudgeNote(text: string): boolean {
  return text.includes('出口未明') && text.includes('再问一次');
}

export function formatExitNudgePrompt(input: {
  previousOutput: string;
  handoffName?: string;
  isReviewer: boolean;
}): string {
  const next = input.handoffName ? `@${input.handoffName}` : '@下一只';
  const closeout = input.isReviewer
    ? '审查官:写出「通过」或「需修改」即停,不要再 @。或行首 @人 升级。'
      : `三选一:接(做完再行首 ${next} 跟任务)/退(另起一行 ${next} 跟任务)/升(行首 @人 写要拍板的事)/持(行首 等 原因,或 等跑 命令)。不要问人要不要继续。`;
  return [
    '【出口补问】上一棒没有行首交给下一只,也没有 @人。平台只再问一次,不替你选下一棒。',
    closeout,
    '上一棒原话:',
    clipBody(input.previousOutput),
  ].join('\n');
}
