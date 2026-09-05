# 记忆召回度量

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F200 —— 记忆召回要能量,用真实行为信号,不用猫自评「我用上了」。
- 靠拢:拿「打开就能看见注入几次、正文点名几次」。差在离线评测集和标注员打分:本篇和账本同一口径,扫已完成助手消息再聚合。

## 门（各一句）

- **功能**：Hub 能看见每条证据被塞进提示词几次、猫正文里点了几次 `#ev_`。
- **价值**：面试能讲「召回有没有用上,不靠猫自己说」;自用不用翻时间线猜。
- **愿景**：仍是邮差。邮局记袋子里塞过哪几封、回信有没有点名;不判断记没记住。
- **落点**：跳完成时记下 `evidenceIds`;引用读正文里的 `#ev_`。纯函数聚合 + `GET /api/usage/memory` + Hub 一页。

## 为什么

证据已经能确认、划界、注入,但没有任何合计。对照他们:评测要行为信号。喵窝差的是读侧。不另开计数器——消息才是真相。不让猫打分。

注入 ≠ 用上。注入是平台塞进去;引用是猫写出了 `#ev_xxx`。两格分开,空着就空着,不写 0 充门面。

## 怎么做

1. 助手消息加可选 `evidenceIds`:这一跳实际塞进 system prompt 的证据 id(点名、关键词召回、续接胶囊都算)。
2. `sumEvidenceRecall`:只算 `assistant` + `completed`。注入按 id 累加;引用用 `parseEvidenceRefs` 扫正文。
3. `GET /api/usage/memory?threadId=`(不给就是全部)。Hub 加「记忆」页:总注入 / 总引用、两张表。当前线程 / 全部切换跟账本同一套。
4. 验收:确认一条再打「之前约定」,该跳 `evidenceIds` 含这条,接口注入 count=1;正文写出 `#ev_xxx` 则引用 count=1。没记录时空态。

## 不做（本篇）

- 离线评测集、人工标注、nDCG
- 让猫自评「我用上了」
- 按日趋势、按仓拆表

## 入口

- 聚合:`packages/shared/src/evidence-recall.ts` `sumEvidenceRecall`
- 跳上记下证据:`packages/api/src/router/turn/agent-hop.ts` `evidenceIds`
- 读侧:`packages/api/src/services/usage.ts` `loadEvidenceRecall`、`GET /api/usage/memory`
- Hub:`packages/web/components/TeamHub.tsx` 记忆页
