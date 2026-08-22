import { describe, expect, it } from 'vitest';
import { parseRelayNote } from '../relay-note';

describe('parseRelayNote', () => {
  it('原文接力条拆出标题和详情', () => {
    expect(
      parseRelayNote({
        content: '🤝 接力:墨墨 → 闪闪\n用户目标: 写 add.ts\n任务: 请审查',
      }),
    ).toEqual({
      headline: '🤝 接力:墨墨 → 闪闪',
      details: ['用户目标: 写 add.ts', '任务: 请审查'],
    });
  });

  it('git-move 不当交接包', () => {
    expect(
      parseRelayNote({
        content: '墨墨 在 `meow/xxx` 上提交了 1 个 commit',
        systemKind: 'git-move',
      }),
    ).toBeNull();
  });

  it('有 relay kind 时改掉第一行仍当交接包', () => {
    expect(
      parseRelayNote({
        content: '下一棒是闪闪\n用户目标: 写 add.ts\n任务: 请审查',
        systemKind: 'relay',
      }),
    ).toEqual({
      headline: '下一棒是闪闪',
      details: ['用户目标: 写 add.ts', '任务: 请审查'],
    });
  });
});
