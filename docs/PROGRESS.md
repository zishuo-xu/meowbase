# 开发走到哪 — 接手先读这一页

给下一个接手的人或 agent。**读这页知道现在停在哪、上一个人留下了什么、下一刀往哪走。**

这页**不写**这些（另有权威源，写两份早晚有一处是错的）：

| 想知道 | 去哪 |
|---|---|
| 愿景、产品现状、怎么跑起来怎么配 | [README.md](../README.md) |
| 消息协议（谁打什么、平台做什么） | [AGENTS.md](../AGENTS.md) 协议表 |
| 架构叙事、六个真难的问题 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 每一刀为什么这么切 | [features/](features/) 对应篇 |
| 会咬人的坑 | [AGENTS.md](../AGENTS.md) 踩坑记录 |

**一个数字都不写**——测试数、篇数、eval 行数一律不记。它们会腐烂（已经修过两次：`ARCHITECTURE.md` 里的测试数和 `README.md` 里的篇数都曾停在旧值），而且六道闸一跑就知道真数。

---

## 现在停在哪

上一刀:**PR 上的评论流回线程**(`pr-review-reflow.md`,已落地)。绑仓开远程的线程,PR 上人写的评论会落时间线并叫醒写手猫;下一刀候选仍是总账建议顺序里的 F140 剩余半(CI 追踪、冲突检测),每条仍先写薄设计。

**没有在飞的刀。** `features/` 表里没有 `设计中`（`_template.md` 那篇是模板本身，不算）。总账本身已经落地；要开下一刀，从 `ALIGNMENT.md` 的建议顺序里挑，先写一篇薄设计、等人点头。

工作区长期有两处未提交，**都不要动、不要提交**：

- `meowbase.config.json` —— 人在 Hub 里改名册和模型会落盘到这里，是**本机运行时状态**，不是代码。`git add -A` 会把它带进提交。
- `docs/eval.md` —— 每次 `pnpm eval` 重写生成时间戳。跑完 `git restore docs/eval.md`，别 add。

## 哪几条道厚、哪几条薄

选下一刀前先看这个，别顺手接着磨同一块（规矩见 `.cursor/rules/plan-from-clowder.mdc`）。这是判断，会变；改了这一段就在下面的增量里记一句。

| 方向 | 现在 | 说明 |
|---|---|---|
| 协议编排 | **中** | 路由、A2A 接力、持球、审查回合都齐；但协议表里明写的多 `@` 直到 `one-hop-per-thread` 才有同树互斥，不能再叫厚 |
| 可证明性 | **厚** | 六道闸进 CI，记分板把「兜住了」变成会红的数字，审计能回放 |
| 平台会不会拒绝 | **中** | 命令白名单 + 入口白名单 + 出仓开关都有了；但**没有任何鉴权**，也没有预算闸 |
| 真能指着真仓库跑 | **中** | 能绑仓、能看见 git、能 push / 开 PR、越界或合了就停、PR 上人写的评论会流回线程叫醒写手猫；还没有 CI 追踪 / 冲突检测 |
| 产品外壳 | **中** | Hub 仍只是只读能力表加名册配置；演示主路径的输入/渲染进了 CI，Hub / 账本 / 持球界面仍靠人手 |
| 记忆 | **中** | 按仓划界、注入带出处、rail 和召回共用同一份范围函数；记分板有了跨仓那一行。池子仍只进不出，召回仍是 push 关键词，没有删除/编辑 |
| 技能 | **薄** | 触发词子串匹配 + 当轮注入，能跑；但**没有任何量它有没有用的东西**，记分板上一行都没有 |

连着两刀落在同一条道上就停下来问一句：是这条路真的最值，还是只是顺手。

**记忆和技能这两行是 2026-08-28 补的。** 之前表里只有前五行，而愿景写的是平台管七件事（路由、线程、身份、记忆、技能、审批、审计）——记忆和技能被折进「协议编排」当成「都齐了」，判断框架自己对它们盲了。补进来之后才看出：最近十刀有七刀落在「真能指着真仓库跑」那条道上。

## 下一刀候选

不是路线图，是候选。挑之前对照参考项目公开设计，写一篇薄的再动手。

- **追 CI / 冲突检测** —— 开 PR、合并拉闸、review 回流都已落地。下一层是他们的 F133(CI 绿要不要叫醒)和冲突检测,单独一篇,不能顺手带。
- **`等跑` 会把整行都当命令，白名单还放它过** —— 真机试验里墨墨写的是 `等跑 npm test 平台替跑确认 12/12 全绿`，平台把整行尾巴当成命令参数，而白名单匹配是**前缀式**的（规则 `npm test` 只校验开头几个参数，多出来的一概不管），于是 `npm test 任何东西` 都算合规。结果 npm 把那串中文当测试文件名去找、exit 1，人看到的是一个**像是测试真的失败了**的红色输出 —— 比直接拒绝更误导。修的时候要想清「尾巴多余参数」和「合法的 `npm test -- --grep x`」怎么区分，不是把匹配改成全等就完事。2026-08-25 发现，没修。
- **一根分支上第二个 PR 会静默消失** —— `pickPr` 在 `gh pr list --state all` 的结果里**优先挑 MERGED**（不看新旧），而 `pr-merged` 按 PR number 去重。所以一根 `meow/<threadId>` 上如果已经有过被合并的 PR，同一条线程再干活、再开 PR #2，平台查到的仍是 #1（MERGED）、去重判定「记过了」→ **`pr-opened` 和 `pr-merged` 一条都不落，新 PR 平台完全看不见**。2026-08-24 挑测试线程时发现，没修。绕法是每条线程只用一次 PR（新任务开新线程）。真要修得先想清「一根分支上哪个 PR 才是当前那个」——挑最大 number？挑 OPEN 优先？这是判断，不是改一行。
- **查记分板那一行为什么会飘** —— 2026-08-24 整套 `pnpm eval` 里「猫自己提交，平台就瞎了」出现过一次 2/3（报 `线程不存在`，而**那一跑产品行为是对的**：diff 抓到、审查跑完、卡建出来 `verdict=pass`，挂在骨架的断言上）。整套复跑 12/12，`EVAL_ONLY=self-commit` 单跑两轮 6/6，**隔离复现不出来，原因未知**。`flushdb` 只在每个场景跑前一次、不在三次迭代之间，所以「被别人冲库」这个顺手的解释不成立。记分板的全部价值是「会红的数字」，时红时绿等于没有证据效力，也会在 CI 里无故报红——见到那一行红，先怀疑这个已知的飘，不是自己弄坏的。
- **预算闸** —— 账本现在只能看不能拦，`GET /api/usage` 有数字但花超了不会停。
- **剩下的 UX 碎点** —— 干活时只说「猫们正在干活」不说是哪只；Hub 默认停在模型目录不是能力页；交接按钮的无障碍名把「闪闪」和「交接包」粘在一起。

