# 同步 A2A：交接包 + 独立会话

- 状态:`已落地`
- 对照 clowder:公开写 A2A = 异步消息 + `@` 路由 + 线程隔离 + 结构化交接。我们拿后三条，把第一条做成**同一轮同步接力**。
- 现行怎么跑（图、交接包字段、公共物表）：[docs/A2A.md](../A2A.md)

## 功能

猫行首 `@闪闪 请审查` 时，平台停这只、记下 pending，人看见 `🤝 接力` 和球在闪闪。再开口才跑下一只。`@人` 停链。有 diff 即使忘了 `@` 也会拉审查。

## 价值

人不必复制上下文到另一个窗口。下一棒拿到的是一份能干活的短信，不是另一只猫的整段闲聊。

## 愿景

平台拼包、认地址、记球在谁手上。猫决定交给谁（名册只是默认纪律），人决定批不批。

## 架构落点

`parseA2AHandoff` / `formatA2AHandoffPrompt` 在 shared；链在 `executeTurn` 的 `runSegment`。会话在 `thread.sessions[agentId]`。不读对方 CLI 历史。

## 为什么这样设计

根因：两只猫若共用一个聊天窗，审查官会被写手的思路污染；若把整段 CLI 记录喂过去，隔离和费用都崩。

| # | 决策 | 理由 |
|---|---|---|
| D1 | 交棒后本轮先结束 | 人能离开；下一跳仍进 `executeTurn`，见 [async-a2a.md](async-a2a.md) |
| D2 | 交接包是 prompt 字符串，不是邮箱记录 | 人点开接力条看到的就是下一棒吃的东西，没有第二套管线 |
| D3 | 每只猫自己的 `--resume` | 身份和工具记忆不串台 |
| D4 | 链深默认 3、已出场不回来 | 防环；审查官收棒后停 |
| D5 | 交给谁写在名册 `handoffTo` | 不写 `if (claude)` |

## 怎么做

见 [docs/A2A.md](../A2A.md) 第 1–4 节。实现时只改 shared 纯函数 + `executeTurn` 消费它们；UI 接力条展示同一份包。

验收：墨墨行首 `@闪闪` → 时间线 `墨墨 → 闪闪`，点交接包能看到目标和任务；行首 `@人` → 顶栏球在人手里。

## 不做什么

- 不建 mailbox / InvocationQueue / `hold_ball`
- 不 MCP `targetCats` 派球
- 不把墨墨的 CLI session 喂给闪闪
- 不跨线程自动读对方对话（证据召回是只读片段，见 [memory-evidence.md](memory-evidence.md)）

## 面试能讲

- **30 秒**：人看到一条线程。底下是：谁开口、这一棒带什么字、各猫自己的 CLI 记忆、共用沙箱和证据。交棒是同步接力，不是异步邮箱。
- **追问「和 clowder 有何不同」**：图一样（三层 + 路由 + 隔离 + 包 + 证据）。机器不同：他们后来是邮箱和 MCP；我们是一条 `executeTurn` 跑完。图可以像，第二心脏可以后加。
- **追问「上下文怎么独立」**：线程 / 每猫 session / 当跳 system prompt 三层。漏一层就串台。
- **踩坑**：opencode 必须 `--dir` 钉沙箱，否则文件写到仓库根；审批 diff 要丢掉 `node_modules`。
- **若继续往 clowder 靠**：第一刀是人能离开，见 [async-a2a.md](async-a2a.md)。

## 代码入口

- 交棒 / 包：`packages/shared/src/a2a.ts`
- 管线：`packages/api/src/router/execute-turn.ts`
- 身份拼装：`packages/shared/src/system-prompt.ts`
- 怎么跑的说明：[docs/A2A.md](../A2A.md)
