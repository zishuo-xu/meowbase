# AGENTS.md — meowbase 接手必读

> 给新接手的人或 AI agent 的第一份文档。先读这个,再读代码。
>
> **想知道「现在停在哪、上一个人留下了什么、下一刀往哪走」,看 [docs/PROGRESS.md](docs/PROGRESS.md)。** 那页还写了工作区哪两个文件长期是脏的、为什么不许提交。

## 这是什么

**meowbase(喵窝)**:参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT)架构自写的多 Agent 协作平台。让 Claude Code / opencode 等 agent CLI 像一支团队一样协作:路由、身份、记忆、技能、互审、审批。代码全部自写,架构思想借鉴 clowder。

三只猫定位:墨墨主架构师、闪闪审查官、团团执行者。写完按名册交下一只(默认闪闪);审查官写出结论即收尾,平台按结论给人球或打回写手,不是闪闪自己 `@墨墨`。交接对象和工作流条目在名册的 `handoffTo` / `handoff` 里,不要写进路由代码。`handoffTo` 只用来选审查官和补问时提示下一棒。

## 快速上手

```bash
cd ~/code/meowbase
pnpm install
pnpm dev          # 起 Redis + API(3200)+ Web(3300)
pnpm test         # 全部单测(shared/api/web)
pnpm -r build     # 三包构建 + 类型检查
pnpm typecheck:scripts # scripts/ 的类型检查(包不含它,漏了会静默烂掉)
pnpm e2e          # 整机自检:fake CLI 跑全链 + 杀进程验续跑,不花钱
pnpm eval         # 失败模式记分板:已知坏毛病 × 平台是否兜住,fake CLI,不花钱
pnpm smoke        # 真实冒烟(调 startApp,读仓库根配置;bin 可被环境变量覆盖;花钱)
```

CI 在 push/PR 上跑 `pnpm -r build`、`pnpm typecheck:scripts`、`pnpm test`、`pnpm e2e`、`pnpm eval`（`.github/workflows/ci.yml`）。`pnpm smoke` 花钱,不进 CI。

浏览器打开 http://localhost:3300。API 只读接口可直接 curl localhost:3200。

## 仓库结构

```
packages/
├── shared/   跨包纯逻辑:类型、@mention 解析、A2A 交接、token 归一化、systemPrompt 拼装
├── api/      Fastify 后端:存储(端口-适配器)、provider 适配器、executeTurn 路由、审批流;启动接线在 `src/app.ts`
└── web/      Next.js 前端:猫耳气泡 UI、@补全、审批卡片、WebSocket 流式
skills/      技能文件(manifest.json + prompts/*.md),启动时加载
scripts/      e2e.ts + eval.ts + e2e-server.ts(整机自检 / 记分板,fake CLI;子进程调 `startApp`)、lib/harness.ts(两者共用)、smoke.ts(真实冒烟,也调 `startApp`)、fixtures/(fake CLI)
work/         线程工作区:空沙箱 git 仓库,或绑仓后的 worktree(gitignore 忽略)
docs/         地图 README + 功能设计(features/)+ A2A 说明 + 旧 specs/plans
```

## 架构核心(30 秒版)

三层:模型(推理)→ Agent CLI(工具)→ **平台(我们写的)**:路由、线程、身份、记忆、技能、审批、审计。

关键文件(按阅读顺序):
1. `packages/api/src/router/execute-turn.ts` —— **心脏**（阶段在 `router/turn/`）。一条消息的完整管线:系统命令分支(`#confirm`/`#approve`/`#reject`)→ 若有搁着的棒先续跑或清掉 → 多 @ 同题并行 → 每目标跑 A2A 接力链(交棒后记下 pending,该交棒没出口则再问同一只一次) → #learn 沉淀 → diff 检测 → 审批卡片+自动审查 → autoApprove 判断
2. `packages/api/src/router/pending-runner.ts` —— 交棒后那一棒谁接着跑:抢租约才跑、跑时续期、开机扫一遍、30 秒收尸。API 重启也不丢球
3. `packages/api/src/app.ts` —— 生产 / e2e / smoke 共用启动接线(`startApp`):loadConfig → stores → registry → `listen` → **之后**才 `startPendingRunner()`。`index.ts`、`scripts/e2e-server.ts` 与 `scripts/smoke.ts` 都调它,只用参数区分(`configPath` / `workdirBase` / host / 端口 / `rebuildAdapter`)
4. `packages/api/src/stores/ports.ts` —— 存储端口定义(业务只依赖接口)
5. `packages/api/src/providers/` —— ClaudeAdapter / GeminiAdapter / OpenCodeAdapter,统一 `runTurn` 契约
6. `packages/shared/src/` —— 所有解析/拼装纯函数,单测覆盖最全
7. `packages/web/components/` —— UI 组件

