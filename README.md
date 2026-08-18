# Meowbase(喵窝)

> **愿景**:让 AI 不再是被调用的工具,而是一支有身份、有记忆、有纪律的团队。人可以只表达"要什么",分工、协调、互审、决策,都交给团队自己完成。
>
> **现状**:M1–M6 已闭环。人说目标 → 墨墨写+自检 → 行首交闪闪 → 审批卡 → 人批准落地。忘了行首 `@` 且该交棒时,平台再问同一只一次。顶栏显示球在谁手上;审查通过后球回人,需修改则球在写手手上;行首 `等` 持球;`@人` 可升级拍板;接力条可点开交接包。说「之前约定」会召回已确认证据;整行 `星星罐子` 停棒。架构参考 clowder-ai,代码独立实现。和他们的差别:我们是**一场接力**,不是猫窝操作系统(不做邮箱/SOP/MCP)。演示与口播见 [docs/DEMO.md](docs/DEMO.md)。猫怎么交棒、传什么、各自记什么、公共记什么，见 [docs/A2A.md](docs/A2A.md)。功能一篇一刀，见 [docs/features/](docs/features/)。

多 Agent 协作平台:让 Claude Code / Gemini CLI / opencode 三支 agent CLI 像一支团队一样协作。
架构参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT),代码为独立实现。

## 快速开始

```bash
pnpm install
pnpm dev   # 起 Redis + API(3200)+ Web(3300)
```

浏览器打开 http://localhost:3300:线程管理、猫耳气泡聊天、审批卡片(点卡片批准/打回)、证据确认、团队 Hub 看能力表并配模型和密钥。
(API 需要本机 Redis;冒烟/演示可设 CLAUDE_BIN / GEMINI_BIN / OPENCODE_BIN 指向 fake CLI)

```bash
# 仅 API:
pnpm --filter @meowbase/api dev
```

创建线程并让 claude 干活:

```bash
curl -X POST localhost:3200/api/threads \
  -H 'content-type: application/json' \
  -d '{"title":"hello","primaryAgentId":"claude"}'
# 记录返回的 id,然后:
curl -X POST localhost:3200/api/threads/<id>/messages \
  -H 'content-type: application/json' \
  -d '{"content":"@claude 用一句话介绍你自己"}'
```

## 架构(一页)

三层:模型(推理)→ Agent CLI(工具)→ **平台**(路由 / 线程 / 身份 / 记忆 / 技能 / 审批 / 审计)。平台不推理。

| 落点 | 职责 |
|---|---|
| `executeTurn` | 一条消息的心脏:命令 → 多 @ 并行 → A2A 链 → 记忆 → diff 审批。协作细节见 [docs/A2A.md](docs/A2A.md) |
| `stores/ports.ts` | 业务只依赖接口,Redis 可换 |
| 名册 `handoffTo` / `handoff` | 交给谁、何时交,写在配置里,不写 `if (墨墨)` |
| Provider 适配器 | claude / gemini / opencode,统一 `runTurn` |

定位:墨墨主架构师、闪闪审查官、团团执行者。写完默认交闪闪审。演示步骤见 [docs/DEMO.md](docs/DEMO.md)。A2A 怎么传信息、怎么隔离上下文，见 [docs/A2A.md](docs/A2A.md)。设计理由与面试提纲见 [docs/features/](docs/features/)。

## 审批流(M4)

- 写手 agent 改动文件后,平台自动生成审批卡片并请另一 agent 审查。刚交棒、下一跳还没跑时本轮不建卡
- 在卡片上点「批准落地」或「打回」(也可发 `#approve` / `#reject`)
- `tsconfig.tsbuildinfo`、`.DS_Store` 等缓存文件不会出卡

## Skills(M3)

消息中带触发词(如 "tdd"、"review"、"debug")时,对应技能会注入该轮上下文:

- `tdd` / `测试驱动` → 测试驱动开发
- `review` / `审查` / `代码评审` → 代码审查
- `debug` / `调试` / `bug` → 系统化调试

## 配置

