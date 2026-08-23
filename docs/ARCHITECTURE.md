# 这场接力怎么站住

给面试官和读简历的人。下面每个论断都能追到函数或测试；追不到的没写。

## 这是什么

喵窝让 Claude Code、Gemini CLI、opencode 这些 agent CLI 像一支小队接力干活。人说要什么。平台管路由、身份、记忆、技能、审批、审计。**平台自己不推理**——它不写代码、不审 diff、不替猫选下一句。

架构参考 [clowder-ai](https://github.com/zts212653/clowder-ai)（MIT）的公开设计，代码独立实现。差别是形态：他们是猫窝操作系统（邮箱、SOP、MCP）。喵窝是**一场接力**：一只做完，平台把棒交给下一只。

## 三层，平台站哪一侧

模型推理 → Agent CLI 动工具 → 平台（我们写的）当邮差。

平台只做：点名谁开口、记下这一棒、注入身份和技能、沉淀人确认过的证据、看 diff 建审批卡、落审计。交给谁、何时交，写在名册的 `handoffTo` / `handoff` 里（`catalog.ts`）。选审查官的 `selectReviewer`（`pairing.ts`）只看名册里谁还活着，不看 bin、不看模型。默认名册是三只猫：墨墨写、闪闪审、团团跑。换人、换模型、换谁审谁，都是改配置——代码里没有 `if (墨墨)`。

协议只从**猫的上一跳正文**解析：行首 `@` 交棒、`@人` 升级、行首 `等` / `等跑`、写出「通过」「需修改」（`segment.ts` 里 `prevContent = hopResult.content`）。人打的是另一套，两套不共享入口——同样一句 `等跑 npm test`，猫写了平台就去沙箱跑，人写了只当普通正文发给猫。人能打哪些、各自边界在哪，完整清单在 [AGENTS.md](../AGENTS.md) 协议表，这里不复述：一份规则维护在两处，早晚有一处是错的。

审查官行首 `@` 当收尾（`reviewer-closeout`），不交回写手。通过 → 球给人；需修改 → **平台**打回，最多 2 轮（`MAX_REVIEW_FIX_ROUNDS`），仍不通过把卡交给人。「需修改 → 球在写手」只是中间态：审批卡一落，顶栏就是「球在人手里」（`describeBall` 先看卡再看审查正文）。

## 六个真难的问题

### 1. 接力不能丢球

一跳要跑几十秒到几分钟。改代码热重启、OOM、人手 `kill -9`，进程随时没了。难的是：那一棒既不能丢，也不能被两个进程同时跑。

`PendingHop` 落 Redis，租约用 `SET NX PX`（`claimPendingHop`），跑时续期。**跑完落库再清**（`resumePendingTurn` 的 `finally` 里 `clearPendingHopIfSame`），不是取出即清，所以半截被杀能重跑。`Message.hopId` 做幂等：已经有 `completed` 的同一 hopId 不再调模型。开机扫一遍（过期租约强抢），之后每 30 秒收尸；同时只叫醒一只。

代码在 `pending-runner.ts` 和 `resumePendingTurn`。证据是 `pnpm e2e` 的 crash-resume 段：真的 `SIGKILL` 掉进程再起一个，断言半截标 `failed`、审查官有 `completed`、审批卡仍正好一张、审计里有 `hop-rerun` + `lease-steal`。

### 2. 绑不上端口的进程不许碰球

Fastify 的 `onReady` 在 `listen()` 失败后照样会跑完。撞 `EADDRINUSE` 的那个进程如果也去捡棒，会把活着那个的租约偷走，同一棒跑两遍。

捡棒挂在 `listen` 成功**之后**：`startApp` 里才调 `startPendingRunner()`。`listen` 失败必须 `app.close()` + 断开 Redis 再抛，否则 ioredis 把进程挂住，连非 0 退出码都等不到。

证据是 `pnpm e2e` 的 bind-conflict 段：#1 占端口并租走棒，#2 必须非 0 退出，审计里 `lease-steal` **不增加**。

### 3. agent 不守协议

模型会忘了写行首 `@`（球掉地上没人捡）、什么都没干就交棒（空信封往下传）、没跑过任何命令就宣称「通过」。平台不能假设它守规矩。

三道关。该交棒却没出口时再问同一只一次（`shouldNudgeExit`）。空手交棒不传（`isVoidHandoff`）：没新文件 **且** 没结论段 **且** 去掉交接行后正文短于 60 字，三条同时成立才拦——长方案没改文件照样交，是 fail-open。宣称通过必须带本轮命令和结果，否则卡上 `verdict` 不算通过、不许 `autoApprove`（`hasVerificationEvidence` + `gateReviewVerdict` / `allowsAutoApprove`）。验证闸只管卡片结论，不管顶栏文案（顶栏读审查正文关键词）。

这三关在 `pnpm eval` 里各占一行。

### 4. 平台代跑命令是信任边界

猫可以写行首 `等跑 <命令>`，让平台在沙箱里跑完再叫醒它。那等于让模型输出决定 shell 执行什么。

先把命令降成 argv（有 `;` `|` `` ` `` `$()` 等元字符直接拒），再过白名单，`spawn` 时 `shell: false`，子进程只拿裁过的最小 env（看不见父进程里的密钥）。代码在 `hold-command.ts`（shared 的 `authorizeHoldCommand` / `pickHoldCommandEnv`，api 的 `runHoldCommand`）。

`pnpm eval` 分两行量两道关：一行塞管道验元字符，一行跑 `node -e`（不含元字符）验白名单。分开量是故意的——合成一行的话，元字符先被拒，白名单那道关等于没验。

### 5. 「兜住了」要变成会红的数字

前四条都是主张。主张会烂：改一个条件、收紧一条正则，单测和快乐路径的 e2e 都还绿，真实场景里平台已经不兜了。

`pnpm eval` 记分板：每种已知坏毛病喂给 fake CLI 跑 N=3 次，记平台兜住几次，期望值写死在 `scripts/eval.ts`。**还没人拦的那格，期望就写 0**——记分板量现状，不量愿望。

这条规矩真的触发过一次，不是设想。「什么都没干就交棒」曾经期望 0，因为平台确实不拦。虚空传球门禁落地那天实际变成 1，记分板立刻因「期望 0 实际 1」非 0 退出，逼人回来把那行期望改成 1——而不是放宽断言让它蒙着绿过去。现在 9 行期望都是 1，`expectedCatch` 的类型仍是 `0 | 1`，下一格空的时候照样这么走。

### 6. 谁能让平台干活是另一道门

第 4 条管的是**平台替猫跑什么命令**。这一条管的是**谁有资格让平台干活**。两件事叠在一起才是洞，不能塞进同一节。

原来三件事叠着。生产入口绑 `0.0.0.0`，同网段谁都能连 3200。CORS 是 `origin: true`，反射任意来源，所以浏览器里随便一个网页都能跨域 POST。`repoPath` 只校验「存在 + 是 git 仓」，没有根白名单。连起来：一个没有身份的调用方可以绑到本机任意 git 仓，再派 `bypassPermissions` 的猫去干活。

现在三道门分开堵。生产入口默认 `127.0.0.1`，`API_SERVER_HOST=0.0.0.0` 才开 LAN。CORS 按来源表判（`localhost` 和 `127.0.0.1` 是两个 origin，都要放）；**WebSocket 走同一张表**——浏览器对 WS 不走 CORS，只改 CORS 会在旁边留个洞。绑仓路径默认只放行 realpath 之后的家目录和临时目录；配了 `ALLOWED_REPO_ROOTS` 是覆盖不是追加。

判法是 `resolve` → `realpath` → 比 `realRoot + sep`。朴素的字符串前缀比较会放行 `$HOME/../../tmp` 这种路径（字面以家目录开头，实际指向 `/private/tmp`），也拦不住「软链本体在允许的根里、指向根外」。这两种现在都拒。

「不带 `Origin` 放行」不是偷懒：浏览器发跨域请求（含 WS 升级）一定会带 `Origin`，恶意页面伪造不出「不带」这个状态；curl / Node fetch / 整机自检本来就不带，一律拒会把 e2e 和人手 curl 全弄挂。

代码在 `repo-path.ts` / `listen-origin.ts`。证据是 shared 单测，不是记分板——记分板那 9 行量的是猫不守协议，不管谁能连上来。

## 凭什么说它没坏

| 层 | 命令 | 验什么 |
|---|---|---|
| 单测 | `pnpm test`（628：shared 183 / api 273 / web 172） | 纯函数和适配器 |
| 整机 | `pnpm e2e`（3 段：happy-path / crash-resume / bind-conflict） | 真进程 + fake CLI |
| 记分板 | `pnpm eval`（9 行） | 已知坏毛病平台兜住几次 |

全部在 CI 上每次 push 跑（`.github/workflows/ci.yml` 还有 `pnpm -r build` 和 `typecheck:scripts`）。用 fake CLI 而不是真模型：确定性、不花钱、能进 CI。真模型冒烟是 `pnpm smoke`，花钱，不进 CI。

CI 里挂了 Redis service，所以 628 是满数。本机连不上 Redis 时，那几个 Redis 套件用 `describe.skipIf` 真跳过，输出是 skipped 而不是 passed——早先写成 `if (!redis) return` 时 vitest 会把它算成 passed，那是假绿。

审计大部分由 store 装饰器派生（`audit-log.ts` 的 `auditMessages` / `auditApprovals`）。租约事件（`pending-runner.ts` 的 `lease-claim` / `lease-steal`）和半截重跑（`resumePendingTurn` 的 `hop-rerun`）是显式补的。

老实说哪些只有人手验过：

- 浏览器那一层全是人手。仓库里没有浏览器整机测试。WS 推 `sync` 有集成测试（`http-live-sync.test.ts`），前端收到 `sync` 会重拉有 jsdom 单测（`page.test.tsx`），但「卡片自己在屏幕上弹出来、人不点鼠标」是落地时人对着真界面验的一次。
- `pnpm smoke` 花钱、不在 CI，脚本只从 claude 开口。仓库里没有 gemini / opencode 的真 CLI 全链冒烟（三家适配器各有集成测试）。
- 真机 `kill -9` 恢复：机制本身有整机自检守着（fake CLI）。「本机 3200 + 真模型想到一半被杀」是人手做过一次。

## 不做什么，还薄在哪

**有意不做。** 不做邮箱、SOP 手册、MCP 规格——那是参考项目的形态，喵窝是一场接力。平台不推理。

**现在还薄。** 线程能绑真实仓库，改动落在 `meow/<threadId>` worktree，但**不 push、不开 PR**，到本地分支为止。猫自己提交或推送，平台每跳后比一次只读 git 快照，时间线出 `git-move`、审计留一行——只是**看得见**，不是拦得住：worktree 和父仓共享 `.git`，凭据也在里面，「不许 push」目前仍是提示词里的一句嘱咐，不是技术闸。账本能按猫看 token 和花费（`GET /api/usage`），但只能看、**不能按预算拦**。Hub 是只读能力表加名册配置，不是完整产品外壳。

**平台仍然没有任何鉴权概念。** 默认只听本机是这一刀能给的最薄答案；一旦有人设 `API_SERVER_HOST=0.0.0.0` 开 LAN，就退回到「同网段任何人都能让猫干活」，因为没有身份就做不出 owner 闸。
