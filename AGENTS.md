# AGENTS.md — meowbase 接手必读

> 给新接手的人或 AI agent 的第一份文档。先读这个,再读代码。

## 这是什么

**meowbase(喵窝)**:参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT)架构自写的多 Agent 协作平台。让 Claude Code / opencode 等 agent CLI 像一支团队一样协作:路由、身份、记忆、技能、互审、审批。代码全部自写,架构思想借鉴 clowder。

三只猫定位:墨墨主架构师(写完 `@闪闪`)、闪闪审查官(审完回墨墨)、团团执行者(做完交闪闪审)。交接对象和工作流条目在名册的 `handoffTo` / `handoff` 里,不要写进路由代码。

## 快速上手

```bash
cd ~/code/meowbase
pnpm install
pnpm dev          # 起 Redis + API(3200)+ Web(3300)
pnpm test         # 全部单测(shared/api/web)
pnpm -r build     # 三包构建 + 类型检查
pnpm smoke        # 真实冒烟(需要真实 claude/opencode 通道,花钱)
```

浏览器打开 http://localhost:3300。API 只读接口可直接 curl localhost:3200。

## 仓库结构

```
packages/
├── shared/   跨包纯逻辑:类型、@mention 解析、A2A 交接、token 归一化、systemPrompt 拼装
├── api/      Fastify 后端:存储(端口-适配器)、provider 适配器、executeTurn 路由、审批流
└── web/      Next.js 前端:猫耳气泡 UI、@补全、审批卡片、WebSocket 流式
skills/      技能文件(manifest.json + prompts/*.md),启动时加载
scripts/      smoke.ts(真实冒烟)、fixtures/(fake CLI,测试/演示用)
work/         线程沙箱目录(git 仓库,gitignore 忽略)
docs/         设计文档(specs/)+ 实现计划(plans/)
```

## 架构核心(30 秒版)

三层:模型(推理)→ Agent CLI(工具)→ **平台(我们写的)**:路由、线程、身份、记忆、技能、审批。

关键文件(按阅读顺序):
1. `packages/api/src/router/execute-turn.ts` —— **心脏**。一条消息的完整管线:系统命令分支(`#confirm`/`#approve`/`#reject`)→ 多 @ 同题并行 → 每目标跑 A2A 接力链 → #learn 沉淀 → diff 检测 → 审批卡片+自动审查 → autoApprove 判断
2. `packages/api/src/stores/ports.ts` —— 存储端口定义(业务只依赖接口)
3. `packages/api/src/providers/` —— ClaudeAdapter / GeminiAdapter / OpenCodeAdapter,统一 `runTurn` 契约
4. `packages/shared/src/` —— 所有解析/拼装纯函数,单测覆盖最全
5. `packages/web/components/` —— UI 组件

## 消息协议(用户可用)

| 语法 | 作用 |
|---|---|
| `@墨墨 任务` | 单角色执行(自动触发审批流拉审查) |
| `@墨墨 @团团 问题` | 同题并行(多 @ = 同一消息发给所有目标) |
| 回复中行首 `@团团 任务` | A2A 接力:中文名与英文 id 等价(`@团团`=`@opencode`);链深默认 3(`A2A_MAX_DEPTH`),防环;句中 @ 不会交接 |
| 回复中行首 `@人` / `@owner` | 升级给人拍板,停接力;球回到人手里 |
| `#learn 标题` | 请求沉淀本轮回复为证据(draft) |
| `#confirm ev_xxx` | 确认证据 |
| `#ev_xxx` | 引用历史证据注入上下文 |
| `#approve ap_xxx` / `#reject ap_xxx 理由` | 审批决策 |
| `#learn` + diff | 写手改动文件 → 自动建审批卡片 → 另一 agent 审查 |

## 开发约定

- TypeScript 严格模式,ESM,相对导入带 `.js` 后缀(NodeNext)
- 业务逻辑只依赖 `stores/ports.ts` 接口,禁止直接 import ioredis
- **计划先对照 clowder**:提出下一步前先看他们公开设计怎么做同一件事,只拿语义和踩坑,不抄源码,不搬邮箱/SOP/MCP
- **TDD**:新功能先写失败测试 → 实现 → 全绿 → 提交
- 提交规范:`feat/fix/refactor/test/docs/chore` 前缀
- 测试:`pnpm test`(shared 48 + api 70 + web 24 ≈ 142);api 的 Redis 测试需要本地 Redis 在跑(未启动则自动跳过)
- 新增 agent CLI 适配器:实现 `AgentService` 接口 + 注册进 `createAgentRegistry`(见 `providers/gemini.ts`)
- 新增技能:在 `skills/` 加 md + manifest 条目,无需改代码