`.env` / 环境变量只管 Redis、端口、超时。**猫是谁、用哪条 CLI、什么模型**写在仓库根 `meowbase.config.json`。也可以在页面里打开 **团队 Hub** 改名册和模型目录,保存后立即生效,不必重启 API。

```json
{
  "a2a": { "maxDepth": 3 },
  "defaultAgentId": "claude",
  "models": [
    { "id": "claude-sonnet", "label": "Claude Sonnet", "bins": ["claude", "opencode"], "protocol": "anthropic", "model": "sonnet" },
    { "id": "gemini-pro", "label": "Gemini Pro", "bins": ["gemini", "opencode"], "protocol": "gemini", "model": "gemini-2.5-pro" },
    { "id": "flash", "label": "DeepSeek Flash", "bins": ["opencode"], "protocol": "openai", "model": "opencode-go/deepseek-v4-flash" }
  ],
  "agents": [
    { "id": "opencode", "name": "团团", "aliases": ["团团", "opencode"], "bin": "opencode", "modelId": "flash", "handoffTo": "gemini" }
  ]
}
```

第三方模型在 Hub 填网关 URL 和 API Key。密钥写入本机 `meowbase.secrets.json`(已 gitignore),不会进仓库。
环境变量仍可覆盖单字段:`CLAUDE_BIN` / `GEMINI_BIN` / `OPENCODE_BIN`、`GEMINI_MODEL` / `OPENCODE_MODEL`、`A2A_MAX_DEPTH`。
`GET /api/config` 返回合并后的名册。手动改 json 后仍需重启 API;Hub 里点保存是热更新。

## 人怎么下任务,猫怎么交接

对齐 clowder F046:**只有另起一行、行首的 `@名字` 才会路由**。

```
帮我把加法做成可测的
@墨墨
先写失败测试再实现
```

同题并行也是各占一行:

```
@墨墨
@团团
同一道题
```

- 人和猫都只认行首 `@`。句中「不要 `@闪闪`」不会叫它;同一行 `@墨墨 @团团` 只叫墨墨
- 猫回复里行首 `@闪闪 请审查` = **A2A 接力**:本轮先结束,平台自己唤闪闪;插入可点开的 `🤝 接力:墨墨 → 闪闪`
- 猫回复里行首 `@人` / `@owner` = **升级给人拍板**,停链,顶栏「球在人手里」
- 句中写「请 @团团 看看」**不会交接**;该交棒却没行首 `@` 时,平台再问同一只一次,仍没有才提示「球还在地上」
- 链深默认 3(可配),已出场的猫不再回来(防环)
- 下一棒看到的是平台拼的交接包 + 同一沙箱,不是另一只猫的 CLI 聊天记录。展开见 [docs/A2A.md](docs/A2A.md)

## 多角色协作

- **跨模型审查**:写手改动默认请闪闪审;墨墨写完应 `@闪闪`,团团做完也交闪闪
- 分工由猫们自己协调,你不必当"路由器"

## 消息协议(M2)

- `#learn <标题>` —— 请求沉淀本轮回复为证据,系统会给出确认提示
- `#confirm ev_xxxxxxxx` —— 确认沉淀
- `#ev_xxxxxxxx` —— 在消息中引用历史证据,注入 agent 上下文
- 说「之前我们约定 / 讨论过」+ 关键词 —— 从已确认证据匹配注入,可跨线程
- 行首 `等 原因` / `HOLD 原因` —— 猫持球,顶栏「球在等」,人开口即取消
- 整行 `星星罐子` —— 停棒拉闸,不调猫
- `脚手架` / `绕路了` / `喵约` —— 当轮注入对照技能
- 三个 agent 有内置身份(墨墨/闪闪/团团),新会话自动注入

## 测试

```bash
pnpm test              # 单测(内存存储,不依赖 Redis/CLI)
pnpm smoke             # 真实冒烟(需要 Redis + claude CLI)
```

> 提示:冒烟需要 claude CLI 可用(能正常认证)。若 CLI 配置了中转/自定义 provider,请先确保 key 有效。