## 接手要知道的几条规矩

- **一刀一次提交，六道闸全绿后推 `main`。不开特性分支、不另开 worktree 干活。** 理由在 `AGENTS.md` 开发约定里（同一目录只有一个 HEAD；两个实例同扫 pending 会抢棒）。**花钱的事仍归人拍板**：`pnpm smoke` 和真模型演示要花钱，跑之前问人，哪些命令花钱见 `AGENTS.md` 快速上手。
- **增量标题和 commit 标题要对得上。** 这是下一个人唯一的锚点——拿标题 `git log --grep` 定位那一刀，再 diff 到底。git 能告诉他改了什么，但**看不见「只有人手验过」和「故意没做」**：一份有测试的提交和一份测试只盖了纯函数那层的提交，diff 长得一模一样；缺席也不会出现在 diff 里。所以增量那两栏别省。
- **接手别人半截的活，第一件事是 `git diff`。** 别假设「没提交 = 没改」。已经发生过：反向验时把门禁掐掉的改动剩在工作区，在 `git status` 里只是一个普通 modified，混在别的改动里毫不显眼（踩坑第 28 条）。掐点写成带 `RV` 之类的记号，好让 `rg` 一次扫出来。
- **一刀算做完** = 六道闸全绿（`pnpm test` / `pnpm -r build` / `pnpm typecheck:scripts` / `pnpm e2e` / `pnpm eval` / `pnpm e2e:web`）+ 同一轮改文档（协议只改协议表、演示只改现象、功能稿改状态和入口）+ 在下面记一条增量。TDD：先写失败测试。
- **改了 `packages/shared` 要 `pnpm --filter @meowbase/shared build`**，否则 e2e / eval 跑的还是旧 dist。build 完 API 会自己重启。

---

## 增量记录

最新在上。每刀记四样：**动了什么**、**与设计稿的偏离及原因**、**只有人手验过的部分**、**明确留了没做的**。前两样是给「我再接手时知道你改了什么」，后两样是给「别把没验过的当验过了」。

### 2026-09-05 feat: PR 上的评论流回线程

`pr-review-reflow.md`。绑仓开远程的线程,每跳后 PR 是 OPEN 就查一次评论:`services/pr.ts` 加 `listPrReviews`(走 `gh api` 拉 issues/comments + pulls/reviews,每条带作者 type),挂在 `recordPrState` 的 `onOpenPr` 钩上,不另起轮询器。新评论落 `pr-review` 系统消息(不参与球权,`ball.ts` 跳过),指纹 `seenPrCommentIds` 记在线程 repo 元信息里,每条消息 append 成功即增量持久化。作者是人(`User`)且链已停,`settleTurn` 给写手猫起一跳去处理(任务正文 = 评论内容 + PR 链接,走现有 pendingHop + pending-runner);bot 写的只落消息。merged/closed 后不再查。记分板加 `pr-review-user` / `pr-review-bot` 两行,各 3/3。同轮更新:AGENTS.md 协议表加「PR 评论回流」行、测试数改实测(shared 202 + api 333 + web 187 = 722,那段「报告数不等于声明数」的旧数字已腐烂,改成不含数字的规则);ALIGNMENT.md 第 23 行括号收窄成「差 CI 追踪、冲突检测」、证据列加 pr-review-reflow、建议顺序第 1 条只剩 CI 追踪和冲突检测、面试钩子顺手改准(原来写「review comment 还不会流回来」,已不成立),对齐率不变(13/31);本页「现在停在哪」「厚薄表(真能指着真仓库跑那行:review 回流落地,仍缺 CI 追踪/冲突检测,仍为中)」「下一刀候选(追 review / CI → 追 CI / 冲突检测)」三段就地改。

- **偏离**：设计稿没说护栏,落地有四条叫醒护栏(交接中的棒不覆盖、等跑的命令不取消、持球不叫醒、叫醒过本轮不建卡——卡上冻结的不能是处理评论之前的旧 diff)。指纹从「循环结束一次性写」改成「每条 append 成功即增量持久化」:审查抓出 memory/redis 两个 store 的引用语义差异——memory store 的 `get` 返回可变引用,同一 turn 内读的是死快照会重投;改成现查指纹(threads.get 重读)+ 每条投成功立即 `setSeenPrCommentIds`,中途抛错已投的下轮也不重投。
- **只有人手验过**：没对真 GitHub 验过评论拉取(`gh api` 的 issues/comments 和 pulls/reviews 两个端点只有 fake 喂过)。记分板两行用 fake 验过,bot 行做过反向验(掐掉 `User` 过滤会变红)。
- **留了没做**：CI 追踪、冲突检测、自动 rebase(照设计稿「不做」节)。另两条:(a) 纯持球期间到达的评论只落消息不叫醒(指纹照推进),人开口后猫自己从时间线看到——这是有意的契约,持球是「人开口即取消」,平台不能用叫醒自动取消;(b) `describeRelayTimeline` 对含「接力:」正文的系统消息还有内容兜底(`isForwardRelayMessage` 的 content fallback),一条不带 `systemKind: 'relay'` 而正文含「接力:」的系统消息会在时间线上造出幽灵 hop——留着没修,另开一刀。

