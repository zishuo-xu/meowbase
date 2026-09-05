# MCP 配置可携带

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F145 / F249 —— MCP 配置可携带,换项目不用手拼启动参数。
- 靠拢:拿「导出一份可粘贴的 mcpServers 片段」。差在完整 SDK 和自动写入别人仓库:本篇只导出,人自己贴。

## 门（各一句）

- **功能**：`GET /api/mcp/provision` 返回 claude 的 `mcpServers` JSON、gemini 允许名单、环境变量。Hub 能力页能复制。
- **价值**：面试能讲「协作工具换项目带着走,不是写死在这一仓」;人不必翻适配器源码拼 `--mcp-config`。
- **愿景**：仍是邮差。导出的是窗口地址,不替人改别的项目。
- **落点**：`formatMcpProvision`;HTTP;Hub 一块只读。

## 为什么

stdio 已经能挂上本机 API。对照他们:配置要能带走。喵窝差的是导出。不做成 X:简历写跨项目同步,演示时只有这一仓的环境变量。

不往别的 git 仓写文件。不引入 MCP SDK。

## 怎么做

1. `formatMcpProvision({ command, apiUrl })` 给出 `claude` / `gemini` / `env` 三块。
2. `GET /api/mcp/provision`。命令默认 `MEOW_MCP_COMMAND` 或 `pnpm --filter @meowbase/api mcp`。
3. Hub 能力页「可携带」展示 JSON,按钮复制。
4. 验收:接口里 `mcpServers.meowbase.command` 非空;粘贴到另一份 claude `--mcp-config` 形状对得上现有 `mcpCliArgs`。

## 不做（本篇）

- 自动写入 `~/.claude` 或其他仓库
- npm 包装的完整 SDK
- 资源模板 / prompts

## 入口

- 纯函数:`packages/api/src/mcp/protocol.ts` `formatMcpProvision`
- HTTP:`GET /api/mcp/provision`
- Hub 能力页:可携带 JSON