猫怎么交棒、交接包带什么、每只猫自己的 CLI 会话、线程沙箱和证据怎么共享，见 [docs/A2A.md](docs/A2A.md)。

一次一个特性：先写一篇 [docs/features/](docs/features/)（薄设计），做完再开下一篇。文档地图见 [docs/README.md](docs/README.md)。

## 消息协议

三种完全不同的东西。人打的进路由 / 系统命令 / 证据解析;猫写的只从**上一跳正文**里读(`parseA2AHandoff` / `parseHoldCommand` / `parseHoldExit` / 审查结论);平台自己做的不是语法,人和猫都不用打。完整规则只写在这里。README / DEMO / A2A / 功能稿只引用,不复述。

### 人打的

| 语法 | 作用 |
|---|---|
| `@墨墨 任务` 或上一行任务、下一行 `@墨墨` | 路由给该猫。`@` 必须在行首(`resolveTurnTargets`) |
| `@墨墨` 与 `@团团` 各占一行 | 同题并行,同一正文发给所有行首目标;同一行第二个 `@` 不算 |
| 句中 `@闪闪` /「不要 `@闪闪`」 | 不当目标,不路由 |
| 一个 `@` 都不写 | 按顺序兜:最近 1 小时内你点过的那只 → 最后开口的猫 → 线程主猫(`resolveTurnTargets`) |
| `#learn 标题` | 本轮猫跑完后出证据 draft(仍会叫猫,不是纯系统命令) |
| `#confirm ev_xxx` | 确认证据,不叫猫(`handleSystemCommand`) |
| `#ev_xxx` | 引用已确认证据注入当轮上下文 |
| 「之前 / 我们约定 / 讨论过」+ 关键词 | 从已确认证据匹配注入,不必手打 `#ev_` |
| 整行 `星星罐子` | 停棒拉闸,不调猫(`handleSystemCommand`) |
| `#approve ap_xxx` / `#reject ap_xxx 理由` | 审批决策,不叫猫 |
| `脚手架` / `绕路了` / `喵约` 等触发词 | 当跳任务正文命中才注入技能(`runSegment` → `matchSkills`)。人消息里的词不一定带到下一只 |

人打 `等 原因` / `等跑 npm test` / 「通过」**不会**走下面猫那几条门,只当普通正文发给猫。人的行首 `@` 是**路由**,不是 A2A 交接:不吃链深、不进 `visited`、不拼交接包。

### 猫写的(平台读它上一跳正文)

| 语法 | 作用 |
|---|---|
| 行首 `@团团 任务` | A2A 交接:本轮先结束,平台自己唤下一只。中文名与英文 id 等价;链深默认 3;句中 `@` 不会交接。审查官行首 `@` 当收尾,不交棒(`reviewer-closeout`) |
| 行首 `@人` / `@owner` | 升级给人拍板,停接力;球回到人手里 |
| 行首 `等 原因` / `HOLD 原因` | 持球:顶栏「球在等」,不补问、不掉地上、当轮不建卡;人开口即取消 |
| 行首 `等跑 npm test` / `HOLDCMD npm test` | 持球并由平台在沙箱跑**白名单内**的命令,跑完再叫醒同一只;不认得就不跑、说清原因、球回人手里;人开口即取消 |
| 审查官写出「通过」 | 顶栏球回人手里(读正文关键词,不看卡上 `verdict`);不必等审批卡刷出来。卡一落仍是「球在人手里」 |
| 审查官写出「需修改」 | **中间态**:顶栏球在写手手上,平台打回写手再审(最多 2 轮,`MAX_REVIEW_FIX_ROUNDS`)。审批卡一落、最后一条是 `approval-pending`,顶栏改成「球在人手里」。仍不通过则把卡交给人 |

