# 猫自己开 PR，合了就停

一篇只写**一个**可验收的特性。做完再开下一篇。

- 状态:`已落地`
- 对照 clowder:PR 这一层他们分**三段**——①**发现**(F141):GitHub webhook `pull_request.opened` 推过来是主路径,另有 5 分钟 `gh api` reconciliation 扫描补漏,delivery id 去重;②**认领**:猫 triage 后调 `register_pr_tracking` 注册进追踪表——**自家刚开的 PR 不走 webhook 发现,是开 PR 的那只猫自己注册的**;③**追踪**(F140):已注册的 PR 靠**轮询**拿 CI / 冲突 / review 信号(F140 Phase E 把旧的 IMAP/email watcher 整条拆了,轮询是唯一真相源)。回流规则:comment 投回**注册这条 tracking 的那个线程**、唤醒 owner 猫,`intent=review` 时 CI 绿只记状态不叫醒、`intent=merge` 才叫醒去合。主语始终是猫:`commit / push / gh pr create / gh pr merge --squash` 都是猫在 CLI 里跑,平台不代劳。
- 靠拢:**只靠第 ② 段的语义,一三两段整段不做。**自家开的 PR 本来就不需要 webhook——开 PR 的是我们自己的猫、分支名是我们自己起的(`meow/<threadId>`),所以「发现」退化成一次 `gh pr list --head`。这是他们那张三层图在单人自用场景下的最薄切法,不是省略。**一处必须比他们严**:他们的猫过完跨猫 review 和 `pnpm gate` 后自己 `gh pr merge`;喵窝的合并是**人的闸**(见下),猫合了就当越界。这是喵窝跟他们在愿景上真正分叉的一处,不是没做完。

## 门（各一句）

- **功能**：猫可以对自己那根 `meow/<threadId>` 开 PR;平台每跳后自己去看这个 PR 现在什么样,落进时间线;PR 被合了则接力当场停、球回人手里
- **价值**：闭环第一次走完最后一格——人在 GitHub 上看到的是一个正常的 PR,不是「你去帮我把猫的分支开个 PR」
- **愿景**：仍是邮差。平台不替猫开 PR、不评判该不该开,只负责**看见**和在越界时停下把球交给人
- **落点**：`system-prompt.ts` 再改一句口 + 已有的每跳 git 快照旁边加一次只读 `gh` 查询 + 复用 `settleTurn` 的停接力路径。不新开第二心脏,不加线程字段

## 为什么

**先说这一刀真正在补的洞,它不是「PR 这个功能」。**

上一刀([push-boundary.md](push-boundary.md))装的越界闸,比的是本地两根引用:`refs/remotes/<remote>/<base>` 和 `refs/heads/<base>`。猫直接 `git push origin HEAD:main` 拦得住——**push 成功后 git 会顺带更新本地那根远端跟踪引用**,下一跳快照就看见了。

但 `gh pr merge` 合在 GitHub 服务器上,本地两根引用**一动不动**,而快照按设计[不 fetch](git-state-tracking.md)。所以:

> 今天猫没有顺手的路子去动基准分支;一旦放开开 PR,最顺手的那条恰好是闸看不见的那条。

放开开 PR 而不同时补这个洞,等于把上一刀的墙从侧面绕过去。**这两件事必须同一刀做,分开做中间那段时间墙是破的。**

**为什么合并是人的闸,而他们不是。**他们的人只挡不可逆和方向(改 main 历史、合第三方 PR、close feat、碰圣域),合自家 PR 归猫,因为前面挡着跨猫 review + `pnpm gate` + 证据清单。喵窝的产品命题是「人拍板,猫推理,平台当邮差」,审批卡是这条命题唯一的落点。代码进基准分支是这条线上**唯一真正不可逆**的一步——所以卡放在这里,而不是放在猫改了几个文件上。这也让审批卡的含义第一次说得清:批的不是「这段 diff 好不好」,是「要不要合进去」。

**诚实说清性质:和上一刀一样是事后闸。**猫真跑了 `gh pr merge`,合已经发生了,平台做的是立刻停住、留证、把球交给人。要真拦得住,得让猫手上没有能合的凭据,那是身份代持,是另一颗心脏(理由同上一刀:他们 LL-019/LL-020 换 `HOME` 隔离凭据翻过车,补了 6 个补丁仍不稳,最后回退)。

**再诚实一条:PR 是以人的 GitHub 身份开的。**`gh` 用的是本机 `gh auth` 的登录,猫没有自己的账号。所以 PR 作者会是你。他们也一样——LL-080 记着全家一个 GitHub 账号,同账号自审会被 GitHub 拒,只能退化成 comment + `--admin` 合。这不影响这一刀,但不能让文档读起来像「猫有自己的身份」。

## 怎么做

1. **提示词改口**。`system-prompt.ts` 绑仓那段:可以对自己这根 `meow/<threadId>` 开 PR(`gh pr create --base <baseBranch>`);**不许 `gh pr merge`**——合不合由人在审批卡上定;不许碰 `<baseBranch>`、不许动 `.git`、不许切分支。点名对象,不点名命令(LL-090 的判据)。

