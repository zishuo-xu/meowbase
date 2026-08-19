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

CI 在 push/PR 上跑 `pnpm -r build` 与 `pnpm test`（`.github/workflows/ci.yml`）。

浏览器打开 http://localhost:3300。API 只读接口可直接 curl localhost:3200。

## 仓库结构

```
packages/
├── shared/   跨包纯逻辑:类型、@mention 解析、A2A 交接、token 归一化、systemPrompt 拼装
├── api/      Fastify 后端:存储(端口-适配器)、provider 适配器、executeTurn 路由、审批流
└── web/      Next.js 前端:猫耳气泡 UI、@补全、审批卡片、WebSocket 流式
skills/      技能文件(manifest.json + prompts/*.md),启动时加载
scripts/      smoke.ts(真实冒烟)、fixtures/(fake CLI,测试/演示用)
work/         线程工作区:空沙箱 git 仓库,或绑仓后的 worktree(gitignore 忽略)
docs/         地图 README + 功能设计(features/)+ A2A 说明 + 旧 specs/plans
```

## 架构核心(30 秒版)

三层:模型(推理)→ Agent CLI(工具)→ **平台(我们写的)**:路由、线程、身份、记忆、技能、审批。

关键文件(按阅读顺序):
1. `packages/api/src/router/execute-turn.ts` —— **心脏**（阶段在 `router/turn/`）。一条消息的完整管线:系统命令分支(`#confirm`/`#approve`/`#reject`)→ 多 @ 同题并行 → 每目标跑 A2A 接力链(该交棒没出口则再问同一只一次) → #learn 沉淀 → diff 检测 → 审批卡片+自动审查 → autoApprove 判断
2. `packages/api/src/router/pending-runner.ts` —— 交棒后那一棒谁接着跑:抢租约才跑、跑时续期、开机扫一遍、30 秒收尸。API 重启也不丢球
3. `packages/api/src/stores/ports.ts` —— 存储端口定义(业务只依赖接口)
4. `packages/api/src/providers/` —— ClaudeAdapter / GeminiAdapter / OpenCodeAdapter,统一 `runTurn` 契约
5. `packages/shared/src/` —— 所有解析/拼装纯函数,单测覆盖最全
6. `packages/web/components/` —— UI 组件

猫怎么交棒、交接包带什么、每只猫自己的 CLI 会话、线程沙箱和证据怎么共享，见 [docs/A2A.md](docs/A2A.md)。

一次一个特性：先写一篇 [docs/features/](docs/features/)（薄设计），做完再开下一篇。文档地图见 [docs/README.md](docs/README.md)。

## 消息协议(用户可用)

| 语法 | 作用 |
|---|---|
| `@墨墨 任务` 或上一行任务、下一行 `@墨墨` | 单角色执行(自动触发审批流拉审查);`@` 必须在行首 |
| `@墨墨` 与 `@团团` 各占一行 | 同题并行(同一正文发给所有行首目标);同一行第二个 `@` 不算 |
| 句中 `@闪闪` /「不要 `@闪闪`」 | 不当目标,不路由 |
| 回复中行首 `@团团 任务` | A2A 接力:本轮先结束,平台自己唤下一只。中文名与英文 id 等价;链深默认 3;句中 @ 不会交接 |
| 回复无行首 `@` 且该交棒 | 平台再问同一只一次补出口;仍没有则「球还在地上」。问答收尾、审查已写结论不问 |
| 回复中行首 `@人` / `@owner` | 升级给人拍板,停接力;球回到人手里 |
| 审查官写出「通过」 | 顶栏球回人手里;不必等审批卡刷出来 |
| 审查官写出「需修改」 | 顶栏球在写手手上;平台打回后再审 |
| 行首 `等 原因` / `HOLD 原因` | 持球:顶栏「球在等」,不补问、不掉地上、当轮不建卡;人开口即取消 |
| 行首 `等跑 npm test` / `HOLDCMD npm test` | 持球并由平台在沙箱跑命令,跑完再叫醒同一只;人开口即取消 |
| `#learn 标题` | 请求沉淀本轮回复为证据(draft) |
| `#confirm ev_xxx` | 确认证据 |
| `#ev_xxx` | 引用历史证据注入上下文 |
| 「之前 / 我们约定 / 讨论过」+ 关键词 | 从已确认证据里匹配并注入,不必手打 `#ev_` |
| 整行 `星星罐子` | 停棒拉闸,不调猫,球回人手里 |
| `脚手架` / `绕路了` / `喵约` | 当轮注入对应技能,猫停下来对照 |
| `#approve ap_xxx` / `#reject ap_xxx 理由` | 审批决策 |
| `#learn` + diff | 写手改动文件 → 自动建审批卡片 → 另一 agent 审查。刚交棒、下一跳未跑时本轮不建卡 |

