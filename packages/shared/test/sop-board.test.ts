import { describe, expect, it } from 'vitest';
import { deriveSopBoard, formatSopBoardPrompt } from '../src/sop-board.js';

describe('deriveSopBoard', () => {
  it('空线程是 idle', () => {
    expect(deriveSopBoard({})).toEqual({ stage: 'idle', note: '等人开口。' });
  });

  it('槽里有棒且上一跳不是审查官:reviewing', () => {
    const board = deriveSopBoard({
      pendingHopTo: 'gemini',
      lastAssistantId: 'claude',
      lastAssistantIsReviewer: false,
      lastSystemKind: 'relay',
    });
    expect(board.stage).toBe('reviewing');
    expect(board.holder).toBe('gemini');
    expect(board.note).toContain('审查官');
  });

  it('写手刚开口、没有待审棒:doing', () => {
    const board = deriveSopBoard({ lastAssistantId: 'claude', lastAssistantIsReviewer: false });
    expect(board.stage).toBe('doing');
    expect(board.holder).toBe('claude');
  });

  it('审查官写出结论:human', () => {
    expect(deriveSopBoard({ lastAssistantId: 'gemini', lastAssistantIsReviewer: true }).stage).toBe(
      'human',
    );
  });

  it('持球:waiting', () => {
    const board = deriveSopBoard({ holding: true, lastAssistantId: 'claude' });
    expect(board.stage).toBe('waiting');
    expect(board.holder).toBe('claude');
  });

  it('审批卡或拉闸:human', () => {
    expect(deriveSopBoard({ lastSystemKind: 'approval-pending' }).stage).toBe('human');
    expect(deriveSopBoard({ lastSystemKind: 'freeze' }).stage).toBe('human');
  });
});

describe('formatSopBoardPrompt', () => {
  it('标明告示不是命令,带阶段和说明', () => {
    const text = formatSopBoardPrompt({
      stage: 'reviewing',
      holder: 'gemini',
      note: '审查官在看。写出通过或需修改即停,不要再 @ 别人。',
    });
    expect(text).toContain('不是命令');
    expect(text).toContain('阶段:reviewing');
    expect(text).toContain('持球:gemini');
    expect(text).toContain('审查官在看');
  });
});