### 2026-09-05 docs: clowder 对齐总账

纯文档，零代码。新增 `ALIGNMENT.md`：对照 clowder 公开文档的对齐总账——策展分母、逐条对齐状态、当前对齐率、有意不做清单（不计入分母）、补缺口的建议顺序；对内工作文档，不对外。同轮登记：文档地图 `README.md` 加一行、本页「现在停在哪」就地改。

- **偏离**：无。
- **只有人手验过**：总账里每条状态（已对齐 / 部分对齐 / 缺失）是读 clowder 公开文档再对回本仓证据得出的**判断**，没有任何自动化验证；落地起点的对齐率是 13/31 = 42%，这个数字以 `ALIGNMENT.md` 顶部的为准，此处记一次只为留存起点，别处不抄。子 agent 的对账笔记在 `/tmp`，没提交。
- **留了没做**：分母外（有意不做）的条目不追；总账只记账不干活，补缺口的每条实现各自单独立薄设计、等人点头。

### 2026-09-02 按风险面选审查官

`risk-routed-reviewer.md`。`TeamMember`/`AgentSpec` 加 `reviewRisk` 可选字段（`'safety'|'contract'`），默认名册闪闪声明两面。新增 shared 纯函数 `classifyDiffRisk(files)`：路径表驱动（安全面=`hold-command.ts`/`repo-path.ts`，契约面=`AGENTS.md` + `packages/shared/src/` 前缀），同时命中 safety 优先。`selectReviewer` 加第 4 参 `risk`：非 default 面先找「声明该面且非写手且可用」的猫，没有则退回 `handoffTo` 现状；链尾复用（chainReviewer）优先于风险面。`gitDiffHead` 返回多带 `files`；`review.ts` 建卡拉审查处算 risk 传入，审查 notice 尾巴带 `·安全面`/`·契约面`，`SystemMeta.risk` 落审计。`PATCH /api/config/agents/:id` 支持热改 `handoffTo`/`reviewRisk`。协议表加「按风险面选审查官」行。记分板加第 16 行「安全面改动落到默认审查官」期望 1。

- **偏离**：设计稿字段名 `reviewerOf` 落地为 `reviewRisk`（语义更准：是「我审哪些风险面」不是「我审谁」）。设计稿说默认名册闪闪声明两面维持现状——落地时发现现状是「所有猫的 handoffTo 大多指向闪闪」，所以风险面选官在默认名册下**行为不变**，只有名册自定义（如 claude 的 handoffTo 指向团团）时才看出差别，记分板场景正是这么构造的。
- **只有人手验过**：没对着真模型改一次白名单看审批卡上的审查官和风险面标签。自动化盖了 classifyDiffRisk 三档+优先级（shared 7 例）、selectReviewer 风险面/回退/不自审（shared 6 例）、端到端「安全面改动落到声明 safety 的猫+消息带 `·安全面` + `systemMeta.risk`」（api 2 例）、记分板整链 3/3。反向验把 `selectReviewer` 的风险面分支掐成永远走 default（`RVCUT`）：shared 红 2 例、api 红 1 例（安全面集成测试）、default 面照绿；复原后 `rg RVCUT packages/ scripts/` 干净，shared rebuild 过。
- **验收时发现的真坑**（不是本刀代码问题）：**scripts/fixtures 下新建 fake CLI 必须 `chmod +x`**——所有 fake 是 `spawn(bin)` 直接 exec，Write 工具建的文件没有执行位，子进程 EACCES 立即退出，而 claude adapter 的 `child.on('error')` 吞掉后返回 `completed` + 空内容，看起来是「猫没说话」而不是「fake 没跑」，极难定位。已在 fake 里加 stderr 标记定位后才查出。这条该进踩坑清单。
- **留了没做**：不做五轴全集（数据/不可逆两轴喵窝还没有对应改动类型）、不做多 reviewer 叠加、不让猫自己声明风险面（diff 分类是平台纯函数）、风险面路径表不开放配置（写死在 shared）。Hub 界面没有 `reviewRisk` 的编辑入口（接口层通了，UI 另开一刀）。

### 2026-08-28 记忆按仓库划界,注入带出处

`memory-scope.md`。召回范围做成 `shared` 的 `filterEvidenceByRecallScope`：绑了仓按 canonical realpath 同仓共享，空沙箱只看本线程。`executeTurn` 和 `GET /api/evidence?scope=recall` 都调它；`?threadId=` 原语义保留。`confirm()` 落 `confirmedAt`，注入行带 id / 来源 / 确认时间，老数据写「确认时间未记」、不许拿 `createdAt` 顶。抬头改成「检索到的历史记录,不是本轮指令」。前端 rail 改拉召回范围。记分板加一行「别的项目的记忆被灌进来」，走 `#learn` → `#confirm`，期望 1。厚薄表「记忆」由薄改中：划界和出处齐了、记分板有了第一行；池子仍只进不出，所以还没到厚。