## 开发约定

- TypeScript 严格模式,ESM,相对导入带 `.js` 后缀(NodeNext)
- 业务逻辑只依赖 `stores/ports.ts` 接口,禁止直接 import ioredis
- **计划先对照 clowder**:每次设计先想同一问题他们公开怎么做、这一刀能靠多近;只拿语义和踩坑,不抄源码。能靠就靠,本刀没更近要写清为什么。
- **TDD**:新功能先写失败测试 → 实现 → 全绿 → 提交
- **文档同轮更新**:改协议或用户可见行为时,同一轮改 `AGENTS.md` 协议表、`README.md`、`docs/DEMO.md`、对应 `docs/features/` 设计稿,不要留到下次
- 提交规范:`feat/fix/refactor/test/docs/chore` 前缀
- **新增系统消息必须带 `systemKind`**:append 的入参是判别联合,`role: 'system'` 不给 kind 编译不过。前端球权/时间线读 kind 而不是匹配文案,所以打错标签会改顶栏行为;不参与球权的用 `notice`(见 [system-message-kind.md](docs/features/system-message-kind.md))
- **审计不用手写**:平台的决定在 store 边界自动落一行流水(`stores/audit-log.ts` 装饰器),业务代码不写 `audit.append`;不经过 store 的租约事件在 `pending-runner.ts` 显式补(见 [audit-trail.md](docs/features/audit-trail.md))
- 测试:`pnpm test`(shared 140 + api 247 + web 159 ≈ 546);api 的 Redis 测试需要本地 Redis 在跑(未启动则自动跳过)
- 新增 agent CLI 适配器:实现 `AgentService` 接口 + 注册进 `createAgentRegistry`(见 `providers/gemini.ts`)
- 新增技能:在 `skills/` 加 md + manifest 条目,无需改代码

## 踩坑记录(血泪清单,改代码前先看)

