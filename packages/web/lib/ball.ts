import { extractConclusion, PASS_RE, REVISE_RE } from './review-conclusion';

export type BallTone = 'cat' | 'human' | 'ground' | 'busy';

export interface BallView {
  text: string;
  tone: BallTone;
  agentId?: string;
}

export interface BallMessage {
  role: string;
  agentId?: string;
  content: string;
  status?: string;
  systemKind?: string;
  systemMeta?: { from?: string; to?: string };
}

/** 线程顶常驻:球在谁手上。只读消息,不改路由。 */
function withQueuedHint(
  view: BallView,
  queuedCount?: number,
  inboundCount?: number,
): BallView {
  const bits: string[] = [];
  if (queuedCount && queuedCount > 0) bits.push(`后面还有 ${queuedCount} 棒`);
  if (inboundCount && inboundCount > 0) bits.push(`还有 ${inboundCount} 句在等`);
  if (bits.length === 0) return view;
  return { ...view, text: `${view.text} · ${bits.join(' · ')}` };
}

export function describeBall(
  messages: readonly BallMessage[],
  sending: boolean,
  nameOf: (agentId?: string) => string,
  roleOf?: (agentId?: string) => string | undefined,
  queuedCount?: number,
  inboundCount?: number,
): BallView {
  if (sending) {
    const streaming = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.status === 'streaming' && m.agentId);
    if (streaming?.agentId) {
      return withQueuedHint(
        {
          text: `球在${nameOf(streaming.agentId)}手上`,
          tone: 'busy',
          agentId: streaming.agentId,
        },
        queuedCount,
        inboundCount,
      );
    }
    return withQueuedHint({ text: '球已抛出，猫们正在接…', tone: 'busy' }, queuedCount, inboundCount);
  }

  // 对齐 clowder:句中 @ 的系统提示不算出口,从后往前找最后有意义的一条
  for (const last of [...messages].reverse()) {
    if (!last.content?.trim()) continue;
    if (last.role === 'system' && isRoutingHintMessage(last)) continue;
    if (last.role === 'system' && last.systemKind === 'git-move') continue;
    if (last.role === 'system' && last.systemKind === 'pr-opened') continue;
    if (last.role === 'system' && last.systemKind === 'pr-review') continue;
    if (last.role === 'system' && last.systemKind === 'pr-ci') continue;
    if (last.role === 'system' && last.systemKind === 'git-overstep') {
      return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && last.systemKind === 'pr-merged') {
      return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'user' && last.content.trim().startsWith('#')) continue;

    if (last.role === 'system' && isDroppedBallNote(last)) {
      return withQueuedHint({ text: last.content.replace(/^⚠️\s*/, ''), tone: 'ground' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isRelayBallNote(last)) {
      const toId = last.systemMeta?.to;
      const to = toId ? nameOf(toId) : hopTargetName(last.content);
      return withQueuedHint(
        { text: to ? `球在${to}手上` : '接力中', tone: 'cat', ...(toId ? { agentId: toId } : {}) },
        queuedCount,
        inboundCount,
      );
    }
    if (last.role === 'system' && isAppliedApprovalMessage(last)) {
      return withQueuedHint({ text: '已落地，等人开口', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isApprovalFailedMessage(last)) {
      return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isPendingApprovalMessage(last)) {
      return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isFreezeBallMessage(last)) {
      return withQueuedHint({ text: '已拉闸，等人开口', tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isEscalatedBallMessage(last)) {
      return withQueuedHint({ text: last.content.replace(/^📋\s*/, ''), tone: 'human' }, queuedCount, inboundCount);
    }
    if (last.role === 'system' && isHoldBallMessage(last)) {
      return withQueuedHint(
        { text: last.content.replace(/^⏳\s*/, '').replace(/。人开口即取消。$/, ''), tone: 'cat' },
        queuedCount,
        inboundCount,
      );
    }
    if (last.role === 'assistant' && last.agentId) {
      if (last.status !== 'streaming' && isReviewerRole(roleOf?.(last.agentId))) {
        const verdict = parseReviewCloseout(last.content);
        if (verdict === 'pass') {
          return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
        }
        if (verdict === 'revise') {
          const writerId = findWriterId(messages, last.agentId, roleOf);
          if (writerId) {
            return withQueuedHint(
              { text: `球在${nameOf(writerId)}手上`, tone: 'cat', agentId: writerId },
              queuedCount,
              inboundCount,
            );
          }
        }
      }
      return withQueuedHint(
        {
          text: `球在${nameOf(last.agentId)}手上`,
          tone: 'cat',
          agentId: last.agentId,
        },
        queuedCount,
        inboundCount,
      );
    }
    if (last.role === 'user') {
      return withQueuedHint({ text: '球在人手里', tone: 'human' }, queuedCount, inboundCount);
    }
  }
  return withQueuedHint({ text: '等人开口', tone: 'human' }, queuedCount, inboundCount);
}

type Kinded = Pick<BallMessage, 'content' | 'systemKind'>;

export function isDroppedBallNote(source: string | Kinded): boolean {
  if (typeof source === 'string') return source.includes('球还在地上');
  if (
    source.systemKind === 'dropped' ||
    source.systemKind === 'aborted' ||
    source.systemKind === 'failed'
  ) {
    return true;
  }
  return source.content.includes('球还在地上');
}

export function isEscalatedBallNote(text: string): boolean {
  return text.includes('球在人手里') && text.includes('请求拍板');
}

export function isFreezeBallNote(text: string): boolean {
  return text.includes('已拉闸') && text.includes('星星罐子');
}

export function isHoldBallNote(text: string): boolean {
  return text.includes('球在等') && text.includes('人开口即取消');
}

/** 审批卡等人点批准/打回,还没自动落地。 */
export function isPendingApprovalNote(text: string): boolean {
  return text.includes('审批卡片') && !text.includes('已自动批准') && !text.includes('已批准并落地');
}

function isAppliedApprovalNote(text: string): boolean {
  return text.includes('已批准并落地') || text.includes('已自动批准');
}

function isRoutingHintMessage(message: Kinded): boolean {
  return message.systemKind === 'routing-hint' || message.content.includes('写在句中不会交接');
}

function isRelayBallNote(message: Kinded): boolean {
  if (message.systemKind === 'relay') return true;
  return message.content.includes('接力:') || message.content.includes('打回:');
}

function isAppliedApprovalMessage(message: Kinded): boolean {
  return message.systemKind === 'approval-applied' || isAppliedApprovalNote(message.content);
}

function isPendingApprovalMessage(message: Kinded): boolean {
  return message.systemKind === 'approval-pending' || isPendingApprovalNote(message.content);
}

function isApprovalFailedMessage(message: Kinded): boolean {
  if (message.systemKind === 'approval-failed') return true;
  return message.content.includes('批准记下了') && message.content.includes('提交失败');
}

function isFreezeBallMessage(message: Kinded): boolean {
  return message.systemKind === 'freeze' || isFreezeBallNote(message.content);
}

function isEscalatedBallMessage(message: Kinded): boolean {
  return message.systemKind === 'escalated' || isEscalatedBallNote(message.content);
}

function isHoldBallMessage(message: Kinded): boolean {
  return message.systemKind === 'hold' || isHoldBallNote(message.content);
}

/** 时间线只跟「下一棒」,打回不另开一跳(和改造前一致)。 */
function isForwardRelayMessage(message: Kinded): boolean {
  if (message.systemKind === 'relay') return !message.content.includes('打回:');
  return message.content.includes('接力:');
}

function isReviewerRole(role?: string): boolean {
  return Boolean(role?.includes('审查'));
}

/** 和 shared parseReviewVerdict 同关键词,避免 web 再依赖 shared。没写出结论则 null。 */
function parseReviewCloseout(text: string): 'pass' | 'revise' | null {
  const source = extractConclusion(text) ?? text;
  const reviseIdx = source.search(REVISE_RE);
  const passIdx = source.search(PASS_RE);
  if (reviseIdx < 0 && passIdx < 0) return null;
  if (reviseIdx >= 0 && (passIdx < 0 || reviseIdx <= passIdx)) return 'revise';
  return 'pass';
}

function findWriterId(
  messages: readonly BallMessage[],
  reviewerId: string,
  roleOf?: (agentId?: string) => string | undefined,
): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant' || !message.agentId) continue;
    if (message.agentId === reviewerId) continue;
    if (isReviewerRole(roleOf?.(message.agentId))) continue;
    return message.agentId;
  }
  return undefined;
}

export function formatPickupCommand(agentName: string): string {
  return `@${agentName.replace(/^@/, '').trim()} 接着做`;
}

/** 只读接力/打回条第一行的「→ 下一棒」,避免交接包正文糊进时间线。 */
function hopTargetName(content: string): string | undefined {
  const headline = content.split('\n')[0] ?? '';
  if (!headline.includes('接力:') && !headline.includes('打回:')) return undefined;
  return headline.split('→').pop()?.trim() || undefined;
}

function relayTargetName(content: string): string | undefined {
  const headline = content.split('\n')[0] ?? '';
  if (!headline.includes('接力:')) return undefined;
  return headline.split('→').pop()?.trim() || undefined;
}

export type RelayHopStatus = 'done' | 'active' | 'failed' | 'dropped';

export interface RelayHop {
  name: string;
  agentId?: string;
  status: RelayHopStatus;
}

/** 从消息还原本轮接力链,只读,不改路由。 */
export function describeRelayTimeline(
  messages: readonly BallMessage[],
  sending: boolean,
  nameOf: (agentId?: string) => string,
): RelayHop[] {
  const hops: RelayHop[] = [];

  const touch = (name: string, status: RelayHopStatus, agentId?: string) => {
    const last = hops[hops.length - 1];
    if (last && (last.name === name || (agentId && last.agentId === agentId))) {
      last.status = status;
      if (agentId) last.agentId = agentId;
      return;
    }
    hops.push({ name, ...(agentId ? { agentId } : {}), status });
  };

  for (const message of messages) {
    if (message.role === 'assistant' && message.agentId) {
      const status: RelayHopStatus =
        message.status === 'failed' || message.status === 'terminated'
          ? 'failed'
          : message.status === 'streaming'
            ? 'active'
            : 'done';
      touch(nameOf(message.agentId), status, message.agentId);
      continue;
    }
    if (message.role === 'system' && isForwardRelayMessage(message)) {
      const toId = message.systemMeta?.to;
      if (toId) {
        touch(nameOf(toId), 'active', toId);
      } else {
        const to = relayTargetName(message.content);
        if (to) touch(to, 'active');
      }
      continue;
    }
    if (message.role === 'system' && isDroppedBallNote(message)) {
      const last = hops[hops.length - 1];
      if (last && last.status === 'done') last.status = 'dropped';
    }
  }

  if (sending) {
    const last = hops[hops.length - 1];
    if (last && last.status !== 'failed') last.status = 'active';
  }

  return hops;
}
