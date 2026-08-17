# Provider：三家 CLI，一个 runTurn

- 状态:`已落地`
- 对照 clowder:公开表是 Claude / Codex / Gemini / Antigravity / opencode，统一消息层。我们三家：claude / gemini / opencode，契约相同，解析各写。
- 相关:[execute-turn.md](execute-turn.md)

## 功能

业务只调 `runTurn({ prompt, systemPrompt, cwd, sessionId })`，拿到流式文本、归一化 token、新 sessionId。换猫 = 换适配器，不换路由。

## 价值

面试能讲端口-适配器，而不是「if claude 一套、if gemini 一套」散落在路由里。

## 愿景

平台不推理，也不绑死一家 CLI。模型天花板在外，地板是我们的契约。

## 架构落点

`packages/api/src/providers/*` 实现 `AgentService`，注册进 `createAgentRegistry`。名册在 `meowbase.config.json`。

## 为什么这样设计

根因：三家 CLI 的 stream 事件名、系统提示参数、写文件审批开关全不一样。差异必须停在适配器，否则 `executeTurn` 会烂。

| # | 决策 | 理由 |
|---|---|---|
| D1 | 统一 `AgentTurnResult` | token / 耗时 / session / 终止原因可审计、可展示 |
| D2 | 无系统提示参数的 CLI：身份前置拼进 prompt | gemini / opencode 公开能力如此 |
| D3 | 写文件一律放开 headless（bypass / yolo / `--auto`） | 否则自检和落地卡在 CLI 自己的审批 |
| D4 | opencode 传 `--dir` 绝对沙箱 | 它会上溯项目根，文件会写丢 |

## 怎么做

新 CLI：实现 `AgentService` + 注册 + golden fixture（真实输出录一截）+ fake bin 给单测。会话：`thread.sessions[agentId]` 下次 `--resume` / `-r` / `--session`。

验收：`pnpm test` 解析器绿；冒烟才打真实 CLI。

## 不做什么

- 不在路由里解析任何一家的 JSON
- 不把桌面版 / ACP / 飞书适配当 v1（他们公开有，我们非目标）

## 面试能讲

- **30 秒**：策略模式。路由认 `runTurn`，三家各自消化 stream-json / ndjson。会话按猫存在线程上。
- **追问具体差异**：claude 事件是 assistant/result；gemini 是 init/message/result；opencode 中间 `tool-calls` 不算失败。
- **踩坑**：改 shared 后要 rebuild，否则 API 热更新仍用旧 dist；重启 API 必须杀 3200 端口。
- **若继续往 clowder 靠**：他们还有 Codex、MCP 回调桥。加适配器可以；MCP 桥是另一层，见 [async-a2a.md](async-a2a.md)。

## 代码入口

- 适配器：`packages/api/src/providers/`
- 注册：`createAgentRegistry`
- 踩坑原文：`AGENTS.md`
