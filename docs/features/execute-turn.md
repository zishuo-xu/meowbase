# 一条消息的心脏：executeTurn

- 状态:`已落地`
- 对照 clowder:公开架构是 Identity + A2A Router + Memory + SOP + MCP。我们把「人发一条之后发生的事」收进**一个函数**，不把 SOP/MCP 做成并列心脏。
- 相关:[a2a.md](a2a.md)、[mention-routing.md](mention-routing.md)、[approval.md](approval.md)

## 功能

人在线程里发一条消息，平台按固定顺序处理完：系统命令 → 点名 → A2A 接力 → 沉淀 → diff 建卡并拉审查。

## 价值

人不用当路由器。面试时能指着一个文件讲完整数据流，而不是「后端有一堆 service」。

## 愿景

平台当邮差：不推理、不替猫想下一步产品方向。顺序是纪律，推理在 CLI 里。

## 架构落点

`packages/api/src/router/execute-turn.ts`。解析和拼装在 `packages/shared`。存储只打 `stores/ports.ts`。不在这里再开队列消费者当第二入口。

## 为什么这样设计

根因：多猫协作最容易散成「路由一个服务、交接一个服务、审批一个服务」，人再也讲不清一条消息走哪。

| # | 决策 | 理由 |
|---|---|---|
| D1 | 一条用户消息只进一个 `executeTurn` | 球权、审计、审批都在同一条时间线上 |
| D2 | 系统命令（`#confirm` / `#approve` / `星星罐子`）先于叫猫 | 人的拍板和拉闸不能被模型「商量掉」 |
| D3 | 并行组之间互不接力，组内串行交棒 | 同题并行是扇出，不是全员大群聊 |
| D4 | 写 Redis 走队列串行化 append | 并行组并发写会 lost-update（踩坑 7） |

## 怎么做

1. 解析本条是不是系统命令；是则改存储、回系统句，返回。
2. `extractMentionTargets` 得到行首目标；无则续最近行首点过的猫 / 最后开口 / 主猫。
3. 每个目标 `runSegment`：调适配器 → 看回复里有没有行首 `@` → 有则拼交接包跑下一跳，直到深度/防环/审查收棒/`@人`。
4. 若带 `#learn`，本轮回复落成证据 draft。
5. `git diff HEAD` 有改动则建审批卡并拉审查；`autoApprove` 则先 `approve()` 再 `markApplied`。

验收：发「写 add.ts，写完自检。\n@墨墨」能看到接力条、审批卡；发 `星星罐子` 不调猫。

## 不做什么

- 不在 `executeTurn` 外再开一条「邮箱消费者」当默认入口（异步见 [async-a2a.md](async-a2a.md)）
- 不在这里写 `if (墨墨)`；交给谁在名册 `handoffTo`
- 不把模型当路由器（不做意图分类再派猫）

## 面试能讲

- **30 秒**：平台不推理。人发一条进 `executeTurn`，命令、点名、交棒、记忆、审批都在这一管线。模型在 CLI 里想，我们当邮差。
- **追问「为什么不拆微服务」**：简历项目要能画一条线。拆开就要第二路由器，球权会丢。
- **踩坑**：并行写 Redis 必须排队；`markApplied` 只接受 `approved`，自动批准要先 `approve()`。
- **若继续往 clowder 靠**：异步交棒应挂在本函数**之后**的待跑队列，不要另起心脏。

## 代码入口

- 管线：`packages/api/src/router/execute-turn.ts`
- 端口：`packages/api/src/stores/ports.ts`
- 单测：`packages/api/src/router/execute-turn.test.ts`
