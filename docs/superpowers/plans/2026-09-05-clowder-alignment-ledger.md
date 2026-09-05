# clowder 对齐总账 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出 `docs/ALIGNMENT.md`(clowder 对齐总账):从 clowder-ai 的 309 条 F 文档策展 ~30 条核心清单,逐条标注对齐状态、双方出处和面试钩子,给出补缺口建议顺序。

**Architecture:** 纯文档任务,不改任何代码。克隆 clowder-ai 到 /tmp(不进工作区),派 5 个并行子 agent 按领域簇精读 F 文档并写结构化笔记,再由执行者策展成分母、逐条对账 meowbase 现状(证据 = 功能稿/代码链接),落成一份 ALIGNMENT.md。

**Tech Stack:** git clone(只读参考)、子 agent 并行阅读、Markdown。无新依赖。

## Global Constraints

- 设计稿:`docs/superpowers/specs/2026-09-05-clowder-alignment-ledger-design.md`,口径以它为准(机制级对齐、分母 ~30、有意不做剔出分母必须写理由、对齐率 = 已对齐/分母)
- **一刀一次提交**:中间不 commit,六道闸全绿后一次提交,不推 main 之前先给人看
- **不碰两个长期脏文件**:`meowbase.config.json`(本机运行时状态)和 `docs/eval.md`(eval 重写)。跑完 eval 后 `git restore docs/eval.md`
- clowder 只拿语义和踩坑,不抄源码;ALIGNMENT.md 里引用一律给 GitHub 链接
- 「已对齐」判定是机制级:同一问题用同一套机制形状回答,不是有同名能力就算
- 面试钩子用第一人称写「我做了什么、为什么」,不提 clowder
- 六道闸命令:`pnpm -r build`、`pnpm typecheck:scripts`、`pnpm test`、`pnpm e2e`、`pnpm eval`、`pnpm e2e:web`(最后一个必须在沙箱外跑)

---

### Task 1: 克隆 clowder-ai 并准备笔记目录

**Files:**
- 创建(临时,不提交):`/tmp/clowder-ai`(克隆)、`/tmp/clowder-notes/`(笔记)

**Interfaces:**
- Produces: `/tmp/clowder-ai/docs/features/F*.md`(309 份)、`/tmp/clowder-ai/docs/architecture/*.md`、`/tmp/clowder-ai/docs/{VISION,SOP,ROADMAP}.md` 供 Task 2 的子 agent 阅读;`/tmp/clowder-notes/` 空目录供子 agent 写笔记

- [ ] **Step 1: 浅克隆 clowder-ai**

```bash
git clone --depth 1 https://github.com/zts212653/clowder-ai /tmp/clowder-ai
mkdir -p /tmp/clowder-notes
```

- [ ] **Step 2: 验证关键文档存在**

```bash
ls /tmp/clowder-ai/docs/features/ | grep -c '^F[0-9]'   # 期望 300+
ls /tmp/clowder-ai/docs/VISION.md /tmp/clowder-ai/docs/SOP.md /tmp/clowder-ai/docs/architecture/a2a-protocol.md /tmp/clowder-ai/docs/architecture/memory-system-overview.md
```

Expected: 计数 ≥ 300;四个文件都列出、无 No such file。

### Task 2: 派 5 个并行子 agent 精读并写领域笔记

**Files:**
- 创建(临时,不提交):`/tmp/clowder-notes/10-a2a-routing.md`、`20-memory.md`、`30-approval-audit.md`、`40-identity-reliability.md`、`50-skills-sop-mcp-config.md`

**Interfaces:**
- Consumes: Task 1 的 `/tmp/clowder-ai`
- Produces: 5 份笔记,每份对覆盖的每份 F 文档按固定格式写一段(见下),供 Task 3 策展

**子 agent 通用指令**(每个子 agent 的 prompt 由下面这段 + 各自的文件清单拼成,逐字给):

