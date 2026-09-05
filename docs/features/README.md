# 功能设计

对照 clowder：他们也是一个 F 一篇。我们更短：**一次只写一篇，只做这一篇。**

1. 开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。读 README / TIPS / `docs/features` / issue，只记语义。
2. 复制 [_template.md](_template.md)，填「对照 / 靠拢」，一篇一个可点可看的特性。
3. 做完、状态改成 `已落地`，协议入口同一轮改掉。
4. 再开下一篇。不要一次写齐「以后可能做的」。

`设计中` 同时最多一篇。表里没有「设计中」时，最后一篇已落地的就是上一刀。

设计尽量靠拢他们公开的图和语义。落地先薄后厚，不抄源码。

已落地的是补记已有代码，不是预写。某篇太长，轮到改那个特性时再削。

| 篇 | 状态 | 这一刀 |
|---|---|---|
| [execute-turn.md](execute-turn.md) | 已落地 | 一条消息一个心脏 |
| [mention-routing.md](mention-routing.md) | 已落地 | 只认行首 `@` |
| [a2a.md](a2a.md) | 已落地 | 交接包 + 独立会话 |
| [memory-evidence.md](memory-evidence.md) | 已落地 | 人确认才进公共记忆 |
| [approval.md](approval.md) | 已落地 | diff 建卡，人批落地 |
| [providers.md](providers.md) | 已落地 | 三家 CLI 一个 `runTurn` |
| [skills.md](skills.md) | 已落地 | 触发词当轮注入 |
| [async-a2a.md](async-a2a.md) | 已落地 | 交棒后本轮可先结束 |
| [defer-review-while-pending.md](defer-review-while-pending.md) | 已落地 | 有 pending 时本轮不审 |
| [auto-follow-pending.md](auto-follow-pending.md) | 已落地 | 交棒后平台自己续跑 |
| [exit-nudge.md](exit-nudge.md) | 已落地 | 无出口时再问同一只一次 |
| [review-ball-to-human.md](review-ball-to-human.md) | 已落地 | 审查通过后顶栏球回人 |
| [revise-ball-to-writer.md](revise-ball-to-writer.md) | 已落地 | 需修改后先球在写手,卡出后回人 |
| [hold-wait.md](hold-wait.md) | 已落地 | 行首「等」持球 |
| [verification-gate.md](verification-gate.md) | 已落地 | 没证据:卡上不算通过,不自动落地 |
| [hub-capability.md](hub-capability.md) | 已落地 | Hub 能力表 |
| [hold-command-wake.md](hold-command-wake.md) | 已落地 | 行首「等跑」平台托管命令再叫醒 |
| [thread-repo-worktree.md](thread-repo-worktree.md) | 已落地 | 线程绑真实仓库,worktree 隔离 |
| [live-sync.md](live-sync.md) | 已落地 | 续跑产出即时推到前端 |
| [review-conclusion.md](review-conclusion.md) | 已落地 | 只认真正的结论段 |
| [durable-relay.md](durable-relay.md) | 已落地 | 接力不怕重启 |
| [hop-commit-then-clear.md](hop-commit-then-clear.md) | 已落地 | 跑完落库再清那一棒 |
| [system-message-kind.md](system-message-kind.md) | 已落地 | 系统消息带类型,前端不猜正文 |
| [audit-trail.md](audit-trail.md) | 已落地 | 平台的决定留可查的存根 |
| [quota-board.md](quota-board.md) | 已落地 | 按猫看 token 和花费 |
| [e2e-harness.md](e2e-harness.md) | 已落地 | 整机自检:全链和崩溃恢复进 CI |
| [failure-mode-eval.md](failure-mode-eval.md) | 已落地 | 坏毛病记分板:平台兜住率 |
| [void-handoff-gate.md](void-handoff-gate.md) | 已落地 | 空手不许交棒 |
| [command-allowlist.md](command-allowlist.md) | 已落地 | 平台只跑认得的命令 |
| [git-state-tracking.md](git-state-tracking.md) | 已落地 | 猫对 git 做了什么,平台看得见 |
| [repo-root-allowlist.md](repo-root-allowlist.md) | 已落地 | 只在允许的目录干活,只听本机说话 |
| [push-boundary.md](push-boundary.md) | 已落地 | 放开推送,越界就停 |
| [platform-spend.md](platform-spend.md) | 已落地 | 空模型名不许探测,探测用量当场显示不进账本 |
| [pr-open.md](pr-open.md) | 已落地 | 猫自己开 PR,合了就停 |
| [approval-void.md](approval-void.md) | 已落地 | 合了之后那张卡要作废 |
| [approve-after-self-commit.md](approve-after-self-commit.md) | 已落地 | 猫自己提交之后,批准算什么 |
| [one-hop-per-thread.md](one-hop-per-thread.md) | 已落地 | 同一线程同一时刻只跑一跳 |
| [demo-path-in-ci.md](demo-path-in-ci.md) | 已落地 | 演示路径进 CI:人打字那一层也要有人管 |
| [remote-opt-in.md](remote-opt-in.md) | 已落地 | 本地是默认,碰远程要显式开 |
| [memory-scope.md](memory-scope.md) | 已落地 | 记忆按仓库划界,注入带出处 |
| [risk-routed-reviewer.md](risk-routed-reviewer.md) | 已落地 | 按风险面选审查官 |
| [pr-review-reflow.md](pr-review-reflow.md) | 已落地 | PR 上的评论流回线程 |
| [pr-ci-tracking.md](pr-ci-tracking.md) | 已落地 | PR 上的 CI 变绿变红流回线程 |
| [pr-conflict.md](pr-conflict.md) | 已落地 | PR 合不进去时流回线程 |
| [pending-handoff-queue.md](pending-handoff-queue.md) | 已落地 | 交棒排队,跑完接下一条 |
| [user-message-queue.md](user-message-queue.md) | 已落地 | 人插话先排队,不打断正在跑的猫 |
| [queue-panel.md](queue-panel.md) | 已落地 | 顶栏点开就能看见排队 |
| [budget-gate.md](budget-gate.md) | 已落地 | 花超了就拒跑 |
| [skill-usage.md](skill-usage.md) | 已落地 | 技能和工具用过几次 |
| [queue-steer.md](queue-steer.md) | 已落地 | 排队里提到前面 |
| [sop-board.md](sop-board.md) | 已落地 | 家规写成告示牌 |
| [collab-tools.md](collab-tools.md) | 已落地 | 协作工具:搜消息、列线程 |
| [memory-files.md](memory-files.md) | 已落地 | 确认了就写成文件 |
| [hop-transcript.md](hop-transcript.md) | 已落地 | 每一跳留一份原始记录 |
| [approval-hub.md](approval-hub.md) | 已落地 | 待批卡聚到一页 |
| [mcp-stdio.md](mcp-stdio.md) | 已落地 | 协作工具挂上 CLI |
| [session-capsule.md](session-capsule.md) | 已落地 | 新会话带上已确认证据 |
| [cross-thread-post.md](cross-thread-post.md) | 已落地 | 跨线程传话带出处 |
| [memory-recall.md](memory-recall.md) | 已落地 | 记忆召回度量 |
| [group-mentions.md](group-mentions.md) | 已落地 | 群组 mention 展开 |
| [queue-reorder.md](queue-reorder.md) | 已落地 | 排队改序与急件置顶 |
| [budget-pools.md](budget-pools.md) | 已落地 | 按猫拆池与热改上限 |
| [thought-layers.md](thought-layers.md) | 已落地 | 思考与计划分层 |
| [mcp-provision.md](mcp-provision.md) | 已落地 | MCP 配置可携带 |
