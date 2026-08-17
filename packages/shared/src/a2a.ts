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
      : '做完按交接条目交下一棒。交棒前尽量附上本轮命令和结果;没有证据也可以交,但下一棒不能当通过。接(能干就干)/退(行首 @ 对的那只)/升(行首 @人 或 @owner)。不要问人要不要继续。';
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

export type A2AStopKind = 'no-handoff' | 'reviewer-closeout' | 'blocked' | 'escalated';

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
  if (input.hadInlineHint) return null;
  if (input.stop === 'escalated') return null;
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