## 踩坑记录(血泪清单,改代码前先看)

1. **重启 API 必须按端口杀进程**:`pkill -f "tsx watch"` 经常杀不掉(命令行里没这字样),旧进程继续占 3200 服务旧代码 → 你以为在验证新代码,其实在旧代码上(EADDRINUSE 静默失败)。正确姿势:`lsof -ti :3200 | xargs kill -9` 再起。
2. **web 服务崩溃会损坏 `.next` 缓存**:出现"页面能开但没交互/资源 404"时,`rm -rf packages/web/.next` 重启。
3. **opencode 适配器**:必须带 `--auto`(headless 写文件权限);systemPrompt 无参数,需前置拼进 prompt;解析器要容忍中间 `tool-calls` step(不算失败,最终 stop 才算)。
4. **claude 适配器**:`--permission-mode acceptEdits` 只放行改文件,headless 跑 `node`/`tsx` 会卡在审批、自检只能写「跑不了」。必须 `bypassPermissions`(对齐 opencode `--auto` / gemini `yolo`)。
5. **gemini 适配器**:`stream-json` 事件是 `init`/`message`/`result`(不是 claude 的 assistant/result);无系统提示词参数,身份前置拼进 prompt;headless 写文件必须 `--approval-mode yolo`,否则会卡在审批。`--resume`/`-r` 接受 session UUID(init 事件的 `session_id`)。
6. **opencode 项目根会上溯**:模型可能把文件写到仓库根(而非线程沙箱)。防御:适配器传 `--dir` 绝对沙箱路径 + 线程工作目录有 package.json + 系统提示写明沙箱绝对路径 + 每轮 `sweepStrayFiles` 自动移回。**清扫只收仓库根/包根浅文件**(如 `mul.js`),不会碰 `src/`、`test/`。审批/交接 diff 忽略 `node_modules`。
7. **并行组并发写 Redis 会 lost-update**:executeTurn 内有写队列串行化 append/patch,别绕开它。
8. **审批状态机**:`markApplied` 只接受 `approved` 状态,自动批准路径必须先 `approve()`。
9. **线程工作目录是 git 仓库**:创建时 gitInit(含 package.json 基线),diff 检测靠 `git diff HEAD`。
10. **IME 输入法**:前端回车处理必须检查组合状态(composingRef + isComposing + keyCode 229),否则中文选词回车会误发送。
11. **Redis 测试数据污染**:测试线程/证据会留在 Redis,断言前用唯一 id(如 `t-${Date.now()}`)。
12. **服务重启后 shared dist 过期**:改了 `packages/shared` 后,api 启动脚本会先 rebuild,但热更新中途不会——改 shared 后需重启 api 或手动 `pnpm --filter @meowbase/shared build`。
13. **未跟踪源码会被沙箱清扫误搬走**:新文件若还没 `git add`,旧版 `sweepStrayFiles` 会把它 `rename` 进 `work/<threadId>/`,tsx 记成 `unlink`,API 重启后模块找不到、3200 掉线。规避:新适配器/测试立刻提交(或至少 `git add`);改清扫规则后只允许浅层散落文件;API 日志出现 `sweepStrayFiles: 移回沙箱` 时去对应线程目录找回。

## 常见操作

- **加一个技能**:`skills/prompts/x.md` + `skills/manifest.json` 加条目(triggers 触发词)
- **改 agent / 模型**:编辑仓库根 `meowbase.config.json`(名字、别名、bin、model、A2A 链深,以及每只猫的 `handoffTo` / `handoff`),重启 API;`PATCH /api/profiles/:agentId {"autoApprove":true}` 开自动批准
- **加审批场景**:参考 executeTurn 审批块,复用 ApprovalStore
- **真实模型演示**:不带 CLAUDE_BIN/GEMINI_BIN/OPENCODE_BIN 启动 api;步骤和期望见 [docs/DEMO.md](docs/DEMO.md)。费用按 token 计(一次完整流程约 $0.2-0.4)。用户消息里不要写「不要 `@闪闪`」,句中 `@` 仍会并行叫它
