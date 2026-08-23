# Meowbase(喵窝)

> **愿景**(还不是现状):让 AI 不再是被调用的工具,而是一支有身份、有记忆、有纪律的团队。人可以只表达"要什么",分工、协调、互审、决策,都交给团队自己完成。
>
> **现状**:猫按名册交棒;忘了行首 `@`、有文件改动、或要拍板时,平台和人还在场(补问、建卡、批卡、`#confirm`)。完整协议见 [AGENTS.md](AGENTS.md) 协议表。API 重启或猫想到一半被杀,那一棒会被自己捡起来重跑;平台的每个决定落一行审计流水,花掉的 token 和钱在侧栏「账本」按猫看。架构参考 clowder-ai,代码独立实现。和他们的差别在形态和进度:我们先做成**一场接力**,邮箱/SOP/MCP 那套还没有,按迭代节奏再说。演示与口播见 [docs/DEMO.md](docs/DEMO.md)。猫怎么交棒、传什么、各自记什么、公共记什么，见 [docs/A2A.md](docs/A2A.md)。功能一篇一刀，已落地 31 篇，见 [docs/features/](docs/features/)。

多 Agent 协作平台:让 Claude Code / Gemini CLI / opencode 三支 agent CLI 像一支团队一样协作。
架构参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT),代码为独立实现。

## 快速开始

```bash
pnpm install
pnpm dev   # 起 Redis + API(3200)+ Web(3300)
```

浏览器打开 http://localhost:3300:线程管理、猫耳气泡聊天、审批卡片(点卡片批准/打回)、证据确认、团队 Hub 看能力表、配模型和密钥、侧栏「账本」按猫看 token 和花费。建会话时可填真实仓库路径,改动落在线程分支 `meow/<id>`；猫可以 push 自己这根、对自己这根开 PR,碰基准分支或把 PR 合进去则停接力、球回人。路径必须落在允许的根下面(默认家目录 + 临时目录,都已 realpath);不在范围内会 403,并告诉你现在允许哪些根。规则见 [AGENTS.md](AGENTS.md) 协议表。
(API 需要本机 Redis;冒烟/演示可设 CLAUDE_BIN / GEMINI_BIN / OPENCODE_BIN 指向 fake CLI)

API 默认只听 `127.0.0.1`,**本机自用是唯一推荐的用法**。`API_SERVER_HOST=0.0.0.0` 能开 LAN,但**不建议**:平台没有鉴权,开了等于同网段谁都能让猫在你的仓库里干活。手机上界面也没适配(侧栏固定宽度,窄屏会挤掉聊天区)。CORS / WebSocket 只放行本机 web(`http://localhost:3300` 和 `http://127.0.0.1:3300`;`NEXT_PUBLIC_API_URL` 指到别处时会带上那个主机的 web 端口)。想收紧或换绑仓根:环境变量 `ALLOWED_REPO_ROOTS` 按 `,` 或 `:` 分隔,配了就是覆盖不是追加。

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
| `executeTurn` | 一条消息的心脏:命令 → 若有搁着的棒先续跑 → 多 @ 并行 → A2A 链 → 记忆 → diff 审批。协作细节见 [docs/A2A.md](docs/A2A.md) |
| `stores/ports.ts` | 业务只依赖接口,Redis 可换 |
| 名册 `handoffTo` / `handoff` | 交给谁、何时交,写在配置里,不写 `if (墨墨)` |
| Provider 适配器 | claude / gemini / opencode,统一 `runTurn` |
| 审计流水 | 平台的决定在 store 边界自动落存根,`GET /api/audit?threadId=` 可查:谁交给谁、哪张卡被批过、重启后哪一棒被重跑 |
| 账本 | `GET /api/usage?threadId=` 按猫聚合已跑完的 token 和花费;Hub 侧栏「账本」展示。gemini 不报成本则写「无成本数据」 |

定位:墨墨主架构师、闪闪审查官、团团执行者。写完默认交闪闪审。演示步骤见 [docs/DEMO.md](docs/DEMO.md)。A2A 怎么传信息、怎么隔离上下文，见 [docs/A2A.md](docs/A2A.md)。设计理由与面试提纲见 [docs/features/](docs/features/)。

