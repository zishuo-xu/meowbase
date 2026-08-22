# A2A：猫怎么协作

对照 clowder 公开能力：他们是异步邮箱 + 结构化 packet + 线程隔离 + 共享证据。我们只拿语义：交棒后本轮先结束，平台自己续跑。不建 mailbox，不 MCP 派球，不把另一只猫的 CLI 会话读过来。

设计理由见 [features/a2a.md](features/a2a.md)。现行补问见 [features/exit-nudge.md](features/exit-nudge.md)。空手不传见 [features/void-handoff-gate.md](features/void-handoff-gate.md)。

人在页面上看到的是一条线程。平台在底下拆成：谁该开口、这一棒带什么字、各猫自己的 CLI 记忆、大家共用的沙箱和证据。

## 四件事，我们有没有

| 问题 | 有没有 | 落在哪 |
|---|---|---|
| 怎么交互 | 有。谁打什么见 [AGENTS.md](../AGENTS.md) 协议表 | `mention-targets.ts` / `a2a.ts` / `executeTurn` |
| 怎么传信息 | 有。平台拼**交接包**当下一棒的 prompt，不是两只猫共用一个聊天窗 | `formatA2AHandoffPrompt` |
| 怎么保持独立上下文 | 有。每只猫在本线程有自己的 CLI `sessionId`（`--resume`）；身份和技能按猫注入 | `thread.sessions[agentId]` |
| 怎么维护公共信息 | 有。线程消息、沙箱文件、已确认证据、名册身份。没有第三只「公共大脑」 | 消息库 / `work/<threadId>/` / 证据库 |

没有的：邮箱队列、跨线程自动读对方 session、向量记忆网、SOP 五件套。公共信息靠人确认的证据和沙箱里的文件，不靠猫之间私聊。

## 1. 怎么交互

谁打什么、平台读哪一段正文、什么时候建卡 / 补问 / 拦空手，见 [AGENTS.md](../AGENTS.md) 协议表。这里只记协作怎么拆：

一条用户消息进 `executeTurn`。人打的系统命令就地处理、不叫猫；行首 `@` 决定本轮目标，每个目标跑一条 A2A 链。猫交棒后本轮先结束，平台记下 pending、自己续跑下一只。并行组之间互不接力；组内才串行交棒。写 Redis 走队列，避免两只猫同时 append 丢更新。已出场的猫不再回来（防环）。

```
人: 写 add.ts，写完自检。
    @墨墨
        │
        ▼
   墨墨（自己的 CLI 会话 + 沙箱）
        │ 行首 @闪闪 请审查
        ▼
   本轮先结束，球在闪闪（pending）
        │ 平台自己续跑
        ▼
   平台拼交接包 → 闪闪（自己的 CLI 会话 + 同一沙箱）
        │ 结论:通过
        ▼
   审批卡 → 人批准落地
```

## 2. 怎么传递信息

猫之间**不共享对话框**。下一棒看到的是平台写的一封短信，函数是 `formatA2AHandoffPrompt`：

- 来自谁
- 用户原目标
- 本轮改动文件（`git` 相对 HEAD，已去掉 `node_modules`）
- 上一棒有没有带命令和结果
- 沙箱绝对路径
- 上一棒原话（去掉行首 `@` 行，过长截断）
- 【你的任务】= 行首 `@` 后面那句
- 【收棒】审查官停、写手继续交

人在 UI 里点 `🤝 接力` 看到的是同一份摘要，不是另一套管线。

第一棒（人直接点的猫）没有交接包，prompt 就是剥掉行首 `@` 之后的任务正文。

## 3. 怎么保持独立上下文

三层隔离，漏一层就会串台：

**线程**  
每条会话自己的 `threadId`、消息列表、`work/<threadId>/`。线程 A 的文件和证据默认不进线程 B 的沙箱。证据召回是例外：人说「之前约定」时，平台从**已确认**证据里按关键词匹配，可以跨线程注入，但仍是只读片段，不是把旧线程整段对话贴过来。

**猫**  
`thread.sessions` 是 `agentId → CLI sessionId`。墨墨 `--resume` 墨墨的会话，闪闪 resume 闪闪的。平台**不会**把墨墨的 CLI 历史喂给闪闪。闪闪要看产物，看交接包和沙箱文件。

**这一跳的提示词**  
`buildSystemPrompt` 按**当前这只猫**拼：名字/角色、名册纪律、命中的技能、本轮证据、沙箱路径。团团不会拿到「你是墨墨」。

因此：独立的是「我是谁 + 我的 CLI 记忆」；共享的是「这个线程的地板和记分牌」。

## 4. 怎么维护公共信息

| 公共物 | 谁写 | 谁读 | 人怎么管 |
|---|---|---|---|
| 线程消息 | 人、猫、平台系统句 | 人看完整时间线；猫不当作自动历史（见上） | 就是聊天记录 |
| 沙箱文件 | 猫在 `thread.workdir` 里写 | 下一棒、审查、diff、审批卡 | 批准后 `git commit` 落地 |
| 证据 | `#learn` 出 draft，`#confirm` 才算数 | `#ev_xxx` 或「之前约定」+ 关键词注入当轮 | 没确认的不进公共记忆 |
| 名册身份 | 配置 / Hub | 每跳 system prompt | 改 `handoffTo` 即改交给谁 |
| 技能 | `skills/` 文件 | 触发词命中才注入当轮 | 加 md + manifest，不改路由 |
| 审批卡 | 平台见 diff 后建 | 人批/打回；审查意见挂在卡上 | `#approve` / `#reject` |

没有单独的「团队 wiki 进程」。公共真相 = 人点头的证据 + 沙箱里的文件 + 名册。猫的口头「我们决定过」不算，除非进了证据库。

## 和 clowder 差在哪（只记语义）

他们公开写：A2A 是异步消息、线程隔离、结构化 handoff、共享记忆。后来还加了邮箱、MCP 派球、session 压缩交接。

我们：交棒后本轮先结束，下一跳进 pending，平台自己续跑。交接包仍是 prompt 字符串。不要邮箱。补问 / 空手不传见协议表。

## 代码入口

- 人怎么点名：`packages/shared/src/mention-targets.ts`
- 猫怎么交棒 / 交接包：`packages/shared/src/a2a.ts`
- 一轮怎么跑完：`packages/api/src/router/execute-turn.ts`（`followPendingChain` / `resumePendingTurn`）
- 重启后谁捡棒：`packages/api/src/router/pending-runner.ts`
- 身份 + 证据怎么进提示：`packages/shared/src/system-prompt.ts`
- 点哪里能看见：`docs/DEMO.md`