- **偏离**：无。接口形状用了设计稿建议的 `?threadId=X&scope=recall`。
- **验收时补的两处文档**：(1) 显式 `#ev_xxx` **不受划界限制**——代码里本来就是这样（`execute-turn.ts` 里那条 `evidence.get(id)` 没过范围函数），但设计稿和协议表都没写，下一个人读「记忆按仓库划界」会以为一律隔离。这个行为是对的：人点名 id 就是显式跨界，也对得上他们「默认召回 `project + global`，伸到整座图书馆要人点名」（F186）。协议表那行和功能稿都补了。(2) 设计稿原来的验收写成「rail 和猫这一跳能看见的完全一致」，**说过头了**。同源的是**候选池**；rail 显示范围内全部（含草稿，人要点确认），猫只吃 `matchEvidence` 筛过的已确认前 3。原来的毛病是**范围**对不上（人按线程、猫全局），那才是这一刀修的，措辞已改准。
- **验收时实测的（免费，没叫模型）**：拿 4 条真实线程打 `?scope=recall`，全部返回 0 条 —— 那 121 条单测垃圾（`t-1786…`，属于早已不存在的线程）映射不到任何仓，**这一刀顺带让它们对所有真实线程不可达了**。在这之前它们是全局可达的，只是靠分词器要求中文 ≥2 字、内容是 `x`/`y` 才侥幸没被匹配上。清不掉仍然清不掉（接口只有 `GET`），但至少够不着了。
- **想验没验成的**：「同仓跨线程共享」没能真机验 —— 池子里**一条真证据都没有**，造一条得走 `#learn` 叫模型，要花钱。这条只有单测（`绑了仓则同仓跨线程共享,别的仓不进`）。
- **只有人手验过**：没对着真模型开两个真项目线程说「之前我们约定」看侧栏和提示词是否同一批。自动化盖了纯函数、空沙箱/同仓/跨仓召回、`GET` 两套语义、rail 打召回范围、记分板跨仓那一行。反向验把 `filterEvidenceByRecallScope` 掐成直接返回全局列表（`RVCUT`），`EVAL_ONLY=cross-repo-memory` 掉到 0/3；复原后 `rg RVCUT packages/ scripts/` 干净，src 和 dist 都确认。这一关在 shared，掐和复原都 rebuild 过。
- **留了没做**：不做猫主动 pull、不做向量/阈值/衰减、不做删除编辑、不改 `#learn` / `#confirm` 语法。现网那批单测垃圾证据清不掉。

### 2026-08-28 本地是默认,碰远程要显式开

`remote-opt-in.md`。`ThreadRepo.allowRemote` 缺失即本地。本地：提示词改口「只在本地提交,不许推送、不许开 PR」；`recordPrState` 开头直接 return，一次 `gh` 都不跑；`describeGitMoves` 见自己那根 `remoteTrackingSha` 变了就落 `git-overstep`（`side: 'push'`，复用现有 kind）。越界闸 `isGitOverstep` 一个字没改，碰基准分支照样拦。侧栏仓库路径下加勾选框「允许推送和开 PR（会联网）」，默认不勾；列表/顶栏 `threadRepoHint` 带「本地 / 远程」。记分板 `withBoundApi` 和 `void-after-merge` 两处建绑仓线程显式 `allowRemote: true`；新加一行「本地模式下猫偷偷推了」，期望 1，拒因 `/本地模式/`，审计 `side=push`。

- **偏离**：`SystemMeta` 多了可选 `side`——设计稿只写 `GitOverstep.side`，但审计从 `systemMeta` 抄字段，不加审计分不出「本地模式推了」和「碰了基准」。DEMO 绑仓那段改成要先勾选才推，否则口播会对不上新默认。`failure-mode-eval.md` 目录加了一行，不然记分板清单缺这一关。
- **只有人手验过**：没对着真模型绑一个没有 remote 的仓发一句话看「查不到 PR」是否真的消失。浏览器闸走的是空沙箱 +「+ 新会话」，勾选框在侧栏里但没点过；`e2e:web` 4/4 绿，说明多出来的 checkbox 没把演示主路径的选择器弄红。反向验把 `describeGitMoves` 里 `!allowRemote` 那支掐成 `false &&`（`RVCUT`），`EVAL_ONLY=local-push` 掉到 0/3，接力照跑还建了卡；复原后 `rg RVCUT packages/ scripts/` 干净。这关在 api 源码里，不经过 shared dist。
- **留了没做**：不做全局默认配置、不裁 git env、不给已有线程改模式。
- **验收时补的**：空路径时那个勾选框原来是**空操作**——勾得动、界面上勾着、但 `opts` 只在填了仓库路径或基准分支时才带，所以什么都不会发生。语义上「空沙箱没有远端」是对的，但让人勾一个没用的框是界面在撒谎，改成路径为空时 `disabled` + 灰字 + title 说明，并加单测锁住「勾不动、也不会悄悄带上」。
- **验收时查出来的数字问题**：`AGENTS.md` 里 api 单测数 304 **在这一刀之前就已经偏了**。实测 `HEAD~1` 是 308，所以这一刀加的确实只有 3 个（声明数 305 → 308）。而 vitest 报 311——**报告数不等于 `it(` 声明数**，api 有 3 个用例是参数化生成的。以后改这个数字不要按 `rg "it("` 的结果写。另外那 311 里有 12 个是 Redis 套件：Redis 在跑是 311 passed，连不上是 299 passed + 12 skipped，总数不变。
- **验收时实测过的**（不花钱，没叫模型）：已有绑仓线程**是 3 条不是 2 条**，`GET /api/threads` 确认三条的 `repo.allowRemote` 全部缺失，即全部落到本地模式，迁移方向对。又在 `$HOME` 下建了个**没有 remote** 的靶子仓，`POST /api/threads` 两条路都走了一遍：不带字段 → `allowRemote` 缺失；带 `allowRemote: true` → 落成 `true`。
- **真模型验过了**（$0.10，一跳）：`$HOME/meow-localonly-probe` 是个**没有 remote** 的仓，绑成本地模式线程，发一句不改文件的话。时间线只有 2 条消息（人 + 猫），**零条「查不到 PR 状态」**，也没建卡、没补问。挑「不改文件」是故意的：`captureAfterHop` 里 `recordPrState` 是**无条件**跟在每跳后面的，不看有没有 diff，所以没有 diff 也能触发那次查询，而没 diff 就不会建卡、不会触发补问（补问看 `hasDiff`），一跳就够、最省钱。反面证据来自另一处实测：`gh pr list` 在无 remote 的仓里输出 `no git remotes found` 并失败，所以旧行为下这条 notice 是**一定**会出现的。
- **同一跳顺带发现的模型行为**（不是平台 bug）：猫回答「工作目录是空目录，无任何文件」，但 worktree 里 `README.md` 确实在、分支也对。日志 `tools=0`——它一个工具都没调，没看就编了。查过不是平台传错工作目录。

