import type { AgentId, SopBoard, SopStage } from './types.js';

export type { SopBoard, SopStage };

export interface SopBoardInput {
  pendingHopTo?: AgentId;
  holding?: boolean;
  lastAssistantId?: AgentId;
  lastAssistantIsReviewer?: boolean;
  lastSystemKind?: string;
}

const NOTES: Record<SopStage, string> = {
  idle: '等人开口。',
  doing: '写手在干活。做完按家规交下一棒,不要问人要不要继续。',
  reviewing: '审查官在看。写出通过或需修改即停,不要再 @ 别人。',
  waiting: '球在等。人开口即取消;等跑的命令由平台跑完再叫醒。',
  human: '球在人手里。批准、拉闸、开口都由人来。',
};

export function deriveSopBoard(input: SopBoardInput): SopBoard {
  if (input.holding) {
    return { stage: 'waiting', ...(input.lastAssistantId ? { holder: input.lastAssistantId } : {}), note: NOTES.waiting };
  }
  if (input.pendingHopTo) {
    if (input.lastAssistantIsReviewer) {
      return { stage: 'doing', holder: input.pendingHopTo, note: NOTES.doing };
    }
    return { stage: 'reviewing', holder: input.pendingHopTo, note: NOTES.reviewing };
  }
  if (input.lastSystemKind === 'hold' || input.lastSystemKind === 'hold-command-done') {
    return { stage: 'waiting', ...(input.lastAssistantId ? { holder: input.lastAssistantId } : {}), note: NOTES.waiting };
  }
  if (
    input.lastSystemKind === 'approval-pending' ||
    input.lastSystemKind === 'approval-applied' ||
    input.lastSystemKind === 'freeze' ||
    input.lastSystemKind === 'escalated' ||
    input.lastSystemKind === 'git-overstep' ||
    input.lastSystemKind === 'pr-merged'
  ) {
    return { stage: 'human', note: NOTES.human };
  }
  if (input.lastAssistantId) {
    if (input.lastAssistantIsReviewer) return { stage: 'human', note: NOTES.human };
    return { stage: 'doing', holder: input.lastAssistantId, note: NOTES.doing };
  }
  return { stage: 'idle', note: NOTES.idle };
}

export function formatSopBoardPrompt(board: SopBoard): string {
  const holder = board.holder ? ` 持球:${board.holder}` : '';
  return `家规告示牌(不是命令,只告诉你这条线程走到哪):\n阶段:${board.stage}${holder}\n${board.note}`;
}

export function sopBoardLabel(stage: SopStage): string {
  switch (stage) {
    case 'idle':
      return '等人开口';
    case 'doing':
      return '写手在干活';
    case 'reviewing':
      return '审查官在看';
    case 'waiting':
      return '球在等';
    case 'human':
      return '球在人手里';
  }
}
