# PR 上的评论流回线程

一篇只写**一个**可验收的特性。写完就做这一刀,做完再开下一篇。不要在这里预写路线图。

开篇先想:同一问题他们公开怎么设计,这一刀能靠多近。能靠就靠;本刀没更近,写清差在哪、为什么先薄。不读、不抄源码。

- 状态:`已落地`
- 对照 clowder:他们的 F140 追踪层轮询已注册 PR 的 review 评论,指纹去重,投递成功才推进 cursor,人写的才叫醒猫、bot 只记状态
- 靠拢:去重指纹、cursor 推进时机、「人写的才叫醒」三条直接搬;他们的统一调度框架和 intent 注册模型我们没有,评论检测挂在现有的「每跳后查 PR」里,不另起轮询——本刀没更近的原因:我们的线程模型里猫每跳后本来就会看一次 PR,多一个常驻轮询器是第二个心脏

## 门(各一句)

- **功能**:绑仓开远程的线程里,PR 上有人写 review 评论,评论自己出现在线程时间线,写手猫被叫醒收到「去处理这条评论」的任务
- **价值**:人不用盯着 GitHub 再回来转述;球不用停在人手里当传话筒
- **愿景**:对得上「你不用当路由器」——评论自己找到该干活的猫,平台是邮差
- **落点**:`services/pr.ts` 加评论拉取;`segment.ts` 的 `recordPrState` 每跳顺带比对指纹;叫醒走现有 `pendingHop` + pending-runner;新增系统消息带 `systemKind`

## 为什么

现在猫开了 PR 之后,PR 上发生什么平台是瞎的:人写了「这里改一下」,猫不知道,线程里看不见,只能等人复制粘贴回来。对齐 F140 的追踪层语义(不做他们的调度框架),本篇做成自己的「评论回流」这一片;CI 状态和冲突检测是另外两篇,不在此搅。

他们踩过的坑直接吸收:去重按「评论 id 集合」的迁移指纹,不用时间窗口(时间窗会吞掉合法的状态迁移);已见指纹只在投递成功后才落库(投丢了下轮还能再投,不丢评论);只有人(GitHub `user.type=User`)写的评论才叫醒猫,bot 写的只落时间线(防止 bot  flood 叫醒链);merged/closed 之后不再查(现有 `pr-merged` 停接力时一并停)。

## 怎么做

1. `services/pr.ts` 加 `listPrReviews({ workdir, number })`:走 `gh api` 拉 PR 的 comments + reviews,每条带 id / 作者 / 作者 type(User 还是 Bot)/ 正文 / 时间;失败归类复用现有 `classifyPrLookupError`,查不到不炸,落 notice
2. 线程的 repo 元信息里记 `seenPrCommentIds`(指纹集合);`recordPrState` 在现有 PR 状态查询通过后顺带拉一次评论,比对指纹
3. 新出现的评论:落一条系统消息到时间线(新 `systemKind`,内容带作者和前几句正文),指纹在该线程消息 append 成功后才更新
4. 作者 type 是 User 的评论:以写手猫为目标起一跳(任务正文 = 评论内容 + PR 链接),走现有 pending-runner;Bot 的评论只落消息不起跳
5. 本地模式(`allowRemote` 缺失)一次 `gh` 都不跑,沿用现有开关;`pr-merged` 停接力后不再查评论

验收:记分板加一行「PR 上来了人写的 review」——fake gh 注入一条 User 评论,断言时间线出现评论消息 + 写手猫被叫醒;再加一条 Bot 评论,断言只落消息不叫醒;本地模式断言零次 gh 调用。e2e 走通「评论 → 时间线 → 猫跳起来回话」。

## 不做(本篇)

- **CI 状态追踪**:已另篇 [pr-ci-tracking.md](pr-ci-tracking.md)
- **冲突检测和自动 rebase**:他们做到 Phase C 才自动解简单冲突,我们第一版连检测都不做
- **人也能在 GitHub 上 @ 猫**:评论内容解析 mention 是另一回事,本篇评论一律回流给写手猫
- **已知边界**:评论恰好卡在接力链中段到达时,本轮只落消息不叫醒(指纹已推进,不补叫);叫醒只对链已停的线程保证。纯持球(没挂等跑命令)期间到达的评论同样只落消息不叫醒——持球是「人开口即取消」,平台不能用叫醒替人取消

## 入口

- `packages/api/src/services/pr.ts` —— `listPrReviews`(`gh api` 拉 issues/comments + pulls/reviews,带作者 type)
- `packages/api/src/router/turn/segment.ts` —— `syncPrReviews`(指纹比对、落 `pr-review` 消息、逐条推进指纹)/ `recordPrState` 的 `onOpenPr` 挂钩
- `packages/api/src/router/turn/settle.ts` —— 链已停且来了人写的评论时给写手猫起一跳(四条护栏),叫醒过本轮不建卡
- `packages/web/lib/ball.ts` —— 球权跳过 `pr-review`(不参与球权)