1. **重启 API 必须按端口杀进程**:`pkill -f "tsx watch"` 经常杀不掉(命令行里没这字样),旧进程继续占 3200 服务旧代码 → 你以为在验证新代码,其实在旧代码上(EADDRINUSE 静默失败)。正确姿势:`lsof -ti :3200 | xargs kill -9` 再起。**重启后平台会自己把还搁着的那一棒捡起来接着跑**(日志 `[meow] resume sweep`),30 分钟内的才捡、一次只捡一棒;不想让它跑就先清掉那条线程的 `pendingHop`。猫正在想的时候杀进程也接得住:那一棒跑完落库才清,半截的助手气泡会被标成 `failed`(「平台重启,这一跳没写完」)然后重跑。**没杀干净、新进程 EADDRINUSE 起不来时,那个进程不会碰球**——捡棒挂在 `listen` 成功之后(`app.startPendingRunner()`),不是 `onReady`(它在绑定失败后照样会跑完)。见 [durable-relay.md](docs/features/durable-relay.md) 和 [hop-commit-then-clear.md](docs/features/hop-commit-then-clear.md)。杀完须自己再起,见第 15 条。
2. **web 服务崩溃会损坏 `.next` 缓存**:出现"页面能开但没交互/资源 404"时,`rm -rf packages/web/.next` 重启。
3. **opencode 适配器**:必须带 `--auto`(headless 写文件权限);systemPrompt 无参数,需前置拼进 prompt;解析器要容忍中间 `tool-calls` step(不算失败,最终 stop 才算)。
4. **claude 适配器**:`--permission-mode acceptEdits` 只放行改文件,headless 跑 `node`/`tsx` 会卡在审批、自检只能写「跑不了」。必须 `bypassPermissions`(对齐 opencode `--auto` / gemini `yolo`)。
5. **gemini 适配器**:`stream-json` 事件是 `init`/`message`/`result`(不是 claude 的 assistant/result);无系统提示词参数,身份前置拼进 prompt;headless 写文件必须 `--approval-mode yolo`,否则会卡在审批。`--resume`/`-r` 接受 session UUID(init 事件的 `session_id`)。
6. **opencode 项目根会上溯**:模型可能把文件写到仓库根(而非线程沙箱)。防御:适配器传 `--dir` 绝对沙箱路径 + 线程工作目录有 package.json + 系统提示写明沙箱绝对路径 + 每轮 `sweepStrayFiles` 自动移回。**清扫只收仓库根/包根浅文件**(如 `mul.js`),不会碰 `src/`、`test/`。审批/交接 diff 忽略 `node_modules`。绑仓线程跳过清扫,以免把真仓库根文件搬进 worktree。
7. **并行组并发写 Redis 会 lost-update**:executeTurn 内有写队列串行化 append/patch,别绕开它。
8. **审批状态机**:`markApplied` 只接受 `approved` 状态,自动批准路径必须先 `approve()`。
9. **线程工作目录是 git 仓库**:创建时 gitInit(含 package.json 基线),diff 检测靠 `git diff HEAD`。绑仓线程不调 gitInit(会覆盖目标仓的 `.gitignore`)。
10. **IME 输入法**:前端回车处理必须检查组合状态(composingRef + isComposing + keyCode 229),否则中文选词回车会误发送。
11. **Redis 测试数据污染**:测试线程/证据会留在 Redis,断言前用唯一 id(如 `t-${Date.now()}`)。
12. **服务重启后 shared dist 过期**:改了 `packages/shared` 后,api 启动脚本会先 rebuild,但热更新中途不会——改 shared 后需重启 api 或手动 `pnpm --filter @meowbase/shared build`。
13. **未跟踪源码会被沙箱清扫误搬走**:新文件若还没 `git add`,旧版 `sweepStrayFiles` 会把它 `rename` 进 `work/<threadId>/`,tsx 记成 `unlink`,API 重启后模块找不到、3200 掉线。规避:新适配器/测试立刻提交(或至少 `git add`);改清扫规则后只允许浅层散落文件;API 日志出现 `sweepStrayFiles: 移回沙箱` 时去对应线程目录找回。
14. **`meowbase.config.json` 改了不会热重载**:文件在仓库根,`tsx watch` 只盯 `src/`。改完 `GET /api/config` 还是旧值,必须重启 API 才生效。名册里改 `handoffTo` / 模型也一样。常见操作「改 agent / 模型」写了重启,就是这个原因。
15. **`kill -9` 掉 3200 上的进程后,`tsx watch` 不会自动重生**:它只在文件变化时重启,进程崩了不管。第 1 条说了必须按端口杀、重启后平台会捡棒;杀完还得自己再起一次(`pnpm --filter @meowbase/api dev`),别以为它会自愈。

## 常见操作

- **绑真实仓库建线程**:侧栏填仓库路径(可选基准分支)后点 + 新会话;改动落在 `meow/<threadId>`,不落基准分支、不 push。空路径仍是空沙箱
- **加一个技能**:`skills/prompts/x.md` + `skills/manifest.json` 加条目(triggers 触发词)
- **改 agent / 模型**:编辑仓库根 `meowbase.config.json`(名字、别名、bin、model、A2A 链深,以及每只猫的 `handoffTo` / `handoff`),重启 API;`PATCH /api/profiles/:agentId {"autoApprove":true}` 开自动批准
- **加审批场景**:参考 executeTurn 审批块,复用 ApprovalStore
- **查一条线程都发生过什么**:`curl "localhost:3200/api/audit?threadId=t_xxx"`(倒序;可加 `actor` / `action` / `since` / `limit`)。球停在哪一跳、谁交给谁、哪张卡被批过、重启后哪一棒被强抢重跑,都在这里,不用翻终端
- **看花了多少**:Hub 侧栏「账本」,或 `curl "localhost:3200/api/usage?threadId=t_xxx"`(不给 threadId 就是全部)。只算跑完的助手消息;gemini 不报成本,那格是「无成本数据」不是 `$0`
- **真实模型演示**:不带 CLAUDE_BIN/GEMINI_BIN/OPENCODE_BIN 启动 api;步骤和期望见 [docs/DEMO.md](docs/DEMO.md)。费用按 token 计(一次完整流程约 $0.2-0.4)。人和猫都只认行首 `@`;句中「不要 `@闪闪`」不会叫它
