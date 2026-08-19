# 审计流水

- 状态:`已落地`
- 对照 clowder:公开三层表里平台那一格写的就是 **Identity, collaboration, discipline, audit**，对面是 *Reasoning (that's the model's job)*；另有公开能力 **Quota Board — real-time token usage and cost tracking per agent**。（他们 README 里的 *Need Audit* 是 PRD 需求审计、意图卡那套，**不是**这条，别混。）
- 靠拢:拿「平台留可查的账」这一条，做成最薄的一片:追加式流水 + 一个只读接口。Quota Board 那条**数据其实已经躺在 `Message.usage` 里**（适配器解析、`execute-turn` 落库），差的只是读侧聚合和一块看板——那是下一篇，本篇不碰，守「一次一刀」。

## 门（各一句）

- **功能**：人能事后问「这条链上都发生过什么」，按线程／按谁／按动作／按时间查，而不是去翻终端。
- **价值**：出事时不用复现。球停在哪一跳、谁交给谁、哪张卡谁批的、重启后哪一棒被强抢重跑过——都有一行可指认的记录。
- **愿景**：仍是邮差。审计是邮局的收发存根，平台记「谁在什么时候把什么交给了谁」，不记也不评判猫想了什么。
- **落点**：新 `AuditStore` 端口（memory + redis）、仿 `http/broadcast-sync.ts` 的 store 装饰器、`router/pending-runner.ts` 那几处已有的日志点、一个只读 `GET /api/audit`。不新开第二心脏。

## 为什么

**我们刚建了一台不小的机器，它的全部证据只有 `console.log`。** 抢租约、开机强抢、收尸接管、跳过搁太久的旧棒、那一棒重跑——这些事件现在只在终端里滚过去：不可按线程过滤、不可按时间回溯、进程一重启就没了。调 [durable-relay.md](durable-relay.md) 的时候我们是靠 `rg` 翻 `dev.log` 才逮到 `resume sweep n=0` 那条线索的，那不该是常态。

而且这是愿景那句「平台只做路由、线程、身份、记忆、技能、审批、审计」里**唯一还没兑现的词**。审批有卡、记忆有证据、路由有系统消息，审计是空的。

刚落地的 [system-message-kind.md](system-message-kind.md) 正好是它的前置：审计行可以按事件类型记（`relay` / `escalated` / `approval-pending`…），而不是把中文句子塞进 `action` 字段——否则审计自己又会变成「靠匹配正文才能查」的东西，等于把刚修掉的毛病换个地方犯一遍。

## 怎么做

1. **`AuditStore` 端口 + 行结构**：`{ id, ts, threadId, actor, action, subject?, meta? }`。`actor` 是 agentId 或 `human` 或 `platform`；`action` 用枚举，系统消息那部分直接复用 `SystemKind`。追加式，只写不改，memory + redis 两套实现。
2. **在 store 边界派生，不在三十个调用点手写**。仿 `packages/api/src/http/broadcast-sync.ts` 那个装饰器：包一层 `MessageStore` / `ApprovalStore`，系统消息带 kind 落一行，助手消息 patch 成 `completed` 落一行（带 `usage`），人发言落一行，审批 create／approve／reject／applied 各落一行。**业务代码一行不改，也不存在「新写入点忘了记」这回事**——和这一批前面几刀同一个原则：能让边界管的事，不要靠人记得。
3. **不经过 store 的那几件事显式补**。租约生命周期在 `router/pending-runner.ts`，那里本来就有 `write(formatTurnLog('resume claim', …))` 这样的日志点，在旁边补审计行：claim / steal / skip-stale / 重跑 / 释放。就这几处，够了。
4. **只存指针，不存正文**。行里放 `messageId` / `approvalId` + kind + 一句短 subject，**不复制消息全文**——否则审计既膨胀又变成第二份真相。另外审计写失败**不能把这一轮弄挂**：`try/catch` 记日志就走，收发存根丢一张不该让邮件退回。
5. **只读接口** `GET /api/audit?threadId=&actor=&action=&since=&limit=`，默认按时间倒序。Redis 侧全局列表用 `LTRIM` 封顶，避免无限长。

