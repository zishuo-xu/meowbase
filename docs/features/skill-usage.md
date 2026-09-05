# 技能和工具用过几次

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F150 工具使用度量——哪些工具/技能被用过、哪只猫在用。
- 靠拢:拿「按名计数 + Hub 能看见」。差在实时 Redis 计数器、每日趋势、JSONL 冷归档:本篇和账本同一口径,打开时扫已完成助手消息再聚合。

## 门（各一句）

- **功能**：Hub 能看见每个技能被注入几次、每个工具被调几次,可按当前线程或全部。
- **价值**：面试和自用能回答「技能是不是白写的」,不用翻时间线猜。
- **愿景**：仍是邮差。邮局记袋子里塞过哪些说明书、猫动过哪些工具;不判断用得好不好。
- **落点**：跳完成时记下 `skillIds`;工具仍读已有 `activities`。纯函数聚合 + `GET /api/usage/tools` + Hub 一页。

## 为什么

技能现在会按触发词注入,工具过程也落在消息上,但没有任何合计。对照他们:分类 + 计数 + 看板是一块。喵窝差的是读侧。不另开计数器——消息才是真相,和账本同一条路。gemini 不报工具就显示没调过,不估。

## 怎么做

1. 助手消息加可选 `skillIds`:这一跳实际塞进 system prompt 的技能 id。常驻技能也记,看板上标「常驻」。
2. `classifyTool(name)`:`mcp__` / `mcp:` 归 mcp;`Skill` / `skill:` / `skill__` 归 skill;其余 builtin。`思考` 不算工具。
3. `sumToolUsage`:只算 `assistant` + `completed`。技能按 id 累加,工具按显示名累加。
4. `GET /api/usage/tools?threadId=`(不给就是全部)。Hub 加「技能」页:总注入 / 总调用、技能表、工具表。当前线程 / 全部切换跟账本同一套。
5. 验收:带 `review` 触发词跑一跳 → 该跳 `skillIds` 含 `review`,接口里这技能 count=1;假工具 Write 一次 → 工具表 Write builtin=1。没记录时空态,不写 0 充门面。

## 不做（本篇）

- Redis INCR / 按日趋势 / JSONL 归档
- 判断技能「有没有用上」(只计量注入,不读猫有没有按说明书做事)
- 按分类筛、折线图

## 入口

- 分类/聚合:`packages/shared/src/tool-usage.ts` `classifyTool` / `sumToolUsage`
- 跳上记下技能:`packages/api/src/router/turn/agent-hop.ts`
- 读侧:`packages/api/src/services/usage.ts` `loadToolUsage`、`GET /api/usage/tools`
- Hub:`packages/web/components/TeamHub.tsx` 技能页
