# 没证据不能当通过

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

开篇先想：同一问题他们公开怎么设计，这一刀能靠多近。能靠就靠；本刀没更近，写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`（补记已有代码）
- 对照 clowder:公开 quality-gate / receive-review — 自检要带命令和结果；没证据不能放行。
- 靠拢:只闸「通过」和 autoApprove。不搬 SOP 五件套，不拦行首 `@`。

## 门（各一句）

- **功能**：审查官写「通过」但没有本轮命令+结果时，卡片提示不算通过，也不会自动落地
- **价值**：人不用猜猫有没有真跑过
- **愿景**：邮差查证据字段，不替猫跑测试
- **落点**：`hasVerificationEvidence` / `gateReviewVerdict` / `allowsAutoApprove` → `executeTurn` 建卡

## 为什么

只靠模型说「我测过了」，跨模型审查的价值没了。他们对齐的是证据闸，不是信任自述。

## 怎么做

1. 回复里同时有命令和结果 → 有验证证据。写「跑不了:原因」算诚实，不够当通过。
2. `parseReviewVerdict` 为通过且没证据 → `incomplete`；autoApprove 不落地。
3. 卡片带「结论不算通过:没有本轮验证证据」。
4. 验收：结论写通过、正文没有命令+结果 → 不 `applied`。
5. 建卡时把已经算好的门控结果写进 `systemMeta.verdict`（`pass` / `revise` / `incomplete`）。卡片标题优先读这个字段，不再从正文重推结论。`incomplete` 的标题是「缺验证证据，待你决定」，绝不能再写「审查通过」。老消息没有 verdict 时才退回正文判断。

真实跑里审查官写了「结论:通过」但没给本轮验证证据，正文已经是「结论不算通过」，标题却仍写「审查通过，待你确认」——标题更显眼，口径相反。这和 [system-message-kind.md](system-message-kind.md) 是同一类病：平台知道答案，却让前端猜。

## 不做（本篇）

- quality-gate 全阶段看板
- 没测试文件就禁止交接
- 向量检索

## 面试能讲

- **30 秒**：审查不是投票。通过必须带本轮命令和结果；平台认字段，不认「应该有测试」。
- **追问「和 CI 有何不同」**：CI 是规则；这里是另一只猫的叙述必须可核对。人仍握合并权。
- **和他们的差**：他们有 SOP 自检报告。我们只闸关键词，简历讲的是门禁语义。

## 入口

- `hasVerificationEvidence`：`packages/shared/src/verification.ts`
- `gateReviewVerdict` / `allowsAutoApprove`：`packages/shared/src/review-verdict.ts`
- 建卡文案 + `systemMeta.verdict`：`packages/api/src/router/turn/review.ts`
- 卡片标题：`packages/web/lib/parse-message.ts` 的 `approvalCardTitle`