**验收**：跑一条交棒链，一个接口就能按线程看出这一串——人开口 → 墨墨跑完（带 token）→ 交棒闪闪 → 抢到租约 → 闪闪跑完 → 建审批卡 → 自动批准落地。然后按 `AGENTS.md` 踩坑第 1 条的姿势杀进程重启，能看到 `steal` 和那一棒重跑各一行。

## 不做（本篇）

- **Quota Board / 按猫成本聚合**：数据已经在 `Message.usage` 里，缺的是读侧聚合 + 看板 UI（`shared` 里那个一直闲置的 `mergeTokenUsage` 就是给它准备的）。是很自然的下一篇，但和本篇搅在一起就成了两刀。
- **保留策略、归档、导出**：先封顶不删，够用；真要长期留再另开。
- **审计行进 UI 时间线**：本篇只出接口，前端怎么展示另说。顶栏和接力时间线已经有自己的数据源。
- **把 console 日志全量搬进审计**：只记「平台做了什么决定」，不记调试用的过程日志。

## 落地时定的几件事（稿子没写）

- **审批那一行的 `actor` 只能记 `platform`**。`approve()` 被 `#approve`（人批）和自动批准（平台批）共用，store 层分不出是谁，卡片上也没有能区分的字段。没有发明字段，也没有把 profile 上的 `autoApprove` 猜进这一行——那是角色策略，不是「这张卡这次是谁批的」。真要分清，得让调用方把 actor 传进来，那是下一刀的事。
- **审计写入是 `await` 的**，不是 fire-and-forget。多一次 Redis `RPUSH` 的延迟，换来审计行顺序确定——顺序正是这一刀的价值（「谁先谁后」比「有没有」更能说明问题），相对一次模型调用可以忽略。
- **补了一条钉住接线的测试**。原来的读接口测试是直接往 store 塞行、集成测试是手工包装装饰器，所以**把 `server.ts` 里的装饰器拆掉，全部测试照样绿**，生产静默不记账。现在有一条真发 POST、再从 `GET /api/audit` 查回来的用例；实测拆掉装饰器它会红。
- **同一条半截消息会留两行**：装饰器的 `hop-failed` 和显式的 `hop-rerun`。两行都留着——前者是「这条消息废了」，后者是「平台决定重跑」，是两件事。
- **`setReviewComment` 不记**：它是审查的中间步骤，结论本身会以消息落账。
- **全局列表封顶 5000 行**（`audit:all`，`LTRIM`）。按线程的 `audit:<threadId>` 不截，和「先封顶不删」一致。
- **同一毫秒的 `ts` 会让 `since` 把那几行都算进去**（ISO 字符串相等）。没给行加序号，测试里靠间隔 2ms 回避；真要严格排序再说。
- 顺带补齐了 redis 侧一直缺的 bundle 工厂 `createRedisStores`（memory 侧本来就有），`index.ts` 改走它——同一批类、同样参数，等价重构。

## 入口

- 类型 `AuditRow` / `AuditActor` / `AuditAction`（`action` 复用 `SystemKind`）：`packages/shared/src/types.ts`；短摘要截断 `packages/shared/src/audit-subject.ts`
- 端口 `AuditStore` + 过滤/封顶常量：`packages/api/src/stores/ports.ts`；实现 `stores/memory.ts`、`stores/redis.ts`
- **派生审计行的装饰器**：`packages/api/src/stores/audit-log.ts`（含 `safeAppendAudit`，审计失败只记日志）
- 接线（审计包在广播里面）：`packages/api/src/http/server.ts`
- 不经过 store 的五处：`router/pending-runner.ts`（`lease-claim` / `lease-steal` / `lease-release` / `hop-skip-stale`）、`router/execute-turn.ts`（`hop-rerun`）
- 只读接口 `GET /api/audit`：`packages/api/src/http/server.ts`
- 单测：`packages/api/test/audit-store.test.ts`、`audit-log.test.ts`、`audit-http.test.ts`（含接线那条钉子）、`audit-trail.test.ts`（动作顺序）
