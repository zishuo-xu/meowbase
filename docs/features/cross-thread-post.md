# 跨线程传话带出处

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F052 —— 跨线程传话要溯源;同名猫在另一条线程说的话,不能被当成这条线程里的自己。
- 靠拢:拿「人可以把一句话寄到另一条线程,落成带出处的系统消息,不参与球权」。差在猫自己 cross_post:本篇只给人用的 HTTP,避免自引用坑。

## 门（各一句）

- **功能**：`POST /api/threads/:from/cross-post` 把正文寄到目标线程,落 `cross-post` 系统消息,写明来自哪条线程。目标线程球权不变。
- **价值**：面试能讲「同名不是同一个说话人」;两条线程能借一句,不会把墨墨 A 的话当成墨墨 B 自己说的。
- **愿景**：仍是邮差。跨线程是转发信封,贴上原寄件地址,不拆开重写成助手气泡。
- **落点**：`formatCrossPostNote`;`systemKind: cross-post`;球权跳过;HTTP 只读目标线程存在才寄。

## 为什么

搜消息已经能跨线程翻,但不能把一句送到对方时间线。对照他们:身份坑是「同名猫自引用」。喵窝做法:不落 assistant,只落系统句,fromThread 写在 meta。不做成 X:两条线程的墨墨串台。

不叫猫。不进 inbound 队。忙着也寄,人回头能看见。

## 怎么做

1. `SystemKind` 加 `cross-post`。`formatCrossPostNote({ fromTitle, fromId, body })`。
2. `POST /api/threads/:threadId/cross-post` body `{ toThreadId, content }`。同源或目标不存在 400/404。成功在目标线程 append 系统消息,meta `{ fromThreadId }`。
3. `ball.ts` 跳过 `cross-post`。
4. 验收:线程 A 寄一句到 B → B 时间线有「来自 A」;B 顶栏球权仍按原来的最后一条;A 自己的助手列表不增加。

## 不做（本篇）

- 猫经 MCP 自己 cross_post
- 自动叫醒目标线程的猫
- 把跨线程通讯变成审批

## 入口

- 文案:`packages/shared/src/a2a.ts` `formatCrossPostNote`
- 类型:`SystemKind` 的 `cross-post`、`SystemMeta.fromThreadId`
- HTTP:`POST /api/threads/:threadId/cross-post`
- 球权:`packages/web/lib/ball.ts` 跳过 `cross-post`
- Hub 能力页:协作工具第三行