**难在哪、凭什么说它没坏**（六个真问题 + 三层证明 + 哪些只有人手验过）见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 审批流

- 写手改了文件、链停了、没持球时,平台建审批卡并拉审查(条件见 [AGENTS.md](AGENTS.md) 协议表「平台自己做的」)
- 在卡片上点「批准落地」或「打回」(也可发 `#approve` / `#reject`)
- `tsconfig.tsbuildinfo`、`.DS_Store` 等缓存文件不会出卡

## Skills

当跳任务正文命中触发词(如 "tdd"、"review"、"debug")时,对应技能会注入这一跳。人消息里的词不一定带到下一只。目录:

- `tdd` / `测试驱动` → 测试驱动开发
- `review` / `审查` / `代码评审` → 代码审查
- `debug` / `调试` / `bug` → 系统化调试
- `脚手架` / `绕路了` / `喵约` → 当轮注入对照技能(人喊才出现)
- 自检门无触发词、每轮都注入

## 配置

`.env` / 环境变量只管 Redis、端口、超时。**猫是谁、用哪条 CLI、什么模型**写在仓库根 `meowbase.config.json`。也可以在页面里打开 **团队 Hub** 改名册和模型目录:保存走 `PATCH /api/config`,改内存再落盘,立即生效,不必重启。手改仓库根那份 json 则必须重启(`tsx watch` 只盯 `src/`)。

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
`GET /api/config` 返回合并后的名册。两条路不要混:Hub 保存是热更新;手改仓库根 json 必须重启。

## 人怎么下任务

对齐 clowder F046:**只有另起一行、行首的 `@名字` 才会路由**。完整协议(谁打什么、猫写什么、平台自己做什么)见 [AGENTS.md](AGENTS.md) 协议表。

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

下一棒看到的是平台拼的交接包 + 同一沙箱,不是另一只猫的 CLI 聊天记录。展开见 [docs/A2A.md](docs/A2A.md)。

除了点名,人还能打这几样。这里只列**有什么**,规则和边界都在 [AGENTS.md](AGENTS.md) 协议表:

- `#learn 标题` → `#confirm ev_xxx` —— 把这轮结论沉淀成公共证据。**人确认才进**,猫说了不算
- 说「之前我们约定…」—— 从已确认证据里召回,不必手打 `#ev_`;可跨线程
- 整行 `星星罐子` —— 拉闸,本轮不再叫猫
- `#approve ap_xxx` / `#reject ap_xxx 理由` —— 审批决策(也可以直接在卡片上点)

## 多角色协作

- 默认名册是墨墨 → 闪闪;`selectReviewer` 只看 `handoffTo` 和谁还活着,不看 bin / 模型。三只可以挂同一条 CLI;是否跨模型取决于配置
- 猫按名册交。漏交、有文件、或要拍板时,平台和人还在场(补问、建卡、批卡)。「你不必当路由器」是愿景,不是现状

## 测试

```bash
pnpm test              # 全部单测(shared/api/web);api 的 Redis 测试需本机 Redis,连不上则真跳过(skipped,不是 passed)
pnpm typecheck:scripts # scripts/ 的类型检查(三个包的 build 不覆盖它)
pnpm e2e               # 整机自检:fake CLI 跑通全链 + 杀进程验续跑 + 绑不上端口不抢租约,不花钱
pnpm eval              # 失败模式记分板:已知坏毛病 × 平台兜住率,fake CLI,不花钱
pnpm smoke             # 真实冒烟:调 startApp,读仓库根配置;bin 可被 CLAUDE_BIN / GEMINI_BIN / OPENCODE_BIN 覆盖。脚本点的是 @claude,还要审查官那一跳,配置里挂了哪几条真实 CLI 就得哪几条能跑。需要本机 Redis,花钱,不进 CI
```

> 提示:冒烟走真实 CLI(能正常认证)。若 CLI 配置了中转/自定义 provider,请先确保 key 有效。
