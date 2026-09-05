# 排队里提到前面

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F039 / F175 —— 队里的条目可以 steer 拉到前面;urgent 也还在队里,不另开旁路打断正在跑的那一跳。
- 靠拢:拿「人能把某一句或某一棒挪到队头,当前棒不被 abort」。不搬拖拽改序、urgent 标签、跨来源统一出队。

## 门（各一句）

- **功能**：顶栏排队面板每条后面有「提到前面」。点了之后下一棒 / 下一句人话先出它,正在跑的那一跳不停。
- **价值**：人插了两句、只想先处理后一句时,不必拉闸重发。
- **愿景**：仍是邮差。人可以改信封顺序,不能撕掉正在送的那封。
- **落点**：存储把指定 id 挪到队头;`POST /api/threads/:id/queue/steer`;面板一行一个按钮。

## 为什么

交棒队和人话队都是 FIFO,面板只能看。对照他们:steer 是排序,不是旁路。喵窝差的就是「队内改序」。不做成 X:面试问「排错了怎么办」只能答拉闸。

## 怎么做

1. 存储加 `steerInbound(threadId, id)` / `steerPendingHop(threadId, hopId)`:找到就挪到该队队头,找不到 false。不碰 `pendingHop` 槽(那是下一跳或正在跑的)。
2. `POST /api/threads/:threadId/queue/steer` body `{ kind: 'inbound' | 'hop', id }`。成功回 200 和两队现状;找不到 404。不调猫、不 abort。
3. 面板:队头那条不显示按钮;其余每条「提到前面」。点了打接口。
4. 验收:人话队先 A 后 B,steer B → `shiftInbound` 先出 B;交棒队同理。正在跑的那一跳不被 abort。

## 不做（本篇）

- 拖拽改任意位置、urgent 自动置顶(见 [queue-reorder.md](queue-reorder.md))
- 把队里的条目立刻跑起来(那会 abort 当前棒)
- 两队合成一条、跨线程

## 入口

- 存储:`steerInbound` / `steerPendingHop`
- 接口:`POST /api/threads/:threadId/queue/steer`
- 面板:`packages/web/components/QueuePanel.tsx`「提到前面」
