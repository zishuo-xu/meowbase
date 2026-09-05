# 协作工具:搜消息、列线程

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F043 第一片 —— `search_messages` + `list_threads`,协作只读,不依赖完整 MCP 编排。
- 靠拢:拿「按关键词/猫搜消息、列出线程」。差在独立 MCP 进程和跨项目配置同步:本篇先开 HTTP 工具面,提示词告诉猫有这两把。

## 门（各一句）

- **功能**：`GET /api/collab/messages` 按关键词搜正文;`GET /api/collab/threads` 列出线程标题和阶段。Hub 能力页能看见这两把。
- **价值**：面试能指着接口说「猫不必把整条时间线默背」;人也能 curl 查。
- **愿景**：仍是邮差。工具只翻信封目录,不改路由、不替猫写信。
- **落点**：shared 纯函数 + HTTP + 提示词一段 + Hub 能力页两行。

## 为什么

猫现在全靠平台把上下文拼进 prompt。对照他们:协作第一片是搜和列。喵窝差的是结构化入口。不做成 X:简历写 MCP、演示时只有聊天框。

只读。不在这一篇让猫经 MCP 调工具——三家 CLI 的 MCP 配置是另一篇。

## 怎么做

1. `searchMessages(messages, { query, agentId?, limit })`:大小写不敏感子串,命中返回 clip 后的正文,默认最多 20 条。空查询返回空,不扫全库充门面。
2. `listThreadIndex(threads)`:id / title / primaryAgentId / sop.stage。
3. `GET /api/collab/messages?q=&agentId=&threadId=`。不给 threadId 就扫全部线程。`GET /api/collab/threads`。
4. 提示词加两行:需要查历史用这两把,不要默背时间线。
5. Hub 能力页加「协作工具」两行只读。
6. 验收:两条线程各有一句「斑马纹」,`q=斑马` 只命中那两句;空 q 返回 `[]`。

## 不做（本篇）

- 独立 MCP stdio 服务器、跨项目配置同步
- 跨线程发信、任务板
- 让三家 CLI 真的挂上 MCP

## 入口

- 纯函数:`packages/shared/src/collab-tools.ts`
- 读侧:`packages/api/src/services/collab.ts`
- HTTP:`GET /api/collab/messages`、`GET /api/collab/threads`
- 提示词:`buildA2AProtocol` 协作工具两行
- Hub 能力页:协作工具两行
