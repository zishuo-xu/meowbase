# 按风险面选审查官（risk-routed reviewer）

一篇只写**一个**可验收的特性。写完就做这一刀，做完再开下一篇。不要在这里预写路线图。

- 状态:`已落地`
- 对照 clowder:SOP「Review 去叠加」——默认选一个独立验证源且必须非作者;按风险面选视角(家里语境归 local peer、context-blind 高风险归 cloud、最终产品结果归愿景守护),叠加必须写明不同风险面;铁律是不自审。
- 靠拢:名册加 `reviewRisk` 风险面标签 + `selectReviewer` 按本轮 diff 的风险面挑审查官;本刀**不做**多源叠加(他们也只是"确实需要才叠加"),不做愿景守护那一层(我们的愿景守护就是人)。

## 门（各一句）

- **功能**：名册里每只猫可以声明「我审哪类改动」(风险面标签),平台建审批卡拉审查时按本轮 diff 命中的风险面选审查官,不再永远默认 `handoffTo`。
- **价值**：审安全/契约类改动时球停在「懂那摊的猫」手里而不是「默认那只」手里;人少看到「审查官明显没看懂在审什么」的卡。
- **愿景**：仍是邮差——风险面分类是平台写的纯函数,不让模型自己挑审查官(那会变成自我指派)。对得上。
- **落点**：`shared/pairing.ts` 的 `selectReviewer` 签名加风险面入参 + `shared/catalog.ts` 的 `TeamMember` 加可选字段 + 一个新纯函数 `classifyDiffRisk(diff)`,`review.ts` 调用处传入。不新开第二心脏。

## 为什么

现在 `selectReviewer` 就两条:写手的 `handoffTo` 优先,否则第一个不是写手的。等于**所有改动永远默认交同一只审**。这在三只猫、改动都是沙箱小文件时够用;但平台已经有了真实风险面——命令白名单、出仓开关、PR 合并、协议表改动——这些改动被一只「默认审查官」用同一副眼镜看,和 clowder SOP 说的「强制力跟风险走」正好相反。

clowder 把这条做成五轴(行为面/数据/安全/契约/不可逆)是因为它有 496 commits 的体量;我们第一刀只收**三档**,因为它对应喵窝真实存在的三类改动:

| 风险面 | 命中信号(diff 路径/内容) | 名册声明 |
|---|---|---|
| `contract` | 动 `AGENTS.md` 协议表 / `packages/shared/src`(协议解析纯函数) / 系统消息 kind | 谁审协议 |
| `safety` | 动 `command-allowlist` / `repo-root-allowlist` / 审批流 / 出仓开关 | 谁审安全 |
| `default` | 其余一切 | `handoffTo`(现状) |

本篇做成自己的那一片:喵窝的风险分类器是**路径匹配**(纯函数、可单测),不像他们接 convention graph——我们还没有那个基础设施,路径匹配先挡住 80% 的错配。

## 怎么做

1. `TeamMember` 加可选 `reviewRisk?: readonly ('contract'|'safety')[]`——声明「我审哪些风险面」;默认名册:闪闪 `['contract','safety']`(现状不变),其余不写。向后兼容:字段缺失 = 只审 `default`。
2. 新纯函数 `classifyDiffRisk(diffFiles: string[]): 'contract'|'safety'|'default'`——路径前缀表驱动,表写在 shared 里可测。命中多档时 `safety > contract`。
3. `selectReviewer(writer, available, team, risk)`:先找「声明了该风险面且非写手且可用」的猫;没有则退回现状逻辑(`handoffTo` → 第一个非写手)。**铁律不变:任何情况不许自审。**
4. `review.ts` 建卡拉审查处:`classifyDiffRisk(latestDiff.files)` 算出 risk 传入;审查系统消息 `🤝 审查:墨墨 → 闪闪` 尾巴带上风险面(`·安全面`),审计 `systemMeta` 加 `risk` 字段。
5. 验收:绑仓线程里让 fake CLI 改一个白名单文件 → 审批卡上的审查官是声明了 `safety` 的那只,不是 `handoffTo` 默认那只;改普通文件 → 仍是 `handoffTo`。记分板加一行「安全面改动落到了对的审查官」,期望 1。

## 不做（本篇）

- **不做五轴全集**:数据/不可逆两轴喵窝还没有对应改动类型,提前分类是给空集合写规则。
- **不做多 reviewer 叠加**:他们也只是「确实需要才叠加」,我们先保证单 reviewer 选对。
- **不让猫自己声明风险面**:diff 分类是平台纯函数;猫正文里写「这很危险」不参与选官——自我指派的审查不是审查。

## 入口

- `packages/shared/src/pairing.ts` — `classifyDiffRisk`(路径表驱动,SAFETY_PATHS/CONTRACT_PATHS/CONTRACT_PREFIXES) + `selectReviewer(writer, available, team, risk)`(第 4 参,缺省 default)
- `packages/shared/src/catalog.ts` — `TeamMember.reviewRisk`;默认名册闪闪声明 `['safety','contract']`
- `packages/shared/src/types.ts` — `SystemMeta.risk`
- `packages/api/src/config.ts` — `AgentSpec.reviewRisk`;`PATCH /api/config/agents/:id` 支持 `handoffTo` / `reviewRisk`
- `packages/api/src/router/turn/review.ts` — 建卡拉审查处 `classifyDiffRisk(initialDiff.files)`,审查 notice 尾巴带 `·安全面`/`·契约面`
- `packages/api/src/services/git.ts` — `gitDiffHead` 返回多带 `files`
- 记分板第 16 行「安全面改动落到默认审查官」(`scripts/eval.ts` runSafetyReview + `scripts/fixtures/fake-safety-writer.mjs`)