### 2026-08-27 演示路径进 CI

`demo-path-in-ci.md`。新闸 `pnpm e2e:web`：Playwright 只开 chromium，复用 `harness.ts` 的 `startApi`（fake CLI，不花钱），Redis 用第 12 号库。API 口烤死 3212、web 口 3312，撞了就退出不换端口；web 单独 build 进 `packages/web/.next-e2e`，不碰人正在用的 `.next`。四条断言各能独立红：Shift+Enter 换行后用户气泡里 `@团团` 仍自己占一行；线程主猫是墨墨、点名团团、开口的必须是团团；补全菜单里 Enter 不发送；接力句 / 顶栏球权 / 审批卡出现，点批准后顶栏「已落地」。厚薄表「产品外壳」由薄改中：零覆盖的输入/渲染层进了 CI，但 Hub / 账本 / 持球界面仍没自动化，还没到厚。

- **偏离**：团团走 opencode 协议，不能复用 `fake-claude-writer`（那份吐的是 claude stream-json，OpenCodeAdapter 读不出交棒行）。加了 `scripts/fixtures/fake-opencode-writer.mjs`，行为对齐写手 fake（落 `hello.txt`、行首 `@闪闪`），只改协议。CORS 要认 3312，所以起 API 时带了 `WEB_PORT`——不改来源表算法，只把测试口告诉已有的 `resolveAllowedOrigins`。`next build` 会改 `packages/web/tsconfig.json` 的 include 加上 `.next-e2e/types`，留下比每次跑完都脏更好。同一轮还会把 `next-env.d.ts` 指到 `.next-e2e`，闸里 build 完拨回 `.next`，不然日常 `pnpm -r build` 和工作区来回脏。起 Playwright 时清掉 `PLAYWRIGHT_BROWSERS_PATH`：Cursor 沙箱会把它指到空缓存，装了的 chromium 也启动失败。
- **只有人手验过**：没对着真模型再走一遍浏览器演示。自动化盖的是 fake CLI 下的输入层和渲染层。本机第一次装 chromium 的耗时、以及「人正在开着 3300 的 dev 时跑这闸会不会弄坏 `.next`」这两句，落地时在本机核对过：build 只写 `.next-e2e`，`.next` 的 mtime 没动。
- **留了没做**：不盖崩溃恢复、持球、升级、绑仓、Hub、账本、拉闸。不改前端取 API 地址的方式。不把浏览器测塞进 `pnpm e2e`。`等跑` 吃整行、一根分支第二个 PR 静默消失、记分板飘，这一刀都没碰。

### 2026-08-26 同一线程同一时刻只跑一跳

`one-hop-per-thread.md`。`executeTurn` 里 `Promise.allSettled` 改顺序循环，失败隔离留下（一只抛错后面照跑）。`lastResult` 改成最后一个成功的。一条线程仍只有一个 `pendingHop` 槽：第一个交棒的留住，后一个交棒落 `notice`（不参与球权）。协议表「同题并行」改成同题群发、顺序执行，并写明只跟第一个交出来的棒。记分板加一行「两只猫同时改同一棵树」，只断言两份提交 subject 和文件各自对得上。厚薄表「协议编排」由厚改中：并行是协议表里明写的能力，它没保护，那条道就不能算厚。

- **偏离**：无。归属测试和记分板 fake 都按踩坑 29 只提交一次（补问那跳不再 `git commit`），这是落地时才钉上的，设计稿没写，不是改判定。反向验把循环掐回 `Promise.allSettled` 后，记分板这行 0/3：两只同时 `git add` 抢同一把 `index.lock`，团团那跳直接失败——比「subject 张冠李戴」更早爆。
- **只有人手验过**：没有对着真模型再跑一遍「人打两行 `@`」。自动化盖了顺序、失败隔离、丢球、绑仓归属、记分板同树那一行。浏览器顶栏认 `notice` 不改球权只有旧单测，没有浏览器整机。
- **留了没做**：不做每猫一棵 worktree、不搬 InvocationQueue、不碰跨线程并发。`等跑` 吃整行、一根分支第二个 PR 静默消失、记分板飘，这一刀都没碰。

### 2026-08-25 猫自己提交之后批准不再报提交失败

`approve-after-self-commit.md`。`run()` 起 git 时只加 `LC_ALL=C`，其余 env 照旧继承。`gitErrorReason` 除 stderr 外也读 stdout，噪音行仍跳过。`tryLandApproval` / `isNothingToCommit` 判断没动。env 拼装抽成 `gitChildEnv`，单测断言它钉了 `C`；绑仓集成盖自己提交后 `#approve` 落 `approval-applied`。