> 你在为 meowbase(一个独立实现的多 Agent 协作平台)做 clowder-ai 的对账调研。只读 `/tmp/clowder-ai` 下的公开文档,不碰别的目录。
>
> 对清单里每份文档,读完后往你的输出文件追加一段,格式严格如下:
>
> ```
> ## F编号 标题(文件名)
> - 解决什么问题:一两句
> - 机制形状:它内部怎么做的(分层/状态机/数据流/触发时机),这是重点,写够 3-6 句,具体到机制名和文件级组件名
> - 落地状态:文档自报的 status(done / in-progress / spec 等)
> - 值得借鉴的判断或坑:一两句,没有就写「无」
> ```
>
> 不要评价 meowbase 该怎么做(那不是你的事),只忠实摘要 clowder 侧。读不动的文档(404/空)在笔记里记一行「跳过:原因」。

**5 个簇的清单**(同一条消息里发出 5 个 Agent 调用,并行):

1. **A2A/路由/接力** → 写 `/tmp/clowder-notes/10-a2a-routing.md`
   `docs/features/`: F002, F005, F027, F046, F055, F064, F078, F086, F122, F167, F185, F220, F224, F225, F233
   `docs/architecture/`: a2a-protocol.md, at-mention-routing-system.md
2. **记忆** → 写 `/tmp/clowder-notes/20-memory.md`
   `docs/features/`: F003, F102, F152, F163, F169, F186, F188, F200, F209, F218, F227, F256, F263, F271, F282
   `docs/architecture/`: memory-system-overview.md, memory-philosophy.md
3. **审批/审查/审计/可观测** → 写 `/tmp/clowder-notes/30-approval-audit.md`
   `docs/features/`: F008, F013, F031, F045, F051, F130, F133, F140, F150, F153, F217, F246
4. **身份/会话/可靠性** → 写 `/tmp/clowder-notes/40-identity-reliability.md`
   `docs/features/`: F048, F052, F053, F065, F118, F194, F211, F261, F298
5. **技能/SOP/MCP/配置** → 写 `/tmp/clowder-notes/50-skills-sop-mcp-config.md`
   `docs/features/`: F001, F004, F038, F041, F043, F062, F073, F083, F136, F145, F146, F228, F249, F286, F301
   `docs/`: VISION.md, SOP.md

- [ ] **Step 1: 并行发出 5 个子 agent**(general-purpose,各自带上面的通用指令 + 自己的清单)

- [ ] **Step 2: 验证 5 份笔记都产出且非空**

```bash
wc -l /tmp/clowder-notes/*.md   # 每份期望 50 行以上;grep -c '^## F' 看条数与清单大致对上
```

Expected: 5 份文件;`grep -c '^## F' /tmp/clowder-notes/*.md` 合计 ≥ 60。

### Task 3: 策展分母,写出 ALIGNMENT.md 完整内容

**Files:**
- Create: `docs/ALIGNMENT.md`

**Interfaces:**
- Consumes: Task 2 的 5 份笔记;meowbase 现状(见下面的预映对手表)
- Produces: `docs/ALIGNMENT.md`,Task 4 登记引用它

- [ ] **Step 1: 读 5 份笔记 + 预映对手表,策展分母**

分母标准(照设计稿):映射到愿景七件事(路由/线程/身份/记忆/技能/审批/审计)的 + README 点名缺口(邮箱/SOP/MCP/review 回流)的,进分母;游戏/语音/硬件/IM 网关/桌面发布/视频/陪伴引擎标「有意不做」,不计入分母。目标 ~30 条,宁小勿大。

**预映对手表**(执行者以此起步,读笔记后可调整;meowbase 证据都在 `docs/features/` 或协议表):

