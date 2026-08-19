# 系统消息带类型

- 状态:`已落地`
- 对照 clowder:公开 README 写 **Rich blocks — agents reply with structured cards: code diffs, checklists, interactive decisions, not just walls of text**，配上 unified message layer 和飞书端「每只猫一张独立卡片」。语义是:消息本身带结构，各个渲染端按结构渲染，不靠读正文猜。
- 靠拢:拿「消息带结构、渲染端不猜正文」这一条。本刀只结构化**平台自己写的**系统消息——那些字面上就是平台写的，字段本来就在手里，白送。猫的回复仍是纯文本:要猫产出 block 得改提示词契约和三家解析器，是另一篇。

## 门（各一句）

- **功能**：顶栏球权和接力时间线不再因为改一句文案就静默失灵；「这是哪种事件」全仓库只有一处判定。
- **价值**：人少担一件事——按仓库规矩改文案时不用怕 UI 悄悄坏；出问题时能看出平台当时**认定**的是哪种事件，不用回去读正则猜。
- **愿景**：仍是邮差。邮差在信封上写清这是哪类信，不改信的内容，也不替猫做判断。
- **落点**：`shared` 的 `Message` 类型和 12 个 formatter 旁边、`api` 那 20 处 `role: 'system'` 写入点、`web/lib/ball.ts` 改读字段。不新开心脏。

## 为什么

现在前端是靠**中文子串匹配系统消息正文**把球权重建出来的：`includes('球还在地上')`、`includes('审批卡片') && !includes('已自动批准')`、`includes('已拉闸') && includes('星星罐子')`，下一棒是谁靠 `split('→').pop()` 从第一行文案里抠。三个后果都是实的：

1. **后端明明知道答案，却序列化成散文让前端解析回来**。平台写那条消息时手里有 `to: 'gemini'`，落成「接力: 墨墨 → 团团」，前端再抠出**显示名**——抠出来的不是 id，所以时间线那条 `touch(to, 'active')` 连 agentId 都传不了，认不回是哪只猫。
2. **改一个字就静默坏掉**。改文案时 `AGENTS.md` 协议表会同轮改，但顶栏会悄悄失灵；web 的测试断言的是同一批硬编码字符串，所以改完既不会红、也测不出来。
3. **同一份判定存两份**。[review-conclusion.md](review-conclusion.md) 那个 bug 就得在 `shared` 和 `web` 各修一遍。

不打标签的话，后面每加一种系统消息都在给这三条加码；审计流水也只能按文案记，而不是按事件类型记。

## 怎么做

1. **`Message` 加两个可选字段**：`systemKind?: SystemKind` 和 `systemMeta?`（只放渲染真的要用的，第一刀基本就是 `{ from?: AgentId; to?: AgentId }`）。可选是为了老消息——它们没有 kind，前端保留现有散文兜底。
2. **一个 formatter 一个 kind**，跟着 `shared/src/a2a.ts` 现有那些走：`relay` / `dropped` / `escalated` / `hold` / `hold-command-done` / `hold-command-restart` / `freeze` / `aborted` / `failed` / `exit-nudge` / `routing-hint` / `approval-pending` / `approval-applied`，外加一个 `notice`（见下）。**不新增文案、不改文案**，这一刀纯打标签，行为零变化。
3. **写入点靠类型强制带上 kind**，不靠人记得。做法是把 append 的入参改成**判别联合**：`role: 'system'` 时 `systemKind` 必填，`user` / `assistant` 用 `systemKind?: never` 挡住。将来任何新写入点忘了打标就编译不过，而且不用碰排队路径——写队列串行化那条（`AGENTS.md` 踩坑 7）一行没动。比原稿的 `appendSystem(kind, …)` helper 强：helper 挡不住有人绕过它直接 append。
4. **前端改读字段**：`ball.ts` 的十来个探针换成 `systemKind` 分支，`systemMeta.to` 直接给 agentId，时间线不再靠 `split('→')`。无 kind 的老消息落到现有分支，现有测试原样留着当兜底的回归网。
5. **验收**：把「球还在地上」这句文案改一个字，顶栏和时间线照旧正确（现在会失灵）；翻回改造前建的老线程，显示不变。

## 不做（本篇）

- **猫的回复结构化 / 富卡片**（diff 卡、清单、可点决策）：那是 clowder 的大头，要动提示词契约和三家解析器，另开篇。本刀只碰平台自己写的那些。
- **`Thread.ball` 物化状态机**：先有类型化事件，再决定要不要存第二份真相——第二份真相要在十来个转换点保持同步，还得考虑重启和那一棒重跑，代价见 [hop-commit-then-clear.md](hop-commit-then-clear.md)。
- **审计流水**：kind 是它的前置，本篇只打标不落库。
- **删掉 web 那份结论解析副本**：审查结论来自**猫的正文**，不是系统消息，本刀盖不到。落地后大部分球权场景会走 kind（打回、通过后的球权都由平台写系统消息），但那份副本仍留着兜底，删它另开篇。

## 落地时定的几件事（稿子没写）

- **多了一个 `notice`**。判别联合要求每条系统消息都有 kind，但有 7 处写入点既没有对应 formatter、也不能套已有 kind——证据回执（`#confirm` / `#reject` / `#approve` 的成功和找不到）、`#learn` 建议沉淀、`⚠️ 没有可执行的任务文本`、`⚠️ 接力链已达上限`、`🤝 审查:` 开场。套已有 kind 会**改顶栏行为**（比如把审查开场标 `relay`，顶栏就会说「球在审查官手上」），所以给它们一个明确的「有正文、不参与球权」的桶。代价是 `notice` 可能变成偷懒的默认值——下次新增系统消息时，先问一句这条要不要参与球权，再决定是不是 `notice`。
- **`hop-interrupted` 没进枚举**。它是助手消息的 `error` 文本（「平台重启,这一跳没写完」），不是系统消息，放进 `SystemKind` 会让类型说谎。
- **`aborted` / `failed` 归到掉球**。这两句文案本身就含「球还在地上」，所以前端把它们和 `dropped` 一起认，是等价改写不是行为改动。
- **时间线对「打回」仍不新开一跳**，和改造前一致：有 `relay` kind 时按正文里是否含「打回:」区分，避免互审中途时间线变样。
- **`systemMeta` 只有 `{ from, to }`**。审批卡的 `ap_` id 和改动统计仍从正文抠——那是卡片解析，不是球权，本刀不扩。

## 入口

- 类型 `SystemKind` / `SystemMeta` / `Message.systemKind`：`packages/shared/src/types.ts`
- 编译强制（判别联合 `AppendMessageInput`）：`packages/api/src/stores/ports.ts`
- 打标的写入点：`packages/api/src/router/turn/`（`segment.ts` / `review.ts` / `system-commands.ts` / `settle.ts` / `hold.ts`）、`router/execute-turn.ts`、`router/pending-runner.ts`
- 落库带上新字段：`packages/api/src/stores/{memory,redis}.ts`（两边都是手工拼 `Message`，不加字段会静默丢）
- 前端改读字段：`packages/web/lib/ball.ts`、`lib/parse-message.ts`、`lib/relay-note.ts`、`components/MessageBubble.tsx`；DTO 透传在 `lib/api.ts`
- 单测：`packages/web/lib/__tests__/ball.test.ts`（改文案仍认对状态）、`packages/api/test/execute-turn.test.ts`（交棒那条带 `relay` + `systemMeta.to`）