- **偏离**：噪音过滤比设计稿多跳了以 `(use ` 开头的那行。真机场景是猫已经 push，stdout 在 `Your branch is ahead` 后面紧跟 `(use "git push" to publish your local commits)`；按原稿只跳 `On branch` / `Your branch` 会先拿到这句，`isNothingToCommit` 匹配不上。英文机器上以前靠 `err.message` 整段兜住的路，读了 stdout 之后反而会被这行掐掉。
- **只有人手验过**：设计稿第 5 步「中文 locale 机器上绑仓、猫自己提交、人手点批准」没对着真模型再跑一遍。自动化盖了 `LC_ALL` 断言、stdout 取因、绑仓自己提交后批准。中文 commit message 用 `gitCommit('批准记下了：中文提交信息自查')` 走过，`git log` 读回不乱码。另外**验收侧手工补了一次 locale 反向验**：`LC_ALL=zh_CN.UTF-8 LANG=zh_CN.UTF-8 pnpm --filter @meowbase/api test git` 在钉着 `C` 时 26/26 绿；把 `gitChildEnv` 打上 `RVCUT` 拆掉钉 locale 后，同一条集成测试**复现真机那个原样失败**（`expected 'approval-failed' to be 'approval-applied'`）。所以那条集成测试不是空的，只是**只有在非英文 locale 下才实心**。
- **留了没做**：不裁 git 子进程 env、不顺手合 PR、不加记分板行。绑仓那条集成测试在 CI 里因为 git 说英文，即使一行都不修也会绿——真防线是「`gitChildEnv` 钉了 `LC_ALL=C`」那条断言（反向验过：拿掉 `C` 立刻红）。**没有把 CI 改成强制中文 locale 去跑**：GitHub runner 上不一定生成过 `zh_CN.UTF-8`，缺了会静默退回英文，那样只是把「空测试」伪装成「已覆盖」，比现在更糟。要做得先在 CI 里确认 locale 真生成了才有意义。`等跑` 吃整行、一根分支第二个 PR 静默消失，这一刀都没碰。

### 2026-08-24 合了之后那张卡要作废

`approval-void.md`。`ApprovalStatus` 加终态 `voided` + `voidReason`。`settleTurn` 的 `pr-merged` 分支作废本线程还开着的卡，系统句用 `notice`。`#approve` 对失效卡当场回「这张卡已失效」，不走到提交。记分板加一行「合了之后那张卡还能批」，只断言卡是 `voided`。

- **偏离**：设计稿写「只接受 `reviewing` / `pending`」。仓库里没有 `pending` 这个 store 状态——`pending` 是前端 UI 映射，开着的是 `draft` / `reviewing`（跟 `approve` / `reject` 同一道门）。`#approve` 拒词写在 `system-commands.ts`，不是预判的 `execute-turn.ts`。记分板新行必须先建卡再合，所以分两段起 API：第一段不带假源建卡，第二段才 `MEOW_PR_FAKE=merged`；`merge-pr` 那行仍从第一跳就假合并、不断言卡状态。
- **验收时补了一格(设计稿同轮改了)**：门原来只枚举 `reviewing` / `pending`，把 **`approved` 漏了**——它不是终态，人批了但提交失败的卡停在这里，而 `#approve` 再打上去会**跳过 `approve()` 直接重走落地**，PR 合掉之后那次重试必然 nothing to commit 失败。也就是说这一刀要消掉的症状（人点下去才发现没意义）在这个状态上原封不动留着。补法：判据抽成 `shared` 的 `isVoidableApprovalStatus`，因为 store 和 `settleTurn` **两处都在筛状态**，只改 store 那份测试仍然红。原先锁「`approved` 拒作废」那条单测的断言和标题一起翻了过来。
- **只有人手验过**：没验过。不许真调 GitHub，真机「人手合 PR → 卡变已失效、按钮消失」这一段没有对着真远端跑。自动化盖了 store 状态机、`pr-merged` 作废、`approved` 也作废、`git-overstep` / `CLOSED` 不作废、`#approve` 提前拒、卡片无按钮、记分板单独一行。
- **留了没做**：**不做数据迁移**——开发库里已经存在一张停在 `reviewing` 的旧卡（线程 `6218cc26-4967-4d36-9aee-87aab3066439` 的 `ap_b0d4fc1c`，它就是这一刀的来源），这一刀落地后它不会被追溯作废。不作废 `git-overstep` / `CLOSED`。不做卡的自动重建。不追 PR 关闭 / reopen / 强推改写。不改 `#approve` 之外的批准入口。

### 2026-08-24 真机验收：整条 PR 闭环第一次对着真 GitHub 跑

**不是一刀代码，是一次验收**，记在这里因为它把上面两条增量里「还没验过」那栏变成了「验过了」，也因为它暴露的东西自动化看不到。

靶子仓 `zishuo-xu/meow-pr-probe`（私有，留着当凭据，不要拿本仓验——越界闸是**事后**闸，第一次真机验不该拿作品仓当靶子）。六道闸先全绿，然后绑仓建线程、真模型跑。

