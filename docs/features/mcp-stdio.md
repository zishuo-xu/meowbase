# 协作工具挂上 CLI

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F043 / F145 —— 协作工具是独立 MCP 进程,猫的 CLI 挂上就能调;配置可携带。
- 靠拢:拿「stdio 服务器暴露 search_messages / list_threads,适配器启动时把这个 server 传给三家 CLI」。差在跨项目同步和完整 SDK:本篇手写最小 JSON-RPC,工具仍打现有 HTTP。

## 门（各一句）

- **功能**：`node packages/api/dist/mcp.js` 能 initialize、list tools、call `search_messages` / `list_threads`。三家适配器 spawn 时带上这个 MCP。
- **价值**：面试能指着进程说「猫有结构化工具通道,不是只靠拼进提示词」。
- **愿景**：仍是邮差。MCP 是翻目录的窗口,不改路由。
- **落点**：`src/mcp.ts` JSON-RPC stdio;适配器加 `--mcp-config` / 等价参数;默认指向本机 API。

## 为什么

HTTP 工具面人能 curl,猫的 CLI 挂不上。对照他们:协作工具是必装 MCP。喵窝差的是进程。不做成 X:简历写 MCP,演示时只有 URL。

服务器自己不连 Redis,只打 `MEOW_API_URL`(默认 `http://127.0.0.1:3200`)。

## 怎么做

1. JSON-RPC:`initialize` / `tools/list` / `tools/call`。工具名 `search_messages`(q, agentId?, threadId?)、`list_threads`。
2. call 时 fetch 现有 `/api/collab/messages` 和 `/api/collab/threads`。
3. 适配器若 `MEOW_MCP=0` 则不挂;否则把 server 命令传给 CLI(claude `--mcp-config`,其余能传就传,不能传就跳过不挡跳)。
4. 验收:用假 stdin 喂 initialize + tools/list,列出两把工具;call search_messages 打到测试 HTTP。

## 不做（本篇）

- 跨项目配置同步(见 [mcp-provision.md](mcp-provision.md))、npm 包装发布
- 完整 MCP SDK、资源/提示模板
- 让猫经 MCP 发消息或改路由

## 入口

- 协议:`packages/api/src/mcp/protocol.ts`
- 入口:`packages/api/src/mcp.ts`(`pnpm --filter @meowbase/api mcp`)
- 适配器:`MEOW_MCP_COMMAND`;`MEOW_MCP=0` 不挂
- e2e/eval 默认 `MEOW_MCP=0`
