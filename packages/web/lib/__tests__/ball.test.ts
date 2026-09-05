import { describe, expect, it } from 'vitest';
import { describeBall, describeRelayTimeline, formatPickupCommand, isDroppedBallNote } from '../ball';

const nameOf = (id?: string) =>
  id === 'gemini' ? '闪闪' : id === 'opencode' ? '团团' : id === 'claude' ? '墨墨' : '猫';
const roleOf = (id?: string) =>
  id === 'gemini' ? '审查官' : id === 'claude' ? '主架构师' : '执行者';

describe('describeBall', () => {
  it('审查官审查结论标题+文末结论通过:球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了\n@闪闪 请审查', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          {
            role: 'assistant',
            agentId: 'gemini',
            content: `审查结论:

**问题列表**
- 无阻塞问题。

**建议**
- 可选:...

**验证**
- 亲手运行 \`npm test\` → tests 4 / pass 4 / fail 0

**结论:通过**。改动与任务一致,无需修改。`,
            status: 'completed',
          },
        ],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('审查官写出结论、卡片还没到:球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了\n@闪闪 请审查', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          { role: 'assistant', agentId: 'gemini', content: '## 结论\n通过', status: 'completed' },
        ],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('执行者口头通过不把球给人', () => {
    expect(
      describeBall(
        [{ role: 'assistant', agentId: 'opencode', content: '做好了。通过', status: 'completed' }],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在团团手上', tone: 'cat', agentId: 'opencode' });
  });

  it('审查官写出需修改、还没打回:球在写手手上', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了\n@闪闪 请审查', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          { role: 'assistant', agentId: 'gemini', content: '## 结论\n需修改', status: 'completed' },
        ],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在墨墨手上', tone: 'cat', agentId: 'claude' });
  });

  it('打回条指向写手', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          { role: 'assistant', agentId: 'gemini', content: '## 结论\n需修改', status: 'completed' },
          { role: 'system', content: '🤝 打回:闪闪 → 墨墨' },
        ],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在墨墨手上', tone: 'cat' });
  });

  it('互审仍需修改、卡片已出:球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'gemini', content: '## 结论\n需修改', status: 'completed' },
          {
            role: 'system',
            content:
              '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:gemini)\n改动:add.ts | 9 +\n审查意见:需修改\n互审后仍需修改，请你决定是否落地。\n回复 #approve ap_a1b2c3d4 批准',
          },
        ],
        false,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('审查官还在流式:球仍在它手上', () => {
    expect(
      describeBall(
        [{ role: 'assistant', agentId: 'gemini', content: '结论:通过', status: 'streaming' }],
        true,
        nameOf,
        roleOf,
      ),
    ).toEqual({ text: '球在闪闪手上', tone: 'busy', agentId: 'gemini' });
  });

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

  it('多行交接包只读第一行的下一棒,不把摘要糊进名字', () => {
    const packet =
      '🤝 接力:墨墨 → 闪闪\n用户目标: 写 add.ts\n验证: 未附带,下一棒需自跑\n任务: 请审查';
    expect(describeBall([{ role: 'system', content: packet }], false, nameOf).text).toBe(
      '球在闪闪手上',
    );
    expect(
      describeRelayTimeline(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          { role: 'system', content: packet },
          { role: 'assistant', agentId: 'gemini', content: '通过', status: 'completed' },
        ],
        false,
        nameOf,
      ),
    ).toEqual([
      { name: '墨墨', agentId: 'claude', status: 'done' },
      { name: '闪闪', agentId: 'gemini', status: 'done' },
    ]);
  });

  it('空线程等人开口', () => {
    expect(describeBall([], false, nameOf)).toEqual({ text: '等人开口', tone: 'human' });
  });

  it('队里有货时顶栏同一行跟后面还有 N 棒', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '🤝 接力:墨墨 → 闪闪', systemKind: 'relay', systemMeta: { to: 'gemini' } }],
        false,
        nameOf,
        roleOf,
        1,
      ),
    ).toEqual({ text: '球在闪闪手上 · 后面还有 1 棒', tone: 'cat', agentId: 'gemini' });
  });

  it('空队不加后面还有', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '🤝 接力:墨墨 → 闪闪', systemKind: 'relay', systemMeta: { to: 'gemini' } }],
        false,
        nameOf,
        roleOf,
        0,
      ),
    ).toEqual({ text: '球在闪闪手上', tone: 'cat', agentId: 'gemini' });
  });

  it('人话队非空时顶栏同一行跟还有 N 句在等', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '🤝 接力:墨墨 → 闪闪', systemKind: 'relay', systemMeta: { to: 'gemini' } }],
        false,
        nameOf,
        roleOf,
        0,
        1,
      ),
    ).toEqual({ text: '球在闪闪手上 · 还有 1 句在等', tone: 'cat', agentId: 'gemini' });
  });

  it('升级后即使有句中@提示,顶栏仍是球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '@人 选A还是选B', status: 'completed' },
          { role: 'system', content: '📋 球在人手里:墨墨请求拍板 — 选A还是选B' },
          { role: 'system', content: '💡 @人 写在句中不会交接 — 请另起一行、行首写 @名字 再跟任务' },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里:墨墨请求拍板 — 选A还是选B', tone: 'human' });
  });

  it('持球系统句:顶栏球在等', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '等 测试跑完', status: 'completed' },
          { role: 'system', content: '⏳ 球在等:墨墨 — 测试跑完。人开口即取消。' },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在等:墨墨 — 测试跑完', tone: 'cat' });
  });

  it('星星罐子拉闸后等人开口', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '先改一版', status: 'completed' },
          { role: 'system', content: '🛑 已拉闸:星星罐子。球在人手里,等你开口。' },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '已拉闸，等人开口', tone: 'human' });
  });

  it('猫行首 @人 升级:球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '@人 做不做', status: 'completed' },
          { role: 'system', content: '📋 球在人手里:墨墨请求拍板 — 做不做' },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里:墨墨请求拍板 — 做不做', tone: 'human' });
  });

  it('待确认的审批卡:球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'gemini', content: '结论:通过', status: 'completed' },
          {
            role: 'system',
            content:
              '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:gemini)\n改动:add.ts | 9 +\n审查意见:通过\n回复 #approve ap_a1b2c3d4 批准',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('已自动批准后已落地等人开口', () => {
    expect(
      describeBall(
        [
          {
            role: 'system',
            content:
              '🤖 审批卡片 ap_a1b2c3d4(写:claude → 审:gemini)\n改动:add.ts\n审查意见:通过\n✅ 已自动批准(autoApprove)',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '已落地，等人开口', tone: 'human' });
  });

  it('人批准落地后不把球留在审查官手上', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'gemini', content: '结论:通过', status: 'completed' },
          {
            role: 'system',
            content:
              '📋 审批卡片 ap_a1b2c3d4(写:claude → 审:gemini)\n改动:add.ts\n审查意见:通过\n回复 #approve ap_a1b2c3d4 批准',
          },
          { role: 'user', content: '#approve ap_a1b2c3d4' },
          { role: 'system', content: '✅ 已批准并落地: ap_a1b2c3d4' },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '已落地，等人开口', tone: 'human' });
  });

  it('接力时间线按出场顺序,失败标在最后一棒', () => {
    expect(
      describeRelayTimeline(
        [
          { role: 'user', content: '@墨墨 写 add.ts' },
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          { role: 'assistant', agentId: 'gemini', content: '', status: 'failed' },
          { role: 'system', content: '⚠️ 本轮失败。球还在地上:点下面交给下一只' },
        ],
        false,
        nameOf,
      ),
    ).toEqual([
      { name: '墨墨', agentId: 'claude', status: 'done' },
      { name: '闪闪', agentId: 'gemini', status: 'failed' },
    ]);
  });

  it('停棒但没失败时最后一棒标成 dropped', () => {
    expect(
      describeRelayTimeline(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          { role: 'system', content: '🤝 接力:墨墨 → 闪闪' },
          { role: 'assistant', agentId: 'gemini', content: '看了一下', status: 'completed' },
          { role: 'system', content: '⚠️ 球还在地上:闪闪停棒了' },
        ],
        false,
        nameOf,
      ).map((h) => h.status),
    ).toEqual(['done', 'dropped']);
  });

  it('空线程没有时间线', () => {
    expect(describeRelayTimeline([], false, nameOf)).toEqual([]);
  });

  it('发送中跟上正在开口的猫', () => {
    expect(
      describeRelayTimeline(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          { role: 'assistant', agentId: 'gemini', content: '审', status: 'streaming' },
        ],
        true,
        nameOf,
      ),
    ).toEqual([
      { name: '墨墨', agentId: 'claude', status: 'done' },
      { name: '闪闪', agentId: 'gemini', status: 'active' },
    ]);
  });

  it('捡球命令走现有 @ 路由', () => {
    expect(isDroppedBallNote('⚠️ 本轮已中止。球还在地上:点下面交给下一只')).toBe(true);
    expect(formatPickupCommand('闪闪')).toBe('@闪闪 接着做');
  });

  it('有 kind 时改掉文案顶栏仍认掉球', () => {
    const view = describeBall(
      [{ role: 'system', content: '球掉地上了', systemKind: 'dropped' }],
      false,
      nameOf,
    );
    expect(view.tone).toBe('ground');
    expect(view.text).toContain('球掉地上了');
  });

  it('有 kind 时改掉文案顶栏仍认拉闸', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '停了,罐子收了。等你说话。', systemKind: 'freeze' }],
        false,
        nameOf,
      ),
    ).toEqual({ text: '已拉闸，等人开口', tone: 'human' });
  });

  it('有 kind 时改掉文案顶栏仍认待批准', () => {
    expect(
      describeBall(
        [{ role: 'system', content: '改动等人点头 ap_deadbeef', systemKind: 'approval-pending' }],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('有 kind 时改掉文案顶栏仍认持球', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '等 测试跑完', status: 'completed' },
          { role: 'system', content: '先搁着:墨墨。开口再叫。', systemKind: 'hold' },
        ],
        false,
        nameOf,
      ).tone,
    ).toBe('cat');
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '等 测试跑完', status: 'completed' },
          { role: 'system', content: '先搁着:墨墨。开口再叫。', systemKind: 'hold' },
        ],
        false,
        nameOf,
      ).text,
    ).not.toBe('球在墨墨手上');
  });

  it('git-move 在最后时顶栏仍显示它之前那条', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写好了', status: 'completed' },
          {
            role: 'system',
            content: '墨墨 在 `meow/xxx` 上提交了 1 个 commit',
            systemKind: 'git-move',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在墨墨手上', tone: 'cat', agentId: 'claude' });
    expect(
      describeBall(
        [
          {
            role: 'system',
            content: '📋 审批卡片 ap_deadbeef\n改动:x.txt\n审查意见:通过\n回复 #approve',
            systemKind: 'approval-pending',
          },
          {
            role: 'system',
            content: '⚠️ 基准分支 `main` 的远端引用变了',
            systemKind: 'git-overstep',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('git-overstep 顶栏球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '推了', status: 'completed' },
          {
            role: 'system',
            content: '⚠️ 基准分支 `main` 的远端引用变了',
            systemKind: 'git-overstep',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('pr-opened 不参与球权,顶栏仍显示它之前那条', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '开了 PR', status: 'completed' },
          {
            role: 'system',
            content: '墨墨 对自己这根 `meow/t1` 开了 PR #12：https://example.com/pull/12',
            systemKind: 'pr-opened',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在墨墨手上', tone: 'cat', agentId: 'claude' });
  });

  it('pr-review 不参与球权,顶栏仍显示它之前那条(评论正文带「接力:」也不误判)', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '开了 PR', status: 'completed' },
          {
            role: 'system',
            content: '💬 PR #12 新评论:「这一棒接力:墨墨 → 闪闪 漏了测试」',
            systemKind: 'pr-review',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在墨墨手上', tone: 'cat', agentId: 'claude' });
  });

  it('pr-merged 顶栏球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '合了', status: 'completed' },
          {
            role: 'system',
            content: '⚠️ PR #12 已被合并：https://example.com/pull/12',
            systemKind: 'pr-merged',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('approval-failed 顶栏球在人手里', () => {
    expect(
      describeBall(
        [
          { role: 'assistant', agentId: 'claude', content: '写好了', status: 'completed' },
          {
            role: 'system',
            content: '⚠️ 批准记下了，但提交失败：nothing to commit',
            systemKind: 'approval-failed',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual({ text: '球在人手里', tone: 'human' });
  });

  it('git-move 不进接力时间线', () => {
    expect(
      describeRelayTimeline(
        [
          { role: 'assistant', agentId: 'claude', content: '写好了', status: 'completed' },
          {
            role: 'system',
            content: '墨墨 在 `meow/xxx` 上提交了 1 个 commit',
            systemKind: 'git-move',
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual([{ name: '墨墨', agentId: 'claude', status: 'done' }]);
  });

  it('接力带 systemMeta.to 时时间线拿到 agentId', () => {
    expect(
      describeRelayTimeline(
        [
          { role: 'assistant', agentId: 'claude', content: '写完了', status: 'completed' },
          {
            role: 'system',
            content: '🤝 接力:墨墨 → 闪闪',
            systemKind: 'relay',
            systemMeta: { from: 'claude', to: 'gemini' },
          },
        ],
        false,
        nameOf,
      ),
    ).toEqual([
      { name: '墨墨', agentId: 'claude', status: 'done' },
      { name: '闪闪', agentId: 'gemini', status: 'active' },
    ]);
  });
});