- **跑通了什么**：写 `sum.ts` → 猫自己 commit → push `meow/<threadId>` → `gh pr create` PR #1 → 交棒闪闪 → 审查 `verdict=pass` → 审批卡。人手 `gh pr merge --squash` 后再一跳：猫写出行首 `@闪闪`，**平台没有交**，落 `pr-merged`、清 `pendingHop`、不新建卡。审计 `pr-opened` / `pr-merged` 两行都带 `prNumber` + `headRefOid`。
- **真机比 fake 多暴露的**：**真模型两跳都忘了行首交棒，补问各触发一次。** fake CLI 是照脚本写交棒行的，所以这个现象在 e2e / eval 里永远看不到。门禁按设计工作了，但它说明补问那一层是刚需不是保险——并且**不免费**：补问让墨墨多跑两跳、重读上下文，这次一个三行函数的任务花了 **$0.5840**（缓存读 279,986 token），比预估高一个量级。以后估成本要把补问算进去。
- **新发现（下一刀）**：`pr-merged` 停接力之后，**那张审批卡没有被作废**，还停在 `reviewing`，而它要人批的改动已经合进 `main` 了。真去批不会说谎（提交会 nothing to commit 失败，落 `approval-failed`），但它在邀请一个已经没有意义的动作。`pr-open.md` 的「不做」那节没提到这一格。
- **顺手量到的两处**：`GET /api/usage` 的 `total` 只含报了成本的那几只猫，却带 `costEstimated: false`，读起来像精确总额（**UI 无此问题**，Hub 只按猫列、不渲染 total）；`pnpm test` 会把审计流水冲掉——最近 200 行里 196 行是测试线程，文档教的 `?threadId=` 查法不受影响。
- **工具环境**：`cursor-ide-browser` MCP 在那次会话里建完标签就丢，界面巡检是 Playwright 顶上的。以后要做「演示路径进 CI 的浏览器测试」，别指着那个 MCP。

### 2026-08-23 猫自己开 PR，合了就停

`pr-open.md`。提示词改口：可以对自己这根开 PR，不许自己合。每跳后查一次 PR（可注入），第一次看见 OPEN 落 `pr-opened`，MERGED 走 `settleTurn` 停接力。记分板加一行「猫自己把 PR 合了」。

- **偏离**：查之前先看 `git remote -v` 像不像 GitHub——设计稿只写了 `gh pr list`，但「远端不是 GitHub」那道关若完全交给 `gh` 的报错原文，本地 bare remote 的现有绑仓测试会去真 spawn `gh`，结果随本机有没有装/登入而漂。第一次看见 MERGED 只落 `pr-merged`、不补 `pr-opened`（没看见 OPEN 就写「开了」是谎）。记分板假源用环境变量 `MEOW_PR_FAKE=merged`，没有另做文件协议;**验收时挪了一次位置**——原来 `startApp` 无条件读这个 env，等于生产进程也带着「假装 PR 已合并」的开关（而且一个测试都没盖），改成 `startApp` 的 `lookupPr` 参数、env 只有 `scripts/e2e-server.ts` 认，跟 `rebuildAdapter` 同一个缝。
- **人手验过（2026-08-24 真机补验，见下面「真机验收」那条）**：绑一次性仓 `zishuo-xu/meow-pr-probe`，真模型走通「写 → 提交 → 推自己那根 → `gh pr create` → 互审 → 审批卡」，时间线出 `git-move` / `pr-opened` 带真链接；人手 `gh pr merge --squash` 后再一跳，猫写了行首交棒而**平台没有交**，落 `pr-merged`、清 `pendingHop`、不新建卡，审计两行都带 `headRefOid`。**仍没验过**：浏览器顶栏认 `pr-merged`（只有单测）；`gh` 没登录 / 断网两态（只有错误分类单测）。
- **留了没做**：不做 webhook / 补偿扫描 / review 回流 / CI 追踪 / Hub PR 看板 / 平台代开代合 / 自动 rebase。不裁 `gh` 的 env。查不到每跳都落一句，没有去重。崩溃卡在 hop 已完成、`settleTurn` 还没跑的窗口里，重跑会丢 `pr-merged` 信号——和上一刀越界闸同一个窗口。

### 2026-08-23 空模型名不许假装连通，探测花费当场显示

`platform-spend.md`。路由空模型名 400（带 `field`），`verifyModelConnection` 在 `createAdapter` 之前就回；`VerifyModelResult` 透出 `usage`，失败只要 CLI 报了也带上。Hub「加入目录 / 验证新模型」改成字段提示；账本那一格写明只算猫的。

- **偏离**：第 3 步原方案是探测落平台账目、撑大 `loadUsage`。核过七个 store 都放不下，为几分钱开第八个 store 或改 `AuditRow.threadId` 是 LL-020。拍板改成口径写死、当场显示，`loadUsage` 未改。
- **人手验过（2026-08-24 浏览器补验）**：模型 ID 留空点「验证新模型」和「加入目录」，都出字段级红字 `请填写模型 ID`（`role="alert"`），页面上没有「探测」字样、没有转圈、没有静默加进目录；账本页那句口径在，`无成本数据` 和 `—` 是两种不同的格子。**仍没验过**：真模型名点验证看结果里的 token 和花费（要花钱）。自动化覆盖纯逻辑那一半：空模型名 400、`createAdapter` 零调用（spy 断言）、成功和失败两条路径都透传 `usage`。
- **留了没做**：不做预算闸；不为探测开 store；平台出现第二条花钱路径（例如定时健康检查）才加厚。

### 2026-08-23 放开推送，越界就停

`push-boundary.md`。提示词改口：可以 push 自己这根 `meow/<threadId>`，不许碰基准分支。快照加了本地基准分支 sha。`describeGitMoves` 把越界拆出来，`settleTurn` 落 `git-overstep`、清 pending、不建卡。记分板加一行「猫去推基准分支」。

- **偏离**：无。交棒条在越界判定之后才写，避免时间线先点亮下一只再停——这是落地顺序，不是改判定。
- **只有人手验过**：真机绑仓推自己那根看时间线「推到了 origin」、顶栏接力照跑；推基准分支看顶栏「球在人手里」、`GET /api/audit` 那行的两个 sha。浏览器顶栏认 kind 只有单测，没有浏览器整机。
- **留了没做**：不做 `gh pr create` / PR 追踪；不裁 git / gh 的 env；不解析猫打了什么 git 命令（只看哪根引用动了）。事后闸：越界那一 push 已经发生。崩溃卡在 hop 已完成、`settleTurn` 还没跑的窗口里，重跑那一跳会丢越界信号——窗口里没有模型调用，没另做持久化。