| clowder | meowbase 现状预判 |
|---|---|
| F002 agent-to-agent | 已对齐候选:`a2a.md`/`async-a2a.md`/`docs/A2A.md` |
| F005 a2a-follow-up | 已对齐候选:`exit-nudge.md`(补问) |
| F046 anti-drift | 已对齐候选:协议表行首 `@` 路由(`mention-routing.md`,README 明写对齐 F046) |
| F167 a2a-chain-quality | 部分对齐候选:`void-handoff-gate.md`/`one-hop-per-thread.md`(虚空传球、同树互斥有;乒乓球熔断待确认) |
| F013 audit-log | 已对齐候选:`audit-trail.md`(store 边界自动落流水) |
| F008 token 可观测 | 部分对齐候选:`quota-board.md`(账本有,预算闸没有) |
| F031 review 两层 | 部分对齐候选:`review-conclusion.md`/`risk-routed-reviewer.md` |
| F140 github-pr-automation | 部分对齐候选:`pr-open.md`/`approval-void.md`(开 PR/合了就停有;review 回流、CI 追踪没有) |
| F048 restart-recovery | 已对齐候选:`durable-relay.md`/`hop-commit-then-clear.md` |
| F052 身份隔离 | 部分对齐候选:线程沙箱 + worktree(`thread-repo-worktree.md`) |
| F186 library-memory | 部分对齐候选:`memory-evidence.md`/`memory-scope.md`(按仓划界+出处有;写道/派生视图/生命周期没有) |
| F038 skills-discovery | 部分对齐候选:`skills.md`(触发词注入有;发现机制、效果度量没有) |
| F043/F145/F249/F286 MCP 系 | 缺失(README 明写的形态缺口) |
| SOP(docs/SOP.md、F073/F083) | 缺失 |
| 邮箱/消息队列(F039/F117/F122/F175) | 缺失或部分(pending-runner 续跑有,邮箱形态待确认) |

- [ ] **Step 2: 写 `docs/ALIGNMENT.md`**

结构严格如下(示例行是给执行者的成品示范,照这个粒度写全部分母行):

```markdown
# clowder 对齐总账

> 唯一权威计分处:我们对齐到参考项目的百分之几、每条什么状态、下一条建议补什么。
> 策展标准与「有意不做」规则见设计稿 docs/superpowers/specs/2026-09-05-clowder-alignment-ledger-design.md。
> 对内工作文档,不对外;对外叙事讲「我做了什么、为什么」。

**当前对齐率:已对齐 N / 分母 M = P%**(每次相关改动同轮更新)

## 分母(核心清单)

| # | 条目 | 状态 | clowder 出处 | meowbase 证据 | 面试钩子 |
|---|---|---|---|---|---|
| 1 | 防漂移消息协议 | 已对齐 | [F046](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F046-anti-drift-protocol.md) | [AGENTS.md 协议表](../AGENTS.md)、[mention-routing](../features/mention-routing.md) | 只有行首 @ 才路由——我用一张协议表把「人打的/猫写的/平台自己做的」三种语法彻底分开,句中 @ 不路由 |
| 2 | GitHub PR 自动化 | 部分对齐(差 review 回流、CI 追踪) | [F140](...) | [pr-open](../features/pr-open.md)、[approval-void](../features/approval-void.md) | 猫能自己开 PR,合了平台自己停——但 PR 上的 review comment 还不会流回来叫醒猫 |
| … | … | … | … | … | … |

## 有意不做(不计入分母)

| 条目 | clowder 出处 | 不做的理由 |
|---|---|---|
| 游戏引擎(狼人杀/像素格斗等) | F090/F101/F107/F119/F170 | 和「多 Agent 协作平台」的核心叙事无关,机制复杂度全在游戏本身 |
| … | … | … |

## 补缺口的建议顺序

按「面试叙事价值 × 工程依赖 × 成本(不花钱优先)」排,每条开工前仍先写薄设计、等人点头:

1. …(每条一句:补什么、为什么排这、预计拆几次改动)
```