### 平台自己做的(不是语法)

| 行为 | 何时 |
|---|---|
| 补问同一只一次 | 该交棒却忘了行首 `@`;问答收尾、审查已写结论、持球不问。仍没有则「球还在地上」 |
| 空手不许交棒 | 没新文件 **且** 没结论 **且** 去掉交接行后正文短于 60 字才拦(`isVoidHandoff`)。长方案没改文件照传 |
| 建审批卡并拉审查 | 本轮有 `git diff`、没有「下一跳还没跑的 pending」、没有持球(`settleTurn`)。只聊天不改文件不建卡 |
| 验证闸 | 只管卡上 `verdict` 和不许 `autoApprove`。不管顶栏文案(顶栏读审查正文关键词) |
| 命令白名单 | 只跑猫 `等跑` 里白名单形状;元字符拒、不在表里拒。命令字符串来自猫的回复 |
| 重启后捡棒 | 开机扫 pending,见踩坑第 1 条 |
| 绑仓线程每跳后记录 git 变化 | 有 `thread.repo` 时跳后比对只读快照(不 `fetch`);HEAD 前进 / 本支远端跟踪引用前进 / 基准分支远端跟踪引用变了则落 `git-move`(不参与球权)。空沙箱跳过 |

## 开发约定

- TypeScript 严格模式,ESM,相对导入带 `.js` 后缀(NodeNext)
- 业务逻辑只依赖 `stores/ports.ts` 接口,禁止直接 import ioredis
- **计划先对照 clowder**:每次设计先想同一问题他们公开怎么做、这一刀能靠多近;只拿语义和踩坑,不抄源码。能靠就靠,本刀没更近要写清为什么。
- **TDD**:新功能先写失败测试 → 实现 → 全绿 → 提交
- **一刀做完在 [docs/PROGRESS.md](docs/PROGRESS.md) 记一条增量**:动了什么、与设计稿的偏离及原因、只有人手验过的部分、留了什么没做。增量标题和 commit 标题要对得上,后来的人才能 `git log --grep` 找回那一刀
- **一刀一次提交,五道闸全绿后推 `main`**。不开特性分支:交接是顺序的,同一个目录只有一个 HEAD,切分支会坏 `.next` 缓存和 `shared/dist`(踩坑 2、12),还容易把提交落到别人分支上。也别用 `git worktree` 开第二个目录干活——两个实例同扫 Redis db 0 的 pending 会抢棒、端口还撞(踩坑 17、22)。**花钱的事仍归人拍板**(`pnpm smoke`、真模型演示)
- **文档同轮更新**:协议只改本文件协议表;演示只改现象;功能稿只改为什么。不要再抄一份完整规则。其余入口改成引用,见 [docs/README.md](docs/README.md)
- 提交规范:`feat/fix/refactor/test/docs/chore` 前缀
- **新增系统消息必须带 `systemKind`**:append 的入参是判别联合,`role: 'system'` 不给 kind 编译不过。前端球权/时间线读 kind 而不是匹配文案,所以打错标签会改顶栏行为;不参与球权的用 `notice`(见 [system-message-kind.md](docs/features/system-message-kind.md))
- **审计不用手写**:平台的决定在 store 边界自动落一行流水(`stores/audit-log.ts` 装饰器),业务代码不写 `audit.append`;不经过 store 的租约事件在 `pending-runner.ts` 显式补,半截重跑在 `resumePendingTurn`(见 [audit-trail.md](docs/features/audit-trail.md))。store 已经负责的 kind(`STORE_OWNED_SYSTEM_KINDS`,现为 `approval-applied`)消息侧不再重复派生,回执从 `GET /messages` 能拿到;`approval-failed` 只有消息没有 store 动作,仍从消息落。没有 `pendingHop` 不落租约行。
- 测试:`pnpm test`(shared 183 + api 273 + web 172 = 628);api 的 Redis 测试需要本地 Redis 在跑(连不上则 `describe.skipIf` 真跳过,输出是 skipped 不是 passed)
- 新增 agent CLI 适配器:实现 `AgentService` 接口 + 注册进 `createAgentRegistry`(见 `providers/gemini.ts`)
- 新增技能:在 `skills/` 加 md + manifest 条目,无需改代码