### 2026-08-23 把「有意不做」改成「先不做，顺序是刻意的」

四处（README 现状句、`ARCHITECTURE.md` 开头和「不做什么」节、`A2A.md` 两处、`DEMO.md` 两处）原来写「有意不做邮箱/SOP/MCP——那是参考项目的形态」。真实原则不是这个：**不是不做，是按迭代节奏**。同时把两种东西分开了——邮箱/SOP/MCP 是**顺序问题**（先把接力做到可证明，再加形态），「平台不推理」是**真边界**（不随节奏变）。原来两者混在一句里，读的人分不出哪个可以谈、哪个不能碰。

- **偏离**：无代码改动。措辞刻意没用「尚未落地、后续再扩展」——那句在面试里最弱，听起来只是进度落后；写成「顺序是刻意的：先可证明再加形态」才是能被追问的判断。
- **只有人手验过**：逐处检索核对，没跑代码（纯文档）。
- **留了没做**：`.cursor/rules/plan-from-clowder.mdc` 里「不是「另一套产品所以永远不做」」那句现在和文档一致了，规则本身没改。**没有**给邮箱/SOP/MCP 定路线或优先级——它们仍不在下一刀候选里。

### 2026-08-23 绑仓只放行允许的根，API 默认只听本机

`repo-root-allowlist.md`。三件事原来叠成一个真能走通的洞：入口绑 `0.0.0.0`、CORS 反射任意来源、`repoPath` 没有根白名单，合起来等于同网段任何人都能绑到本机任意 git 仓再派 `bypassPermissions` 的猫去干活。现在分三道门堵。

- **偏离**：覆盖测试原计划真建一个家目录里的仓，沙箱里 `git init` 报 `EPERM`，改成只打路径不真建仓——白名单在存在性校验**之前**，不必真有仓。CORS 用 GET 验来源，避免 POST 建线程在沙箱里炸。
- **只有人手验过**：真机上验了监听地址只有 `127.0.0.1`、恶意来源 403、WS 三态（不带 / 合法 / 恶意 = 101 / 101 / 403）、`$HOME/../../tmp` 这种字面前缀能过而 realpath 过不去的路径被拒、软链本体在根内指向根外被拒。这些**没有进自动化**（单测覆盖的是纯函数那一层）。
- **留了没做**：**平台仍然没有任何鉴权概念。** 默认只听本机是最薄的答案；有人设 `API_SERVER_HOST=0.0.0.0` 就退回原样。没有身份就做不出 owner 闸。也没裁 git 子进程的 env（稿子里写了为什么不裁）。

### 2026-08-22 让 Shift+Enter 换行和补全 Enter 选候选看得见

输入框 Enter 就是发送、换行要 Shift+Enter，但界面上一个字都没写，导致人手走演示时漏打了 `@墨墨` 那一行、两条检查静默失效。补了两处提示、加 `Tab` 也能选候选。

- **偏离**：无。
- **只有人手验过**：浏览器里真按了 Tab（值变成 `@墨墨 `、菜单关闭、没有发送）、提示排版没遮住发送按钮。
- **留了没做**：**`Enter` 的语义一个字没改**——补全菜单开着时 `Enter` 仍是选候选不是发送。要不要在「查询词恰好等于某个候选全名」时改成发送，是个更大的设计问题，故意留着。顺带给输入法那三个条件（`composingRef` / `nativeEvent.isComposing` / `keyCode === 229`）补齐了回归锁，原来缺 `isComposing` 那条。

### 2026-08-22 审计流水去掉空白摘要、重复落地和空抢租约

真机演示时 14 行流水里有 3 处噪音，两条线程上精确重现。摘要改取第一个非空行；`approval-applied` 不再由 store 和回执各落一条；没有 `pendingHop` 就不写租约行。

- **偏离**：无。
- **只有人手验过**：凭空租约那条在跑着的服务上验了（纯系统命令从 4 行变 2 行）。空摘要和重复 applied **只有单测**，要一次真模型跑才能在真数据上看到。
- **留了没做**：无。

### 2026-08-22 及更早

平台看得见猫对 git 做了什么、批准不再撞谎；命令白名单；虚空传球门禁；失败模式记分板；整机自检进 CI 和 `startApp` 收敛；审计流水；账本；系统消息带类型；持久化接力那一串（交棒有主人、跑完落库才清、开机强抢死者租约但只在绑上端口之后）；绑真实仓库的 worktree。

每刀的「为什么」在 [features/](features/) 对应篇，「怎么做的」看 `git log`，踩过的坑在 [AGENTS.md](../AGENTS.md) 踩坑记录里——那 30 多条就是这些刀留下的沉淀。

---

## 太长了怎么压

增量会一直长。压缩是这一页上**唯一会丢信息的操作**，所以：

1. **只由主持这条线的人（或人指定的那一个）来压，不许子 agent 顺手压。** 子 agent 只往上加一条，不合并、不删。
2. **压之前先搬。** 仍然有效的沉淀必须先搬到它该去的地方——会咬人的搬进踩坑记录、为什么这么切的搬进功能稿、协议语义搬进协议表——**搬完才允许从这里删**。直接总结掉就是在丢最值钱的那部分：今天真正有用的不是「全绿」，是「沙箱里 `git init` 会 `EPERM` 所以测试不真建仓」这种句子。
3. 压完保留一段「某月及更早」的概述加指路，像上面那段一样。不要留下「做了很多改进」这类什么都没说的话。
4. 「现在停在哪」「方向厚薄」「下一刀候选」三段**不累积、就地改**。改了在增量里记一句，别偷偷改。