填写规则:
- 每条状态四选一:`已对齐` / `部分对齐(差什么)` / `缺失` / `有意不做`
- 「已对齐」必须过机制级判定:读笔记里的「机制形状」,meowbase 侧能找到同形状的机制才算;只是能力同名就标「部分对齐」并在括号里写差哪层
- meowbase 证据一律给仓库内相对链接(功能稿/协议表/代码文件);缺失的空着
- 面试钩子第一人称,一句,讲判断不讲对齐
- 「有意不做」表尽量完整(游戏/语音/硬件/IM 网关/桌面发布/视频/陪伴引擎至少各一行),每条一句理由
- 建议顺序给 5-8 条,已知的优先候选:邮箱/SOP/MCP 三形态、F140 的 review 回流与 CI 追踪、预算闸、技能效果度量

- [ ] **Step 3: 自查总账质量(这一刀的「测试」)**

```bash
# 每个「已对齐」行必须有 meowbase 证据链接,且链接目标存在
grep -c '已对齐' docs/ALIGNMENT.md
# 手工抽查:逐条点 meowbase 证据链接,文件都必须真实存在
# 分母计数与对齐率重算一遍,和顶部的 N/M/P% 对上
```

Expected: 证据链接全部指向真实文件;对齐率算术正确;「有意不做」每条有理由。

### Task 4: 登记文档地图 + 更新 PROGRESS.md

**Files:**
- Modify: `docs/README.md`(文档地图,按现有格式加一行指向 `ALIGNMENT.md`)
- Modify: `docs/PROGRESS.md`(「现在停在哪」段就地改 + 增量记录加一条)

**Interfaces:**
- Consumes: Task 3 的 `docs/ALIGNMENT.md`

- [ ] **Step 1: `docs/README.md` 加一行**

先读 `docs/README.md` 看现有条目格式,照格式把 `ALIGNMENT.md` 加进去(一句话:它是什么、什么时候看)。

- [ ] **Step 2: `docs/PROGRESS.md` 更新两处**

1. 「现在停在哪」段:就地改成「上一刀:clowder 对齐总账(docs/ALIGNMENT.md)。补缺口从总账的建议顺序里挑,每条仍先写薄设计。」
2. 「增量记录」顶部加一条,标题与最终 commit 标题一致(`docs: clowder 对齐总账`),四栏写齐:动了什么(纯文档:ALIGNMENT.md + 两个登记)、与设计稿的偏离及原因(没有就写无)、只有人手验过的部分(总账条目状态是读公开文档+对账得出的判断,没有自动化验证;子 agent 笔记在 /tmp 没提交)、留了没做(分母外的条目不追;后续补缺口的实现各自单独立设计)

守 PROGRESS 自己的规矩:不写测试数/篇数等会腐烂的数字。

### Task 5: 六道闸 + 一次提交

**Files:**
- 以上全部,一次提交

- [ ] **Step 1: 六道闸**

```bash
pnpm -r build && pnpm typecheck:scripts && pnpm test && pnpm e2e && pnpm eval
git restore docs/eval.md   # eval 重写的脏文件,不提交
pnpm e2e:web               # 必须在沙箱外跑
```

Expected: 全绿(纯文档改动,预期与基线一致;若 e2e/eval 红,先对照 AGENTS.md 踩坑 17/22/24 和 PROGRESS 里「记分板飘」那条已知问题,别假设是自己弄坏的——本刀没碰代码)。

- [ ] **Step 2: 一次提交**

```bash
git status   # 确认只有三个文件:docs/ALIGNMENT.md、docs/README.md、docs/PROGRESS.md;meowbase.config.json 不在里面
git add docs/ALIGNMENT.md docs/README.md docs/PROGRESS.md
git commit -m "docs: clowder 对齐总账"
```

- [ ] **Step 3: 给人看,不推**

报告:对齐率、分母条数、建议顺序前 3 条、六道闸结果。推 main 由人拍板。
