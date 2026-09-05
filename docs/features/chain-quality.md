# 跨轮乒乓熔断与收尾槽

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F167 —— 同一对猫空转要熔断;链尾那一跳必须有出口,不能把球悬着。
- 靠拢:拿「跨轮同一对来回第三次拦」和「链深最后一跳不许再交棒」。差在复杂评分账本:本篇只记 pair 计数和 hop 位置。

## 门（各一句）

- **功能**：同一对猫 A→B 再 B→A 空转第三次,平台不传,球回人手里。链深最后一跳再交棒也不传,必须收尾。
- **价值**：人不用等两只猫隔着轮空转烧钱;面试能讲「链尾是收尾槽,不是再传一次」。
- **愿景**：仍是邮差。数来回次数和是不是最后一跳,不判断聊得好不好。
- **落点**：`Thread.relayPairs`;`isPingPongTrip`;链尾 `final-slot`。

## 为什么

链内 `visited` 已经拦住同一轮交回已出场的猫。对照他们:跨轮还能乒乓。人发「继续」开新一轮,visited 清空,墨墨和闪闪可以再空转。链尾现在只落 notice「已达上限」仍可能把球悬着。不做成 X:记分板绿、真机两只猫隔夜对打。

空转定义跟虚空传球同一把尺:没新文件且没结论。有 diff 或有结论的来回不算乒乓,那是干活。

## 怎么做

1. `Thread.relayPairs?: Record<string, number>`,键 `from>to`。
2. 即将交棒且 `isVoidHandoff` 为假时仍记 pair;为真走现有 void。空转且该 pair ≥2(即将第三次)拦,`stop=pingpong`。
3. `hop + 1 >= maxDepth` 时不再只 notice,`stop=final-slot`,不写 pending。
4. `formatDroppedBallNote` 两句专门的话。`systemKind: dropped`。
5. 验收:两次空转交棒后第三次拦;maxDepth=1 时第一跳交棒走 final-slot,不写 pending。有文件的来回不拦。

## 不做（本篇）

- 按内容打分的乒乓账本
- 角色护栏
- 改链深默认值

## 入口

- 纯函数:`packages/shared/src/a2a.ts`(`isPingPongTrip` / `relayPairKey` / `formatDroppedBallNote`)
- 交棒闸:`packages/api/src/router/turn/segment.ts`
- 账本:`Thread.relayPairs` + `ThreadStore.setRelayPairs`(memory / redis / broadcast)
- 协议:[AGENTS.md](../../AGENTS.md) 平台自己做的表
- 单测:`packages/shared/test/a2a.test.ts`、`packages/api/test/execute-turn.test.ts`
