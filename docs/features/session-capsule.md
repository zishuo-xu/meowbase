# 新会话带上已确认证据

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F065 —— 压缩/冷启动后新 session 几乎空白;续接靠搜索和一小段快照,不让快没上下文的旧猫写总结。
- 靠拢:拿「新 session 开场喂本线程已确认证据胶囊」。差在任务板快照和 LLM 摘要:本篇只喂人签过的证据,条数封顶。

## 门（各一句）

- **功能**：某只猫没有可 resume 的 sessionId 时,这一跳的 system prompt 带上本线程已确认证据(最多 8 条)。有 session 则不重复灌。
- **价值**：压缩或换会话后不必把约定再打一遍;面试能讲「续接胶囊不是旧猫的临终总结」。
- **愿景**：仍是邮差。胶囊是已盖章的信封摘要,不是整箱旧信。
- **落点**：`formatSessionCapsule`;`buildSystemPrompt` 的 `sessionCapsule`;`runSegment` 在 `thread.sessions[agent]` 为空时装上。

## 为什么

重启捡棒已经有了,跨会话记忆没有。对照他们:不要让快没 context 的旧猫写总结。喵窝已有人签证据,正好当胶囊。不做成 X:新 session 开口像失忆。

只喂 confirmed。draft 不算。按确认时间新的在前,最多 8 条。

## 怎么做

1. `selectSessionCapsule(entries)`:status=confirmed,按 confirmedAt 新到旧,最多 8。
2. `formatSessionCapsule(entries)`:标明「续接胶囊,不是本轮指令」。
3. 没有 `thread.sessions[currentAgent]` 时把胶囊并进 `evidenceRefs`(去重)。有 session 则不加。
4. 验收:确认一条「偏好 TS」,清掉该猫 session 再开口,system prompt 含这条;有 sessionId 时不含「续接胶囊」标题。

## 不做（本篇）

- 让旧猫写 handoff.md
- 注入整条时间线
- 任务板快照

## 入口

- 挑选:`packages/shared/src/evidence-recall.ts` `selectSessionCapsule`
- 标题:`formatSessionCapsuleHeading`
- 装上:`packages/api/src/router/turn/segment.ts` 无 session 时合并本线程已确认证据
