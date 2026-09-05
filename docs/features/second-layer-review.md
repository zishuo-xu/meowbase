# 出仓第二层审查

一篇只写**一个**可验收的特性。写完就做这一篇,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一篇能靠多近。能靠就靠;本篇没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:F031 两层审查 —— 同机互审是第一层,出仓(PR / 云端猫)是第二层;本地通过不能直接当合并。
- 靠拢:拿「开了远程就不自动落地」。差在不叫 Codex、不往 PR 评论里 @ 人:本篇只把闸装在自动批准上,第二层的投递面仍是已有的 PR 回流和人 `#approve`。

## 门（各一句）

- **功能**：绑仓且允许推送/开 PR 的线程,本地审查官通过也不自动落地,卡上写明在等第二层。
- **价值**：面试能讲「两层审查:同机一层、仓外一层」;人不会看见 autoApprove 把还没出仓的改动直接提交。
- **愿景**：仍是邮差。平台不替云端猫写意见,只决定准不准跳过仓外那一层。
- **落点**：`needsSecondLayerReview`;`runReviewFixThenCard` 里挡住 autoApprove。不新开心脏,不调外部模型。

## 为什么

本地互审已经是内建管线。对照他们:出了仓还有第二层。喵窝开了远程之后,写手 `autoApprove` 仍会把卡直接落地——仓外那一层形同虚设。不做成 X:记分板绿、真机 push 了却没人在 PR 上说过话。

空沙箱和本地绑仓(没开远程)没有仓外投递面,第一层通过仍可自动落地,和今天一样。

## 怎么做

1. `needsSecondLayerReview(allowRemote)`:只有 `allowRemote === true` 才要第二层。
2. 建卡后若要第二层,`allowsAutoApprove` 即使为真也不 `approve()` / 不落地。
3. 待批文案写清:本地已审过,开了远程等仓外第二层或人 `#approve`。人批、PR 合了作废,仍走现有命令和 `pr-merged`。
4. 验收:空沙箱 autoApprove 仍自动落地;开了远程的绑仓线程同一套审查通过不落地,卡仍 reviewing,正文含「第二层」。

## 不做（本篇）

- 真调 Codex / 往 PR 评论写 `@review`
- 改 PR 回流、验证闸、审查官选择
- 自动根据 GitHub review state 改卡

## 入口

- 纯函数:`packages/shared/src/review-verdict.ts` `needsSecondLayerReview`
- 闸:`packages/api/src/router/turn/review.ts` 挡住 autoApprove
- 协议:[AGENTS.md](../../AGENTS.md) 平台自己做的表
