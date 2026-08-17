# 功能设计

实现某个功能之前，先在这里写清：**为什么这样设计、需要怎么做、面试怎么讲**。代码是结果，这篇是你能在面试里画出来的那张图。

对照 clowder 公开功能稿：他们每篇有 Why / What / 不做 / Key Decisions / AC。我们拿这四个格子，再加上喵窝自己的门（功能 / 价值 / 愿景 / 架构落点）。不抄他们的 F055 `targetCats`、邮箱、SOP 正文。

## 怎么用（实现前）

1. 对照 clowder 公开 README / TIPS / `docs/features` / issue：同一问题他们怎么处理，只记语义和踩坑。
2. 复制 [_template.md](_template.md)，文件名用短横线英文（如 `mention-routing.md`）。
3. 四个门对不上或要新开邮箱 / SOP / MCP / 第二路由器：在「不做什么」写明，或把状态标成 `设计中` 再讨论，不要先写代码。
4. 落地后把状态改成 `已落地`，代码入口填真路径。协议变了同一轮改本篇 + `AGENTS.md` / `README.md` / `DEMO.md`。

旧计划稿 `docs/superpowers/plans/` 不改写。总设计若写了现行语义，同步一句并链到本篇。

## 面试怎么用

- 开场 30 秒：用「面试能讲 → 30 秒」。
- 追问为什么不做成 X：用「为什么这样设计」和「不做什么」。
- 追问怎么落地：用「怎么做」和「代码入口」，必要时打开 `docs/A2A.md` 或 `execute-turn.ts`。
- 追问下一步：用状态为 `设计中` 的篇（现在是 [async-a2a.md](async-a2a.md)）。

## 索引

| 篇 | 状态 | 一句话 | 面试常问 |
|---|---|---|---|
| [execute-turn.md](execute-turn.md) | 已落地 | 一条消息的心脏 | 平台凭什么不推理还叫平台 |
| [mention-routing.md](mention-routing.md) | 已落地 | 人和猫都只认行首 `@` | 句中 @ 为什么不路由 |
| [a2a.md](a2a.md) | 已落地 | 同一轮同步接力 + 交接包 | 猫怎么传话、怎么不串台 |
| [memory-evidence.md](memory-evidence.md) | 已落地 | 人确认过的才是公共记忆 | 和向量库 / 聊天历史有何不同 |
| [approval.md](approval.md) | 已落地 | diff 建卡、另一只猫审、人批落地 | 审批状态机、为何自动拉审查 |
| [providers.md](providers.md) | 已落地 | 三家 CLI 统一 `runTurn` | 适配器踩坑、会话怎么续 |
| [skills.md](skills.md) | 已落地 | 触发词当轮注入，不常驻 | 为什么不当成 SOP 引擎 |
| [async-a2a.md](async-a2a.md) | 设计中 | 往 clowder 靠的第一刀：人能离开 | 同步 vs 异步怎么选 |
