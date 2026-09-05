# 账本：按猫看 token 和花费

- 状态:`已落地`
- 对照 clowder:公开能力表里有一条 **Quota Board — Real-time token usage and cost tracking per agent**，旁边那条 Capability 还写了 *context budget*。语义是:每只猫花了多少、还剩多少预算，人一眼能看见。
- 靠拢:拿「按猫看用量和花费」这一条。差在「real-time」:本篇只做**打开就算、`sync` 时刷新**的读侧聚合，不做实时推送。配额上限／熔断见 [budget-gate.md](budget-gate.md)。

## 门（各一句）

- **功能**：Hub 里每只猫一行——输入／输出／缓存 token 和真实花费，可以只看当前线程，也可以看全部。
- **价值**：演示和自用时能回答「这条链花了多少钱、贵在哪一跳」，而不是月底看账单猜。
- **愿景**：仍是邮差。邮局记包裹的重量和邮资，不替猫决定该不该寄。
- **落点**：`shared` 里那个一直闲置的 `mergeTokenUsage`、一个只读 `GET /api/usage`、`components/TeamHub.tsx` 加一块。没有新的写入路径。

## 为什么

**数据早就在库里，只是没人看。** 适配器已经在解析用量：`providers/stream-json.ts` 读 claude 的 `total_cost_usd`，`providers/opencode-json.ts` 读 opencode 的 `cost`，缓存读／缓存写 token 也都在；`execute-turn` 每轮把它们落到 `Message.usage`。`TokenUsage` 类型里 `costUsd` / `costEstimated` 两个字段从第一版就留着，`shared/src/token-usage.ts` 的 `mergeTokenUsage` 连单测都写好了——**整套东西一直没有任何调用方**。

所以这一刀不是新建能力，是把当初预留的接口接上：一个聚合 + 一块看板。这也是对照 clowder 时最省力就能靠近的一条公开能力。

顺带补上审计那一刀留下的半句话：审计行的 `meta.usage` 让人能看出「哪一跳花了多少」，但没有「这只猫总共花了多少」。

## 怎么做

1. **聚合读侧算，不新增写入**。`GET /api/usage?threadId=`（不给 threadId 就是全部线程）返回 `{ byAgent: Record<AgentId, TokenUsage>, total: TokenUsage }`，用现成的 `mergeTokenUsage` 累加。**只统计 `role: 'assistant'` 且 `status: 'completed'` 的消息**——半截的、失败的不算钱。
2. **真相取自消息，不取自审计**。审计行虽然也带 `meta.usage`，但审计是 best-effort（写失败被 `try/catch` 吞掉），不能当账本的源。消息才是源。
3. **只展示报上来的花费，不估算**。claude / opencode 会报真实 `costUsd`，gemini 不报——那一格就显示「无成本数据」，**不按价格表倒推**。价格会变、缓存折扣算不清，估出来的数字比没有数字更能骗人。（`costEstimated` 字段照旧透传，UI 上标一下就行。）
4. **Hub 里一只猫一行**：输入 / 输出 / 缓存读 / 总计 + 花费。顶上一个切换：`当前线程` / `全部`。数据在 Hub 打开时拉一次，`sync` 事件来了按现有防抖刷新（[live-sync.md](live-sync.md) 那套现成的）。
5. **验收**：跑一条交棒链，Hub 里两只猫各有一行非零 token；切到「当前线程」只看到这条线程的量；gemini 那格显示无成本而不是 `$0`。

## 不做（本篇）

- **配额上限 / 预算熔断 / context budget**：已另篇 [budget-gate.md](budget-gate.md)。
- **按价格表估算成本**：见上，宁可空着。真要做，价格得进配置并标明生效日期。
- **实时推送用量**：他们是 real-time board，我们先靠 `sync` 刷新。差距写在这里，不假装做到了。
- **增量计数器**：现在是每次读的时候扫消息算一遍。线程多了会慢，但这个规模够用；真要快再加 Redis 计数器，那时才需要考虑「计数器和消息谁是真相」。

## 落地时定的几件事（稿子没写）

- **「无成本数据」和「—」是两回事**。前者是「这只猫跑过，但那家 CLI 不报邮资」（典型是 gemini），后者是「这只猫本轮没出场」。都不写 `0`——零会被当成免费。
- **账本做成 Hub 侧栏的独立一页**，打开 Hub 默认仍是模型目录，要点一次「账本」。塞进能力／模型那页会挤。
- **接口返回了 `total`，但 UI 只画了「一只猫一行」**。合计行等真要看总账时再加，先不占版面。
- **没选线程时的「当前线程」直接给空态**，不偷偷退化成「全部」——否则人以为在看这条线程的账。
- **跨线程是两层循环**（`threads.list()` + 每条线程一次 `messages.list()`），有测试盯着「一次 `get` 都不许调」，防的是以后有人改成按消息逐条取。
- 复核时我把 `sumUsage` 收了两处：`isBillable` 改成类型谓词（原先检查完还要在循环里重查一遍才能过窄化）、去掉多余的 `hasTotal` 开关（`mergeTokenUsage({}, x)` 和 `mergeTokenUsage(undefined, x)` 等价）。
- **账本只算猫的。** 模型探测的花费当场显示在探测结果里,不进 `GET /api/usage`、不改 `loadUsage`。为什么不撑大口径见 [platform-spend.md](platform-spend.md)。

## 总计是派生的（真实数据暴露的口径）

`totalTokens` 只有部分 CLI 会报。claude 那条经常不报，gemini / opencode 会报，而且上游的总数还可以含我们没逐项列出的部分。

真实交棒链跑完后，墨墨（claude）是输入 21,171 + 输出 1,936 + 缓存读 107,008、没有 `totalTokens`，Hub「总计」却画成「—」；闪闪（gemini）报了 13,465。聚合层还把「只有部分猫才有的字段」盲加进 `total.totalTokens`，于是合计 13,465 **小于** 合计输入 21,350——同一张账自相矛盾。

规则只有一条，`shared` 的 `totalTokensOf` 和 web `lib/token-usage.ts` 镜像同一份：

- 这只猫报了 `totalTokens` → 用上游的（更权威，含没逐项列的部分）
- 没报 → 派生 `input + output + cacheRead + cacheCreation`（缺的当 0）
- 全空 → 0

`byAgent` 保持各家原始字段，不回填派生值。`total.totalTokens` 是「每只猫先 `totalTokensOf` 再相加」，不是 `mergeTokenUsage` 盲加出来的那个。Hub「总计」格走同一条规则；没出场的猫仍是「—」，不写成 0。

## 入口

- 派生总计 `totalTokensOf`：`packages/shared/src/token-usage.ts`；web 镜像 `packages/web/lib/token-usage.ts`（不依赖 `@meowbase/shared`）
- 聚合纯函数 `sumUsage` + 跨线程 `loadUsage`：`packages/api/src/services/usage.ts`（`total.totalTokens` 是每只猫 `totalTokensOf` 后再加，不沿用 `mergeTokenUsage` 盲加）
- 只读接口 `GET /api/usage?threadId=`：`packages/api/src/http/server.ts`
- 前端取数：`packages/web/lib/api.ts` 的 `fetchUsage`；`sync` 去抖后递增 `usageRefreshKey` 在 `packages/web/app/page.tsx`
- 看板：`packages/web/components/TeamHub.tsx`（`CostCell` 管三种展示）
- 单测：`packages/api/test/usage.test.ts`（过滤规则一条一条钉）、`usage-http.test.ts`、`packages/web/components/__tests__/TeamHub.test.tsx`
