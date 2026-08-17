# 功能设计

对照 clowder：他们也是一个 F 一篇。我们更短：**一次只写一篇，只做这一篇。**

1. 对照他们公开 README / TIPS / `docs/features` / issue，只记语义。
2. 复制 [_template.md](_template.md)，一篇一个可点可看的特性。
3. 做完、状态改成 `已落地`，协议入口同一轮改掉。
4. 再开下一篇。不要一次写齐「以后可能做的」。

`设计中` 同时最多一篇。现在没有设计中；上一刀 [defer-review-while-pending.md](defer-review-while-pending.md) 已落地。

对照他们时看整条能力，落地只做最薄的一刀；同一特性以后再加厚，第一刀不要做成他们那么复杂。

已落地的是补记已有代码，不是预写。某篇太长，轮到改那个特性时再削。

| 篇 | 状态 | 这一刀 |
|---|---|---|
| [execute-turn.md](execute-turn.md) | 已落地 | 一条消息一个心脏 |
| [mention-routing.md](mention-routing.md) | 已落地 | 只认行首 `@` |
| [a2a.md](a2a.md) | 已落地 | 同步接力 + 交接包 |
| [memory-evidence.md](memory-evidence.md) | 已落地 | 人确认才进公共记忆 |
| [approval.md](approval.md) | 已落地 | diff 建卡，人批落地 |
| [providers.md](providers.md) | 已落地 | 三家 CLI 一个 `runTurn` |
| [skills.md](skills.md) | 已落地 | 触发词当轮注入 |
| [async-a2a.md](async-a2a.md) | 已落地 | 交棒后本轮可先结束 |
| [defer-review-while-pending.md](defer-review-while-pending.md) | 已落地 | 有 pending 时本轮不审 |
