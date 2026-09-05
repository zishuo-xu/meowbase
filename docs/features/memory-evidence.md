# 证据：人点头才算公共记忆

- 状态:`已落地`
- 对照 clowder:TIPS「猫猫有记忆」——可以说「之前讨论过」，会搜知识库。公开能力表是 Evidence / lessons / decisions。我们对齐「能被问出来」，写入必须人确认。
- 相关:[docs/A2A.md](../A2A.md) §4

## 功能

`#learn` 出 draft，`#confirm` 入库。`#ev_xxx` 或「之前 / 我们约定 / 讨论过」+ 关键词，把已确认证据注入当轮。

## 价值

团队有一份不会被模型幻觉改写的记分牌。面试能讲清「记忆 ≠ 把历史对话全塞回去」。

## 愿景

公共真相由人签。平台只存、只匹配、只注入。猫口头「我们决定过」不算。

## 架构落点

解析在 shared（`#learn` / `#confirm` / `#ev_` / `wantsEvidenceRecall` + `matchEvidence`）。`executeTurn` 在叫猫前注入。存储走 Memory/Evidence 端口。

## 为什么这样设计

根因：自动把每轮回复当记忆，库会全是噪音；向量检索面试好听，但本项目要的是「人能指着一条证据说就是这个」。

| # | 决策 | 理由 |
|---|---|---|
| D1 | 显式 `#learn`，不每轮自动建议 | 避免刷屏；和总设计「自动建议」的差异写在旧 M2 稿，现行以本篇为准 |
| D2 | 未确认不注入 | draft 只是提议 |
| D3 | 「之前约定」只匹配已确认，可跨线程 | 对齐他们「不用重讲旧会话」；仍是片段，不是整段对话。**范围已收窄**:按仓划界,空沙箱只看自己,见 [memory-scope.md](memory-scope.md) |
| D4 | 不做向量库 | 关键词 + 标题/正文足够演示和可控 |

## 怎么做

1. 用户带 `#learn 标题` → 本轮猫回复后建 `ev_` draft + 系统句请确认。
2. `#confirm ev_xxx` 不叫猫，状态改为 confirmed。
3. 叫猫前：收集 `#ev_` 与召回匹配，拼进 `buildSystemPrompt` 的团队记忆段。

验收：确认一条「用户偏好 TypeScript」，新线程说「之前我们约定用 TypeScript」，猫开口带着这条。

## 不做什么

- 不向量检索、不自动当「公共大脑」
- 不把旧线程全文贴进新线程
- 不让猫自己 `#confirm`

## 面试能讲

- **30 秒**：记忆分两层。各猫 CLI session 是私人草稿纸。证据库是人签过的公共板。问「之前约定」是查板，不是翻聊天。
- **追问「为什么要人确认」**：模型喜欢把猜测写成决定。人一签，审查和下一线程才敢用。
- **踩坑**：Redis 测试用唯一 id，避免旧证据污染断言。
- **若继续往 clowder 靠**：他们有更重的记忆生命周期 / 召回评测。我们先保持「可指认的条目」，再谈检索策略。

## 代码入口

- 召回：`packages/shared/src/evidence-recall.ts`
- 拼装：`packages/shared/src/system-prompt.ts`
- 管线：`executeTurn` 里 `#learn` / `#confirm` / 注入
- 确认后的纸本见 [memory-files.md](memory-files.md)
