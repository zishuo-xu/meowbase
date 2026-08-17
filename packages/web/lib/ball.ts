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

  const last = [...messages].reverse().find((m) => m.content?.trim());
  if (last?.role === 'system' && last.content.includes('球还在地上')) {
    return { text: last.content.replace(/^⚠️\s*/, ''), tone: 'ground' };
  }
  if (last?.role === 'system' && last.content.includes('接力:')) {
    const to = last.content.split('→').pop()?.trim();
    return { text: to ? `球在${to}手上` : '接力中', tone: 'cat' };
  }
  if (last?.role === 'assistant' && last.agentId) {
    return {
      text: `球在${nameOf(last.agentId)}手上`,
      tone: 'cat',
      agentId: last.agentId,
    };
  }
  if (last?.role === 'user') {
    return { text: '球在人手里', tone: 'human' };
  }
  return { text: '等人开口', tone: 'human' };
}

export function isDroppedBallNote(text: string): boolean {
  return text.includes('球还在地上');
}

export function formatPickupCommand(agentName: string): string {
  return `@${agentName.replace(/^@/, '').trim()} 接着做`;
}
