# 每一跳留一份原始记录

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F013 追责层之外还有 CLI 原始事件取证——按调用分片、短保留,不进审计流水。
- 靠拢:拿「每一跳一份 JSONL,人能按 hopId 把原始行调出来」。差在长期压缩和进 UI:本篇只归档 + 只读接口。

## 门（各一句）

- **功能**：猫跑完一跳,stdout 的每一行落到 `audit/hops/<threadId>/<hopId>.jsonl`。`GET /api/hops/:hopId` 能读回来。
- **价值**：适配器解析错了还能对原始行;面试能把追责流水和取证文件分开讲。
- **愿景**：仍是邮差。存根是「谁交给谁」;这包是信封里那张底稿,不评判内容。
- **落点**：`onRawLine` 钩;三家适配器每读一行调用;文件归档;只读接口。审计 store 不进正文。

## 为什么

追责流水只记指针。对照他们:取证是另一层。喵窝差的是原始行。不做成 X:解析器一改,旧跳没法对证。

写失败不能把这一跳弄挂。没有 hopId 不写文件。

## 怎么做

1. `AgentTurnInput.onRawLine?(line)`。claude / gemini / opencode 每读完一行 stdout 就调。
2. `appendHopTranscript(dir, threadId, hopId, line)` 追加 JSONL,一行一个 `{ ts, line }`。
3. `runAgentTurn` 有 hopId 且配了 `hopTranscriptDir` 才挂钩。
4. `GET /api/hops/:hopId?threadId=` 读文件,找不到 404。
5. 验收:假 CLI 吐两行 JSON → 文件两行,接口能读回原行。审计 `GET /api/audit` 仍不含原始行。

## 不做（本篇）

- 进时间线 UI、按日压缩、进 Redis
- 把 stderr 全量归档
- 改变追责流水字段

## 入口

- 归档:`packages/api/src/services/hop-transcript.ts`
- 挂钩:`AgentTurnInput.onRawLine`;三家适配器每行调用
- 跳:`runAgentTurn` 有 hopId 才写
- 接口:`GET /api/hops/:hopId?threadId=`
