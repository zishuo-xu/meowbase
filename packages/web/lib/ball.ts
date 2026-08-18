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
}

/** 线程顶常驻:球在谁手上。只读消息,不改路由。 */
export function describeBall(
  messages: readonly BallMessage[],
  sending: boolean,
  nameOf: (agentId?: string) => string,
  roleOf?: (agentId?: string) => string | undefined,
): BallView {
  if (sending) {
    const streaming = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.status === 'streaming' && m.agentId);
    if (streaming?.agentId) {
      return {
        text: `球在${nameOf(streaming.agentId)}手上`,
        tone: 'busy',
        agentId: streaming.agentId,
      };
    }
    return { text: '球已抛出，猫们正在接…', tone: 'busy' };
  }

  // 对齐 clowder:句中 @ 的系统提示不算出口,从后往前找最后有意义的一条
  for (const last of [...messages].reverse()) {
    if (!last.content?.trim()) continue;
    if (last.role === 'system' && isRoutingHint(last.content)) continue;
    if (last.role === 'user' && last.content.trim().startsWith('#')) continue;

    if (last.role === 'system' && last.content.includes('球还在地上')) {
      return { text: last.content.replace(/^⚠️\s*/, ''), tone: 'ground' };
    }
    if (last.role === 'system' && (last.content.includes('接力:') || last.content.includes('打回:'))) {
      const to = hopTargetName(last.content);
      return { text: to ? `球在${to}手上` : '接力中', tone: 'cat' };
    }
    if (last.role === 'system' && isAppliedApprovalNote(last.content)) {
      return { text: '已落地，等人开口', tone: 'human' };
    }
    if (last.role === 'system' && isPendingApprovalNote(last.content)) {
      return { text: '球在人手里', tone: 'human' };
    }
    if (last.role === 'system' && isFreezeBallNote(last.content)) {
      return { text: '已拉闸，等人开口', tone: 'human' };
    }
    if (last.role === 'system' && isEscalatedBallNote(last.content)) {
      return { text: last.content.replace(/^📋\s*/, ''), tone: 'human' };
    }
    if (last.role === 'system' && isHoldBallNote(last.content)) {
      return { text: last.content.replace(/^⏳\s*/, '').replace(/。人开口即取消。$/, ''), tone: 'cat' };
    }
    if (last.role === 'assistant' && last.agentId) {
      if (last.status !== 'streaming' && isReviewerRole(roleOf?.(last.agentId))) {
        const verdict = parseReviewCloseout(last.content);
        if (verdict === 'pass') {
          return { text: '球在人手里', tone: 'human' };
        }
        if (verdict === 'revise') {
          const writerId = findWriterId(messages, last.agentId, roleOf);
          if (writerId) {
            return { text: `球在${nameOf(writerId)}手上`, tone: 'cat', agentId: writerId };
          }
        }
      }
      return {
        text: `球在${nameOf(last.agentId)}手上`,
        tone: 'cat',
        agentId: last.agentId,
      };
    }
    if (last.role === 'user') {
      return { text: '球在人手里', tone: 'human' };
    }
  }
  return { text: '等人开口', tone: 'human' };
}

export function isDroppedBallNote(text: string): boolean {
  return text.includes('球还在地上');
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

/** 句中 @ 提示(对齐 clowder F064):给人看用法,不算球在谁手上。 */
function isRoutingHint(text: string): boolean {
  return text.includes('写在句中不会交接');
}

function isReviewerRole(role?: string): boolean {
  return Boolean(role?.includes('审查'));
}

const REVIEW_REVISE_RE = /需修改|不通过|未通过|请修复|CHANGES_REQUESTED|request changes/i;
const REVIEW_PASS_RE = /通过|LGTM|可以合入|APPROVED/i;

/** 和 shared parseReviewVerdict 同关键词,避免 web 再依赖 shared。没写出结论则 null。 */
function parseReviewCloseout(text: string): 'pass' | 'revise' | null {
  const heading = text.match(/(?:^|\n)#{1,3}\s*结论\s*[:：]?\s*\n?([\s\S]*)$/);
  const inline = text.match(/结论\s*[:：]\s*([^\n]+)/);
  const source = heading?.[1]?.trim() || inline?.[1]?.trim() || text;
  const reviseIdx = source.search(REVIEW_REVISE_RE);
  const passIdx = source.search(REVIEW_PASS_RE);
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
    if (message.role === 'system' && message.content.includes('接力:')) {
      const to = relayTargetName(message.content);
      if (to) touch(to, 'active');
      continue;
    }
    if (message.role === 'system' && message.content.includes('球还在地上')) {
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
