# 合了之后那张卡要作废

一篇只写**一个**可验收的特性。做完再开下一篇。

- 状态:`已落地`
- 对照 clowder:这个动作在他们公开材料里查不到对应规格（没有「审批卡因外部事件失效」这一刀，F246 审批中心清单里也没有 merge 相关项）。能靠的是两条原则句，而且这两条正好说的就是这件事：**LL-027**「Feature 相关 PR 合入后 48h 内必须同步 spec 的 Timeline/Status——spec 停在 in-progress、代码已经合了，盘点会骗自己」；**LL-029**「不要只读 `.md` 就下结论——`.md` 是索引，git 才是真相」。
- 靠拢:靠那两条的语义，不靠规格。**卡是索引，git 是真相**——真相已经变了（改动进了 base），索引还停在「等人批」，那就是 LL-027 说的「盘点会骗自己」。做成喵窝自己的薄片：他们那两条讲的是人手同步 spec 状态，这一刀让平台自己同步卡的状态。

## 门（各一句）

- **功能**：`pr-merged` 停接力时，把这条线程上还开着的审批卡改成终态「已失效」并写清原因；失效的卡不能再批
- **价值**：卡不再邀请一个已经没有意义的动作。人点下去才失败，等于让人替平台发现问题
- **愿景**：仍是人拍板。这一刀不替人做任何决定，只是把一个已经不成立的决定点收掉
- **落点**：`ApprovalStatus` 加一个终态 + `settleTurn` 里 `pr-merged` 那条已有分支上顺手调一次 + `#approve` 拒掉失效卡。不新开心脏、不加系统消息种类（用 `notice`）

## 为什么

真机验收（`docs/PROGRESS.md` 2026-08-24 那条）跑出来的：人手 `gh pr merge --squash` 之后再一跳，平台正确地落了 `pr-merged`、清了 `pendingHop`、没有新建卡——**但上一跳建的那张 `ap_b0d4fc1c` 还停在 `reviewing`**，而它要人批的 `sum.ts` 已经在 `main` 里了。

**现状不会说谎，但会让人替平台发现问题。** 真去批的话，`tryLandApproval` 的提交会 nothing to commit 失败，`landApprovedCard` 不调 `markApplied`，落 `approval-failed`（这是 [git-state-tracking.md](git-state-tracking.md) 那一刀修好的）。所以结局是诚实的。问题在**时机**：诚实发生在人已经点过之后。平台在停接力那一刻就知道改动进了 base，却把这个信息留着不用，让人走完一个必然失败的动作。

**为什么不复用 `rejected`。** 没有人否决它。审查官给的是 `verdict=pass`，人也没拒。用 `rejected` 会把「外部事件让它失效」记成「有人不同意」，审计回放时是两件完全不同的事。所以要一个自己的终态，并且带原因。

**为什么不标成「已落地」。** 改动确实落地了——但不是经由这张卡落地的，人的批准从未发生。标 `applied` 会让审计流水读起来像「人批了、平台落了」，那是假的。这条和上一刀 `platform-spend` 同一个判据：没真发生的事不许显示成发生了。

## 怎么做

1. **加一个终态**。`ApprovalStatus` 加 `voided`，`ApprovalCard` 加 `voidReason`。Store 加一个方法（形如 `void(id, reason)`），只接受还开着的卡（`reviewing` / `pending`）——已经 `applied` / `rejected` 的不许改，终态不可回退。注意踩坑第 8 条：这个状态机是真的会挡人，`markApplied` 只接受 `approved`，别顺手放宽它。

2. **只在 `pr-merged` 作废，不在 `git-overstep` 作废**。两者都停接力，但意义不同：PR 合了，卡里那段 diff 已经进 base，批它是空动作；有人动了基准分支，卡里那段改动**仍然待落地**，人可能还是想批。一刀切会把后者误废。**`CLOSED` 也不作废**——PR 被关掉而没合，改动没进去，卡还成立。

3. **落点在已有分支上**。`settleTurn` 里 `pr-merged` 那条路径（清 `pendingHop`、不建卡）后面顺手作废本线程还开着的卡。不新开入口。

4. **系统句用 `notice`**。作废不改球权（`pr-merged` 已经把球给人了），按 `AGENTS.md` 约定不参与球权的用 `notice`，**不新增 `SystemKind`**。正文要写清是哪张卡、为什么失效（带 PR number）。

5. **`#approve` 要拒得清楚**。对失效卡打 `#approve ap_xxx` 要回一句说明原因的话，不是静默无效、也不是走到提交那一步才失败。

6. **审计**。作废是 store 动作，按 [audit-trail.md](audit-trail.md) 的约定由装饰器自动落，业务代码不写 `audit.append`。因为系统句用的是 `notice`，不涉及 `STORE_OWNED_SYSTEM_KINDS` 那条去重（踩坑第 31 条）。

7. **记分板加一行**。新坏毛病「合了之后那张卡还能批」。按踩坑第 27 条**按关分行**：复用 `merge-pr` 那个 fake，但**单独一行、单独断言卡的状态是 `voided`**，不要把这条塞进 `merge-pr` 现有那行的断言里——两道关合成一行，其中一道坏了记分板照样绿，这个坑这个项目已经踩过一次。

8. **验收**。绑仓线程：猫开 PR、审查出卡 → 人手合 PR → 再一跳 → 卡变「已失效(PR #N 已合并)」、界面上没有可点的批准/打回按钮、`#approve` 那张卡被拒。反向验：把作废调用掐掉（写 `// RVCUT 反向验`，见踩坑第 28 条），新增那行掉到 0 而 `merge-pr` 那行仍然满分。

## 不做（本篇）

- **不作废 `git-overstep` 那张卡**，理由见上。要不要给它一个「基准分支动过了，这张卡的基线可能不准」的提示，是另一篇。
- **不做卡的自动重建**。作废之后不替人重新算一张新卡——那要判断「哪些改动还没进 base」，是 review 回流那一层的体量。
- **不追 PR 关闭 / reopen / 强推改写**。只认 MERGED 这一个信号。
- **不改 `#approve` 之外的批准入口**（`autoApprove` 路径不涉及：被作废的前提是本跳已经停接力、不建新卡）。

## 入口

- 状态与终态：`packages/shared/src/types.ts`（`ApprovalStatus` / `ApprovalCard`）
- Store 方法与状态机：`packages/api/src/stores/ports.ts`、`memory.ts`、`redis.ts`（`void`）；审计装饰器 `stores/audit-log.ts`；广播 `http/broadcast-sync.ts`
- 作废时机：`packages/api/src/router/turn/settle.ts`（`pr-merged` 那条分支）；文案 `packages/api/src/services/pr.ts`
- 拒掉失效卡：`packages/api/src/router/turn/system-commands.ts`（`handleSystemCommand` 的 `#approve`）
- 卡片渲染成终态：`packages/web/components/ApprovalCardBlock.tsx` + `packages/web/lib/parse-message.ts`
- 记分板：`scripts/eval.ts`（`void-after-merge`，复用 `fake-merge-pr.mjs`，单独一行）
- 协议：见 `AGENTS.md` 协议表「平台自己做的」合了之后作废还开着的卡那一行
