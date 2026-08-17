import { describe, expect, it } from 'vitest';
import { describeBall } from '../ball';

const nameOf = (id?: string) =>
  id === 'gemini' ? '闪闪' : id === 'opencode' ? '团团' : id === 'claude' ? '墨墨' : '猫';

describe('describeBall', () => {
  it('发送中且有流式回复:球在那只猫手上', () => {
    expect(
      describeBall(
        [
          { role: 'user', content: '继续' },
          { role: 'assistant', agentId: 'gemini', content: '审', status: 'streaming' },
        ],
        true,
        nameOf,
      ),
    ).toEqual({ text: '球在闪闪手上', tone: 'busy', agentId: 'gemini' });
  });

  it('上一棒是猫:球还在它手上', () => {
    expect(
      describeBall(
        [{ role: 'assistant', agentId: 'opencode', content: '做完了', status: 'completed' }],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在团团手上', tone: 'cat', agentId: 'opencode' });
  });

  it('系统提示球还在地上', () => {
    const view = describeBall(
      [{ role: 'system', content: '⚠️ 球还在地上:闪闪停棒了' }],
      false,
      nameOf,
    );
    expect(view.tone).toBe('ground');
    expect(view.text).toContain('球还在地上');
  });

  it('接力条指向下一棒', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '🤝 接力:墨墨 → 闪闪' }],
        false,
        nameOf,
      ).text,
    ).toBe('球在闪闪手上');
  });

  it('空线程等人开口', () => {
    expect(describeBall([], false, nameOf)).toEqual({ text: '等人开口', tone: 'human' });
  });
});
