# Meowbase 设计文档

- 日期:2026-08-16
- 状态:已批准(用户确认开工);**M1–M6 已落地**。A2A 机械层可演示;证据可按「之前约定」召回;人可整行 `星星罐子` 拉闸。演示与口播见 [docs/DEMO.md](../../DEMO.md)
- 参考架构:[clowder-ai](https://github.com/zts212653/clowder-ai)(MIT)— 仅借鉴架构模式,代码全部自写

## 1. 背景与目标

### 1.1 背景

用户是 Agent 开发者,希望学习 clowder-ai 的多 Agent 协作平台架构,参照其设计**自行实现**一个精简版,作为简历重点项目。本项目是"参照重写":架构思想 90% 还原,功能范围收窄到核心平台。

### 1.2 目标(v1 做什么)

一个运行在 agent CLI 之上的平台层,让 Claude Code / Gemini CLI / opencode 三支 agent CLI 像一支团队一样协作:

1. **线程消息 + @mention 多 Agent 路由** —— 每个线程独立上下文,`@claude`/`@gemini`/`@opencode` 把任务路由给对应 agent
2. **Provider 适配层** —— 统一接口驱动三个 CLI,stream-json 流式输出,跨模型归一化(token、耗时、会话 ID)
3. **持久身份 + 共享记忆** —— agent 有名字/性格/角色,跨会话保持;团队共享证据库(事实/教训/决策)
4. **Skills 按需加载** —— 技能清单(manifest),需要时才注入技能 prompt,不常驻上下文
5. **跨模型互审 + 审批流** —— 写手 agent 产出 diff → 审查 agent 输出意见 → 人类在 UI 批准后落地
6. **Web 聊天界面** —— Next.js 浏览器界面,WebSocket 实时对话,审批卡片交互

### 1.3 非目标(v1 明确不做)

推送通知、语音/TTS、游戏、桌面应用、IM 连接器(飞书/微信/Telegram)、marketplace/插件市场、MCP 集成、多用户账号体系与细粒度权限、云部署、多人实时协作。

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 语言 | TypeScript(严格模式) |
| 包管理 | pnpm workspaces monorepo |
| 后端 | Fastify + @fastify/websocket + @fastify/cors |
| 存储 | Redis(ioredis),启动检查,连接失败明确报错 |
| 前端 | Next.js(App Router)+ Tailwind CSS |
| 测试 | vitest;存储层内存假实现;CLI 解析 golden test |
| 代码风格 | biome |

本机环境(已验证):Node v26.7.0、pnpm 10.33.0、Redis 8.6.1、claude/gemini/opencode CLI 均已安装。

## 3. 架构总览

三层职责(借鉴 clowder-ai 的三层原则):

| 层 | 负责 | 不负责 |
|---|---|---|
| 模型 | 推理、生成、理解 | 长期记忆、纪律 |
| Agent CLI | 工具调用、文件操作 | 团队协调、review |
| 平台(Meowbase) | 路由、线程、记忆、技能、审批、审计 | 推理 |

```
用户(浏览器 Web UI)
        │ WebSocket
┌───────▼───────────────────────────────┐
│ packages/api(Fastify + Redis)         │
│  Router & Threads │ Memory │ Skills   │
│  Approval Flow    │ Stores(ports)     │
└───────┬───────────────┬───────────┬───┘
     claude          gemini       opencode
  (stream-json)   (stream-json)    (ndjson)
```

## 4. 组件设计

### 4.1 Provider 适配层(`packages/api/src/providers/`)

统一接口 `AgentService`,三个实现:

- `ClaudeAdapter` —— `claude -p --output-format stream-json --resume <id>`
- `GeminiAdapter` —— `gemini -p -o stream-json -r <id> -m <model>`
- `OpenCodeAdapter` —— `opencode run --format json -m <provider/model> -c`

(参数已于 2026-08-16 在本机三个 CLI 的 `--help` 验证)

统一输出模型 `AgentTurnResult`:消息流(增量)、token 统计(归一化:input/output/cache/费用)、耗时、会话 ID、终止原因(正常/超时/崩溃)。

会话句柄:线程 ID → CLI 会话 ID 的映射存 Redis,线程恢复 = `--resume`。

### 4.2 路由与线程(`packages/api/src/router/`)

- 消息入线程时解析 `@mention` → 路由到目标 agent 的独立 CLI 会话
- 线程隔离:每个线程有独立 `threadId`、`sessionIds`(按 agent),上下文互不泄漏
- 无 mention 时默认路由给线程创建时指定的"主 agent"(可配置)
- **线程工作目录**:每个线程有独立目录 `work/<threadId>/`,CLI 在该目录内执行(借鉴 clowder 的 worktree 隔离思想);"diff 落地"即在此目录内应用改动

### 4.3 存储层(`packages/api/src/stores/`)

端口-适配器结构(借鉴 clowder-ai):

```
stores/
├── ports/      接口:ThreadStore / MessageStore / MemoryStore / ApprovalStore
├── redis/      Redis 实现
└── factories/  createThreadStore() 等组装函数
```

业务逻辑只依赖 `ports/`,测试注入内存假实现。Store 清单(第一版):

- `ThreadStore` —— 线程元数据、成员、会话映射
- `MessageStore` —— 消息(增量追加)、审批卡片、审查意见
- `MemoryStore` —— agent profile、身份记忆、证据库条目
- `ApprovalStore` —— 审批流状态机

### 4.4 持久身份与共享记忆(`packages/api/src/memory/`)

- **Profile**:每个 agent 的名字、性格、角色、擅长领域,存 Redis;创建后不可变,跨会话保持
- **身份记忆注入**:会话启动时把 profile 注入 CLI 的 system prompt。已验证:`claude -p --append-system-prompt <prompt>` 可用;gemini/opencode 适配器在实现时按各自能力实现等价注入(不支持则降级为在首条消息中附注身份)
- **证据库**:三类条目 —— 事实(已验证的结论)、教训(踩坑记录)、决策(为什么这么选);写手 agent 完成任务后,系统生成一条"是否沉淀为证据?"的建议消息,用户确认后写入;也可被 `@agent 引用 #证据ID` 查询

### 4.5 Skills 框架(`packages/api/src/skills/`)

- `skills/manifest.json` —— 技能清单:`{ id, 名称, 描述, 触发关键词, prompt 文件路径 }`
- 按需加载:消息内容命中触发关键词 → 把对应 prompt 注入该轮会话,不常驻
- 内置 3 个示例技能:TDD、代码审查(review)、调试(debug),prompt 文件放在 `skills/prompts/`

### 4.6 跨模型互审 + 审批流(`packages/api/src/approval/`)

状态机:`DRAFT(产出 diff)` → `REVIEWING(审查中)` → `APPROVED(已批准)` / `REJECTED(被打回)` → `APPLIED(已落地)`

- 写手 agent 完成任务 → 系统把 diff 打包成"审批卡片"(消息块:diff 摘要 + 改动文件 + 审查请求)
- 自动路由给审查 agent(默认与写手不同模型)→ 输出审查意见(问题列表/建议/结论)
- 前端展示卡片 → 用户批准/打回 → 批准后 diff 落地(写入线程的工作目录),打回则带意见回到写手

## 5. 典型数据流

1. 用户在 Web UI 的线程里发 `@claude 帮我实现 X`
2. API 解析 mention → Router 找到/创建 claude 会话 → 追加用户消息
3. `ClaudeAdapter` spawn CLI(`--resume`),stream-json 增量解析 → 每条增量经 WebSocket 推给前端,同时写 MessageStore
4. 完成信号 → 若任务产生 diff,进入审批流:`@gemini` 审查 → 审批卡片推前端
5. 用户批准 → diff 落地 → 线程状态更新
6. 关键结论由用户确认后写入证据库

## 6. 错误处理与可靠性

- **CLI 超时**:可配置(默认 5 分钟),超时 → 终止进程 → 会话状态标记 `terminated`,可手动重试(重试复用会话 ID 或新建)
- **CLI 崩溃/非零退出**:捕获 stderr 尾段 + 退出码,标记 `failed` 并展示给用户;不自动静默重试(第一版原则:失败要可见)
- **进程隔离**:每个(线程 × agent)一个独立 CLI 进程,崩溃不影响其他线程
- **Redis 故障**:启动时 `assertStorageReady` 检查,连接失败直接报错退出;运行中断连 → 接口返回 503,前端提示
- **会话状态机**:`idle / running / terminated / failed / completed`,所有状态迁移落 Redis(审计)

## 7. 测试策略

- **单元测试(vitest)**:路由解析、@mention 解析、状态机迁移、token 归一化 —— 全部用内存假存储,不依赖 Redis/CLI
- **Golden test(CLI 解析)**:真实跑一次三个 CLI 各录一份代表性输出样本存 `test/fixtures/`,测试里反复解析,保证解析器对真实格式稳定
- **集成冒烟(手动/脚本)**:`scripts/smoke.sh` —— 起 Redis + API,发一条真实消息给 claude,断言消息落库

## 8. 里程碑

| # | 内容 | 验收标准 |
|---|---|---|
| M1 | monorepo 骨架 + Fastify API + Redis 存储 + 线程/消息 + ClaudeAdapter | CLI 单线程对话跑通(curl/CLI 可测) |
| M2 | 身份与共享记忆(profile + 证据库 + 注入) | 重启 API 后 profile/证据仍在,注入生效 |
| M3 | Skills 框架(manifest + 按需加载) | 触发关键词后技能 prompt 出现在会话中 |
| M4 | 跨模型互审 + 审批流 | 写/审/批/落地全流程走通 |
| M5 | Web UI(Next.js 聊天 + 审批卡片 + WebSocket) | 浏览器完整演示 |
| M6 | 打磨:测试补全、README、演示脚本、简历文案 | 可上简历(见 docs/DEMO.md) |

## 9. 成功标准(Definition of Done)

1. `pnpm dev` 一条命令起全部(Redis + API + Web)
2. 浏览器里:开线程 → `@claude` 写代码 → 自动 `@gemini` 审查 → 审批卡片 → 批准落地
3. 重启后:agent 记忆(profile/证据)还在,线程可恢复
4. 技能按需出现,不常驻
5. 简历文案:能讲清架构(三层职责、端口-适配器、Provider 策略),每个组件都经得起深挖

## 10. 工程约定

- 目录:`~/code/meowbase`,`packages/{api,shared,web}`,`scripts/`
- 代码风格:biome 默认严格配置
- 提交规范:feat/fix/refactor/test/docs 前缀,中文或英文均可
- README:项目说明中注明"架构参考 clowder-ai(MIT)";若未来复制其代码片段必须保留版权声明(设计上避免直接复制)

## 11. 后续(非 v1)

GitHub 仓库发布(建议 M1 跑通后建,README 完整后公开)、docker-compose 一键部署、MCP 集成、IM 接入。
