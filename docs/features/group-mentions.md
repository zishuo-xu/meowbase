# 群组 mention 展开

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F078 —— 行首 `@all` / `@thread` / 品种展开成多只,无 @ 回退梯级已经有了。
- 靠拢:拿「人打行首群组名,平台展开成名册里的猫,顺序执行」。差在品种图鉴和动态线程成员:@thread 本篇等于 @all,因为线程名册就是全队。

## 门（各一句）

- **功能**：行首 `@all` / `@thread` / `@全员` / `@大家` 展开成名册全部猫;行首 `@架构` / `@审查` / `@执行` 按角色展开。句中不算。猫写的群组名不交接。
- **价值**：面试能讲「群发是地址展开,不是猜你想叫谁」;人不必把三只名字各占一行。
- **愿景**：仍是邮差。群组是通讯录里的分组,展开后还是同一套顺序执行。
- **落点**：`expandMentionToken` + `extractMentionTargets`;补全菜单加「全员」。

## 为什么

回退梯级已经只信人点过的名。对照他们:还差分组地址。喵窝三只猫角色固定,品种按角色展开就够演示。不做成 X:句中写「不要 @all」也群发。

展开后走现有多 @ 顺序执行,不新开并行。猫 `@all` 不认——交接必须点名一只。

## 怎么做

1. 行首 token 先看分组:全员组 → 名册顺序全部;角色组 → `role` 含「架构/审查/执行」。再才 `resolveAlias`。
2. `stripMentions` 同样剥掉分组 token。
3. 补全:`@` 菜单多一行「全员」,插入 `@全员`。
4. 验收:`@全员 开工` 三只都跑;「不要 @all」只走回退;猫回复行首 `@all` 不交棒。

## 不做（本篇）

- 并行 multi-mention 状态机
- 按 CLI 品种再拆一组
- 让猫经 A2A 把棒交给 @all

## 入口

- 展开:`packages/shared/src/catalog.ts` `expandMentionToken`
- 人路由:`packages/shared/src/mention-targets.ts` `extractMentionTargets`
- 剥名:`stripMentions` 同样剥分组 token
- 补全:`packages/web/components/ChatInput.tsx` 「全员」
- 猫交接:`parseA2AHandoff` 不认群组名