## 踩坑记录(血泪清单,改代码前先看)

1. **重启 API 必须按端口杀进程**:`pkill -f "tsx watch"` 经常杀不掉(命令行里没这字样),旧进程继续占 3200 服务旧代码 → 你以为在验证新代码,其实在旧代码上(EADDRINUSE 静默失败)。正确姿势:`lsof -ti :3200 | xargs kill -9` 再起。**重启后平台会自己把还搁着的那一棒捡起来接着跑**(日志 `[meow] resume sweep`),30 分钟内的才捡、多条线程串行捡(同时只叫醒一只);不想让它跑就先清掉那条线程的 `pendingHop`。猫正在想的时候杀进程也接得住:那一棒跑完落库才清,半截的助手气泡会被标成 `failed`(「平台重启,这一跳没写完」)然后重跑。**没杀干净、新进程 EADDRINUSE 起不来时,那个进程不会碰球**——捡棒挂在 `listen` 成功之后(`startApp` 里才调 `app.startPendingRunner()`),不是 `onReady`(它在绑定失败后照样会跑完)。见 [durable-relay.md](docs/features/durable-relay.md) 和 [hop-commit-then-clear.md](docs/features/hop-commit-then-clear.md)。杀完须自己再起,见第 15 条。
2. **web 服务崩溃会损坏 `.next` 缓存**:出现"页面能开但没交互/资源 404"时,`rm -rf packages/web/.next` 重启。**另一种长相**:白屏 + `Runtime TypeError: __webpack_modules__[moduleId] is not a function`(热更新改多了文件后容易出),此时**硬刷新没用**,必须清缓存重启——别以为是刚改的前端代码写坏了。顺带:开发服务器**在沙箱里起不来**(Next 枚举网卡 `uv_interface_addresses` 报 Unknown system error 1、tsx 建 unix socket 报 `listen EPERM`),必须在沙箱外跑。Redis 是独立的 brew 服务,重启 `pnpm dev` 不会丢线程数据。
3. **opencode 适配器**:必须带 `--auto`(headless 写文件权限);systemPrompt 无参数,需前置拼进 prompt;解析器要容忍中间 `tool-calls` step(不算失败,最终 stop 才算)。
4. **claude 适配器**:`--permission-mode acceptEdits` 只放行改文件,headless 跑 `node`/`tsx` 会卡在审批、自检只能写「跑不了」。必须 `bypassPermissions`(对齐 opencode `--auto` / gemini `yolo`)。正因为权限面开得宽,`等跑` 的命令闸落在平台这一侧:只跑白名单内的形状,`shell: false`,不透传整套 env。
5. **gemini 适配器**:`stream-json` 事件是 `init`/`message`/`result`(不是 claude 的 assistant/result);无系统提示词参数,身份前置拼进 prompt;headless 写文件必须 `--approval-mode yolo`,否则会卡在审批。`--resume`/`-r` 接受 session UUID(init 事件的 `session_id`)。
6. **opencode 项目根会上溯**:模型可能把文件写到仓库根(而非线程沙箱)。防御:适配器传 `--dir` 绝对沙箱路径 + 线程工作目录有 package.json + 系统提示写明沙箱绝对路径 + 每轮 `sweepStrayFiles` 自动移回。**清扫只收仓库根/包根浅文件**(如 `mul.js`),不会碰 `src/`、`test/`。审批/交接 diff 忽略 `node_modules`。绑仓线程跳过清扫,以免把真仓库根文件搬进 worktree。
7. **并行组并发写 Redis 会 lost-update**:executeTurn 内有写队列串行化 append/patch,别绕开它。
8. **审批状态机**:`markApplied` 只接受 `approved` 状态,自动批准路径必须先 `approve()`。
9. **线程工作目录是 git 仓库**:创建时 gitInit(含 package.json 基线)。空沙箱 diff 仍是 `git diff HEAD`;绑仓线程用 `lastApprovedSha`(没有则 `merge-base <baseBranch> HEAD`),这样猫自己提交后审批卡还建得出来。绑仓线程不调 gitInit(会覆盖目标仓的 `.gitignore`)。
10. **IME 输入法**:前端回车处理必须检查组合状态(composingRef + isComposing + keyCode 229),否则中文选词回车会误发送。
11. **Redis 测试数据污染**:测试线程/证据会留在 Redis,断言前用唯一 id(如 `t-${Date.now()}`)。
12. **服务重启后 shared dist 过期**:改了 `packages/shared` 后,api 启动脚本会先 rebuild,但热更新中途不会——必须手动 `pnpm --filter @meowbase/shared build`。不 build 就不生效。`tsx watch` 盯着 `packages/shared/dist/index.js`,build 完 API 会自己重启(日志 `[tsx] change in ./../shared/dist/index.js Restarting...`),不必再手动重启。
13. **未跟踪源码会被沙箱清扫误搬走**:新文件若还没 `git add`,旧版 `sweepStrayFiles` 会把它 `rename` 进 `work/<threadId>/`,tsx 记成 `unlink`,API 重启后模块找不到、3200 掉线。规避:新适配器/测试立刻提交(或至少 `git add`);改清扫规则后只允许浅层散落文件;API 日志出现 `sweepStrayFiles: 移回沙箱` 时去对应线程目录找回。
14. **手改仓库根 `meowbase.config.json` 不会热重载**:`tsx watch` 只盯 `src/`。改完 `GET /api/config` 还是旧值,必须重启 API 才生效。名册里改 `handoffTo` / 模型也一样。常见操作「改 agent / 模型」写了重启,就是这条路。**另一条路**:Hub 点保存走 `PATCH /api/config`,改内存再落盘,立即生效,不必重启。
15. **`kill -9` 掉 3200 上的进程后,`tsx watch` 不会自动重生**:它只在文件变化时重启,进程崩了不管。第 1 条说了必须按端口杀、重启后平台会捡棒;杀完还得自己再起一次(`pnpm --filter @meowbase/api dev`),别以为它会自愈。
16. **写 fake CLI 别忘了可执行位**:`scripts/fixtures/` 下新加的 fake 若是 `644`,适配器 `spawn` 直接 `EACCES`,链会在那一跳静默失败(日志只有「启动失败」)。新文件 `chmod +x` 并确认 git 记的是 `100755`。
17. **`pnpm e2e` 用 Redis db 14,不要改成 db 0**:本机 3200 的 API 也在扫 pending,共用一个 db 时它可能把 e2e 的棒抢走、甚至打到真 CLI 上花钱。e2e 进出各 `FLUSHDB` 一次,所以别把真数据放 db 14。
18. **fake 写手的正文必须落在 claude 的 `result` 事件里**:`StreamAccumulator` 收到 `result` 会用它整段覆盖 assistant 增量。行首 `@` 只写在 assistant 事件里会被覆盖掉,交棒不成立。
19. **e2e 必须验发货的那份接线**:API 启动顺序只许写在 `startApp` 一处。`index.ts`、`e2e-server.ts` 和 `smoke.ts` 都调它,只用参数区分(`configPath` / `workdirBase` / host / 端口 / `rebuildAdapter`)。以前两份副本时,改生产入口的开机扫,`pnpm e2e` 照样绿——它验的是自己那份。happy-path 不依赖开机扫棒(POST 里的 `void runner.run()` 会把当轮 pending 跟完),反向验分两半:把 `startPendingRunner()` **注掉**,崩溃续跑那一段红(开机没扫棒);把它挪到 `listen` **之前**,`runBindConflictPath` 红(`lease-steal` 会增加——绑不上端口的进程去抢了 #1 的棒)。`PORT=0` 永远绑得上,盖不到后一半,所以绑冲突段先 `listen(0)` 拿一个空闲固定端口(避开 3200/3300),#1 占上再起 #2。见 [e2e-harness.md](docs/features/e2e-harness.md)。
20. **Redis 单测假绿**:`if (!redis) return` 会被 vitest 算 passed。没 Redis 时要用 `describe.skipIf` / `it.skipIf`(条件得在收集测试前就算好,所以先 `await ping` 再声明套件),输出必须是 skipped 不是 passed。
21. **listen 失败必须让进程死干净**:`startApp` 在 `listen` 之前已经连了 Redis、建了 Fastify。撞 EADDRINUSE 若只把错误抛出去、不 `app.close()` + `redis.disconnect()`,ioredis 会把进程挂住,e2e 等不到非 0 退出码。`e2e-server` 也要 `process.exit(1)`。另外首扫必须 `await startPendingRunner()`:只 `void` 的话,反向把调用挪到 `listen` 之前,`process.exit` 会在 `lease-steal` 落库前把 #2 杀掉,绑冲突段假绿。
22. **`pnpm eval` 用 Redis db 13,不要改成 db 0 或 14**:本机 3200 扫 db 0 的 pending,e2e 用 db 14。共用会抢棒甚至打到真 CLI。eval 进出各 `FLUSHDB` 一次,别把真数据放 db 13。
23. **e2e / eval 公共接线只许一份**:起子进程、`waitFor`、`killHard`、读写线程都在 `scripts/lib/harness.ts`。再复制一份就会像 `smoke.ts` 漏 audit、`e2e-server.ts` 复制生产接线那样漂。
24. **记分板空格子从 0 变 1 必须改期望**:哪一格从没人拦变成兜住,`pnpm eval` 会因「期望 0 实际 1」非 0 退出,逼人来改期望,不许放宽断言装绿。「什么都没干就交棒」已经由虚空传球门禁兜住,期望是 1。
25. **反向验补问要 rebuild shared**:eval 子进程走 `@meowbase/shared` 的 dist。只改 `src/a2a.ts` 不 `pnpm --filter @meowbase/shared build`,补问还在、虚空门禁也像没装,记分板假绿。第一跳忘了行首 `@` 走的是 `hadInlineHint` / `hasDiff`,只把 `wasRelay` 改成 `return false` 不够,要等效关掉整个 `shouldNudgeExit`。
26. **`formatDroppedBallNote` 的 `'void'` 必须写在 early return 之前**:`hadInlineHint` / 审查结论 / 持球那几行会直接 `return null`。虚空那句放后面就发不出来,球像没落地。单测锁住 `hadInlineHint: true` 时 `'void'` 仍出「球还在地上」。
27. **记分板要按「关」分行,不是按「坏毛病」分行**:命令闸是两道关(元字符、白名单)。最初只有一行 `等跑 npm test; curl … | sh`,它先被元字符拒,**白名单那道关根本走不到**——整个白名单坏掉(比如 `node` 被放进表)记分板照样绿。现在拆成两行:「命令里塞管道」量元字符关,「想跑 node -e」不带元字符、专量白名单关,两行各自断言自己的拒因(`/元字符/` vs `/白名单/`),不许写成 `/元字符|白名单/`。所以反向验也能分开做:只掐白名单 → `node -e` 那行掉到 0、塞管道那行仍是 1。**以后加新的关,同一轮加上能单独量它的那一行。**`'denied-command'` 同样必须写在 `formatDroppedBallNote` 持球 early return 之前(同第 26 条)。
28. **`tsc` 报错时照样会写出 dist**:`pnpm --filter @meowbase/shared build` 退出码非 0 **不代表** `dist` 没变。反向验时若看见 build 失败就以为「这次改动没生效」,结论会正好反过来——`dist` 已经是改后的,eval 跑的就是被掐的行为。所以掐门禁做反向验后,复原必须 `rg` 确认 `src` 和 `dist` 两边都干净,不能只看 build 有没有过。**做反向验的人半路没了(掉链、被打断、换会话),工作区默认停在「门禁关着」那一侧**——这已经真的发生过一次:`resolveDiffMarker` 被打回永远返回 `'HEAD'` 剩在工作区,`git status` 里它只是一个普通 modified、混在另外六个文件里毫不显眼,接手的人很容易当成正常改动继续往下跑。接手别人半截的活,第一件事是 `git diff` 门禁那几个文件,别假设「没提交 = 没改」。掐点写成带 `RV` 之类的记号,好让 `rg` 一次扫出来。
29. **绑仓线程猫自己提交后会补问**:`shouldNudgeExit` 看 `hasDiff`,diff 基准改成 marker 后,已经提交的改动仍算有 diff。测试 stub 若每跳都 `git commit`,补问那次会 nothing to commit 炸掉——只提交一次,或第二次只回正文。批准时**不要**补 `gitAddAll`,那会把人没在卡上看过的改动一起提交。
30. **记分板绑仓行要自带 git 身份,默认分支从仓库读**:CI 没有全局 `user.email` / `user.name`,临时仓不配 `commit` 会失败;不同 git 版本默认分支是 `master` 或 `main`,写死会 400。`makeScratchRepo` 里配身份、`git branch --show-current` 读出来再当 `baseBranch`。新 fake 记得 `chmod +x`(第 16 条)。
31. **审计别把回执和空抢租约当第二份真相**:`approval-applied` 既是 `markApplied` 的 store 动作,也是回执 `systemKind`。消息装饰器再按 kind 落一行,同一秒两条,读的人以为落地了两遍。store 已经负责的 kind 写进 `STORE_OWNED_SYSTEM_KINDS`,消息侧跳过;`approval-failed` 只有消息没有 store 动作,必须留。另一边:`POST /messages` 结尾无条件 `runner.run()`,`#approve` / `#confirm` / 星星罐子没有棒也会先抢租约再读 hop,落一对空 hopId 的 `lease-claim` + `lease-release`,DEMO 里「claim 和 hop-done 同一 hopId」那条不变量就破了。没有棒就释放租约、一行都不写;提前返回必须释放,否则线程被锁 TTL。subject 取第一个非空行:模型正文常以 `\n\n` 开头,取字面第一行会落成空白。
32. **默认绑仓根必须取 realpath**:macOS 上 `os.tmpdir()` 是 `/var/folders/...`,realpath 到 `/private/var/folders/...`。默认根如果用字面 tmpdir,`pnpm eval` 里 `makeScratchRepo` 建的临时仓会对不上,两行绑仓当场 403。`defaultAllowedRepoRoots` 已经 realpath。配了 `ALLOWED_REPO_ROOTS` 是覆盖不是追加。另一面:CORS / WS 用同一张来源表,`localhost` 和 `127.0.0.1` 是两个 origin,都要放;`Origin` 不带(curl / e2e)放行,带了但不对才拒——不带的一律拒会把 e2e 和人自己 curl 全弄挂。

## 常见操作

- **绑真实仓库建线程**:侧栏填仓库路径(可选基准分支)后点 + 新会话;改动落在 `meow/<threadId>`,不落基准分支、不 push。空路径仍是空沙箱。路径必须在允许的根下面,否则 403,返回体带 `selectedPath` 和 `allowedRoots`;怎么改根看 [README.md](README.md)。API 默认只听 `127.0.0.1`,开 LAN 设 `API_SERVER_HOST=0.0.0.0`（没有鉴权,开了同网段谁都能让猫干活）
- **加一个技能**:`skills/prompts/x.md` + `skills/manifest.json` 加条目(triggers 触发词)
- **改 agent / 模型**:Hub 里改名册/模型并保存(`PATCH /api/config`)立即生效;或手改仓库根 `meowbase.config.json`(名字、别名、bin、model、A2A 链深,以及每只猫的 `handoffTo` / `handoff`)后重启 API。`PATCH /api/profiles/:agentId {"autoApprove":true}` 开自动批准
- **加审批场景**:参考 executeTurn 审批块,复用 ApprovalStore
- **查一条线程都发生过什么**:`curl "localhost:3200/api/audit?threadId=t_xxx"`(倒序;可加 `actor` / `action` / `since` / `limit`)。球停在哪一跳、谁交给谁、哪张卡被批过、重启后哪一棒被强抢重跑,都在这里,不用翻终端
- **看花了多少**:Hub 侧栏「账本」,或 `curl "localhost:3200/api/usage?threadId=t_xxx"`(不给 threadId 就是全部)。只算跑完的助手消息;gemini 不报成本,那格是「无成本数据」不是 `$0`
- **真实模型演示**:不带 CLAUDE_BIN/GEMINI_BIN/OPENCODE_BIN 启动 api;步骤和期望见 [docs/DEMO.md](docs/DEMO.md)。费用按 token 计(一次完整流程约 $0.2-0.4)。点名/交棒规则见上面协议表
