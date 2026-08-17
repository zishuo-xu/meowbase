import type { AgentId } from './types.js';
import {
  DEFAULT_CATALOG,
  MENTION_TOKEN_RE,
  type MentionCatalog,
  resolveAlias,
} from './catalog.js';
import { hasExplicitReviewVerdict } from './review-verdict.js';

export interface A2AHandoff {
  target: AgentId;
  task: string;
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
    const target = resolveAlias(match[1] ?? '', catalog);
    if (!target || target === currentAgentId) continue;
    const rest = lines
      .slice(i + 1)
      .filter((l) => !LINE_START_ANY.test(l))
      .join('\n')
      .trim();
    const task = [match[2]?.trim(), rest].filter(Boolean).join('\n').trim();
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

export interface A2AHandoffExtras {
  goal?: string;
  files?: string[];
  closeout?: 'reviewer' | 'default';
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
      ? '结论必须单独写明「通过」或「需修改」。写完结论即停:不要问人要不要继续,不要再 @ 任何人。需修改由平台打回写手。'
      : '做完按交接条目交下一棒。接(能干就干)/退(行首 @ 对的那只)/升(要人拍板就停)。不要问人要不要继续。';
  return [
    `【A2A 交接包】`,
    `来自: ${fromName} (@${fromId})`,
    extras.goal ? `用户目标: ${extras.goal}` : undefined,
    files.length > 0 ? `改动文件: ${files.join(', ')}` : undefined,
    `沙箱: 只使用当前工作目录的相对路径,不要审或改平台仓库里的 packages/。`,
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

export type A2AStopKind = 'no-handoff' | 'reviewer-closeout' | 'blocked';

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
  if (input.stop === 'blocked') {
    const to = input.blockedTargetName ?? '下一棒';
    return `⚠️ 球还在地上:${input.speakerName}想交给${to},但这只猫本轮已经出场或不可用,接力已停。`;
  }
  if (input.stop === 'reviewer-closeout' || input.wasRelay) {
    return `⚠️ 球还在地上:${input.speakerName}停棒了,但没有行首交给下一棒。需要对方动手时,另起一行 @名字 再跟任务。`;
  }
  return null;
}