2. **每跳后查一次 PR,不信猫的自述**。和已有的 `captureGit` 同一个位置,绑仓线程跳后跑一次只读 `gh pr list --head <branch> --state all --json number,state,url,headRefOid`。**为什么不解析猫正文里的 PR 链接**:同 [git-state-tracking.md](git-state-tracking.md) 的判据——平台看**什么动了**,不看猫**说自己干了什么**。猫可以写错、可以撒谎、可以忘了写。

3. **查不到 ≠ 没有**。`gh` 没装、没登录、远端不是 GitHub、断网,四种情况都会让查询失败。它们必须落成「查不到 PR 状态(原因)」,**不许落成「没有 PR」**——这是上一刀 [platform-spend.md](platform-spend.md) 同一条教训:没真干成的事不许显示成干成了,反过来没真查成的也不许显示成查过了。查询失败**不停接力**(平台自己的能力缺失不该罚猫),只在时间线留一句。

4. **两条新系统句**,都要 `systemKind`(约定见 [system-message-kind.md](system-message-kind.md)):
   - `pr-opened`——第一次看见这个分支有 PR,带 number / url。**不参与球权**,接力照跑。
   - `pr-merged`——PR 状态变成 MERGED。**参与球权,球回人手里**:走 `settleTurn` 里越界那条现成路径(清 `pendingHop`、不建审批卡)。不复用 `git-overstep`,因为顶栏和时间线要说得清是「被合了」而不是「推了 main」。

5. **审计留证**。两条都要能从 `GET /api/audit` 查到,`meta` 带 PR number 和 `headRefOid`。**用 `headRefOid` 不用 `FETCH_HEAD`**:LL-079 记着 `FETCH_HEAD` 是 volatile ref,高频 fetch 环境下取证必须钉死 sha。走 store 装饰器,不手写 `audit.append`。

6. **记分板加一行**。新坏毛病「猫自己把 PR 合了」,fake CLI 造这个动作,期望兜住 1。按踩坑第 27 条**按关分行**——这一行只量「合并拉闸」这道关,不许和 `push-base` 那行合并,否则其中一道坏了记分板照样绿。fake 不能真调 GitHub,所以要把 `gh` 查询做成可注入的(见「入口」),记分板里换成假的 PR 状态源。

7. **验收**。绑仓线程:猫开 PR → 时间线出 `pr-opened` 带链接、接力照跑;把 PR 合掉 → 接力当场停、顶栏「球在人手里」、审计有一行带 number 和 sha;`gh` 故意改成不存在的 bin → 时间线出「查不到」而不是「没有 PR」,接力照跑。反向验:把合并判定改成永远 false,记分板那一行掉到 0(掐点写 `RVCUT` 记号,见踩坑第 28 条)。

## 不做（本篇）

- **不做 webhook 和补偿扫描**(他们的 F141 第 ① 段)。自家开的 PR 用分支名就能查到,不需要被动推送。要做社区 PR / Issue 进站才需要那一层,那是另一篇。
- **不做 review comment 回流、CI 状态追踪、`intent` / `wakePolicy`**(他们的 F140 第 ③ 段)。整整一层,他们为这层的分层踩了三个月锅,不能顺手带。**特别是 LL-033**:`gh pr view --json reviews` 只返回 review body、**不返回 inline code comments**,只看它会漏掉 inline 的 P1——真要做回流得先解决这个,更不该顺手带。
- **不做 Hub 上的 PR 看板**。他们公开材料里也查不到有没有这东西,没有可对照的设计。
- **不做平台代开 PR / 代合并**。主语是猫,这是对照里最要紧的一条:一旦平台代劳,就不能再声称靠拢他们那条闭环。
- **不做自动 rebase / 冲突处理**(他们 F140 的 ConflictAutoExecutor)。而且公开材料里那块归属不清(同时说「猫执行」和「代码层面自动 rebase」),没有干净的对照物。
- **不裁 `gh` 子进程的 env**。理由和出处同 [repo-root-allowlist.md](repo-root-allowlist.md)「不做」那节;`gh` 靠本机 keyring 登录,裁了直接不能用。

## 入口

- 提示词改口:`packages/shared/src/system-prompt.ts`（`buildSystemPrompt` 绑仓那段）
- PR 只读查询（可注入）:`packages/api/src/services/pr.ts`（`lookupPr` / `createMergedPrLookup`）。注入缝是 `startApp` 的 `lookupPr` 参数,和 `rebuildAdapter` 同一个模式;`MEOW_PR_FAKE=merged` **只有 `scripts/e2e-server.ts` 认**,生产进程没有「假装已合并」这个开关
- 每跳后查、落 `pr-opened`:`packages/api/src/router/turn/segment.ts`（`recordPrState`，和 `captureGit` 同一拍）
- 合了就停:`packages/api/src/router/turn/settle.ts`（`settleTurn` 里和 `git-overstep` 共用清 pending / 不建卡那支，kind 分开）
- 球权认 `pr-merged`、跳过 `pr-opened`:`packages/web/lib/ball.ts`
- 记分板:`scripts/eval.ts`（`merge-pr`）+ `scripts/fixtures/fake-merge-pr.mjs`
- 协议:见 `AGENTS.md` 协议表「平台自己做的」PR 合了就停那一行
