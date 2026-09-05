# clowder 对齐总账

> 唯一权威计分处:我们对齐到参考项目的百分之几、每条什么状态、下一条建议补什么。
> 策展标准与「有意不做」规则见设计稿 docs/superpowers/specs/2026-09-05-clowder-alignment-ledger-design.md。
> 对内工作文档,不对外;对外叙事讲「我做了什么、为什么」。

**当前对齐率:已对齐 13 / 分母 31 = 42%**(每次相关改动同轮更新)

## 分母(核心清单)

| # | 条目 | 状态 | clowder 出处 | meowbase 证据 | 面试钩子 |
|---|---|---|---|---|---|
| 1 | A2A 链式交接 | 已对齐 | [F002](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F002-agent-to-agent.md) | [a2a](features/a2a.md)、[A2A 说明](A2A.md)、[auto-follow-pending](features/auto-follow-pending.md) | 交接包就是下一棒吃的那份 prompt——人点开接力条看到的就是猫看到的,没有第二套管线 |
| 2 | 漏传出口检查 | 已对齐 | [F064](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F064-a2a-exit-check.md)、[F005](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F005-a2a-follow-up.md) | [exit-nudge](features/exit-nudge.md) | 该交棒没交时我再问同一只一次——提醒寄件人,绝不替它写地址 |
| 3 | 行首 @ 路由卫生 | 已对齐 | [F046](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F046-anti-drift-protocol.md) | [AGENTS.md 协议表](../AGENTS.md)、[mention-routing](features/mention-routing.md) | 只有行首 @ 才路由——我用一张协议表把「人打的/猫写的/平台自己做的」三种语法彻底分开,句中 @ 不路由 |
| 4 | 无 @ 回退与群组 mention | 部分对齐(差群组展开 @all/@thread/品种) | [F078](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F078-smart-routing-group-mentions.md) | [mention-routing](features/mention-routing.md)、[AGENTS.md 协议表](../AGENTS.md) | 回退梯级只信人点过的名——猫自己聊出来的 @ 不许劫持路由 |
| 5 | A2A 链质量(虚空传球/防环/球权出口) | 部分对齐(差跨轮乒乓熔断账本、final slot 机械校验) | [F167](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F167-a2a-chain-quality.md) | [void-handoff-gate](features/void-handoff-gate.md)、[hold-wait](features/hold-wait.md)、[review-ball-to-human](features/review-ball-to-human.md)、[revise-ball-to-writer](features/revise-ball-to-writer.md) | 空信封不投递——平台只看这一跳有没有留下东西,不判断内容好不好 |
| 6 | 多 @ 编排 | 部分对齐(差并行 multi-mention 状态机;顺序执行是有意裁剪) | [F086](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F086-cat-orchestration-multi-mention.md) | [one-hop-per-thread](features/one-hop-per-thread.md)、[mention-routing](features/mention-routing.md) | 群发并行没有保护,我把它改成顺序执行——同一棵树同一个 git index,并行提交会张冠李戴 |
| 7 | 重启自愈与接力续跑 | 已对齐 | [F048](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F048-restart-recovery.md) | [durable-relay](features/durable-relay.md)、[hop-commit-then-clear](features/hop-commit-then-clear.md) | 跑完落库再清那一棒——邮差把信送到才划掉,不是拿到手就划掉 |
| 8 | 线程绑仓 worktree 隔离 | 已对齐 | [SOP](https://github.com/zts212653/clowder-ai/blob/main/docs/SOP.md)、[F082](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F082-git-health-panel.md) | [thread-repo-worktree](features/thread-repo-worktree.md) | 隔离不靠提示词靠 git worktree——每条线程一棵树一根分支,主干拿不到 |
| 9 | 仓根白名单与本机绑定 | 已对齐 | [F074](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F074-mount-directory-support.md) | [repo-root-allowlist](features/repo-root-allowlist.md) | 没有鉴权的 API 我只听本机——想开 LAN 得显式配,绑错路径当场告诉你允许哪些根 |
| 10 | git 观测与越界拉闸 | 已对齐 | [F082](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F082-git-health-panel.md)、[F140](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F140-github-pr-automation.md) | [git-state-tracking](features/git-state-tracking.md)、[push-boundary](features/push-boundary.md) | 平台看什么动了,不看猫说自己干了什么——每跳比对只读 git 快照,越界就停;我不靠纪律约束猫自觉,闸装在平台上,谁碰基准分支谁停 |
| 11 | 会话连续性(压缩后恢复) | 缺失 | [F065](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F065-session-continuity.md) | | 重启后捡棒我已经有了,缺的是跨会话的记忆续接——我打算把已确认证据当续接胶囊喂给新 session,不急是因为会话内的接力那条道已经通了 |
| 12 | 每猫独立 CLI 会话 | 已对齐 | [F053](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F053-gemini-resume-session-parity.md) | [providers](features/providers.md)、[a2a](features/a2a.md) | 身份和工具记忆不串台——每只猫自己的 session,下次各自 resume |
| 13 | 配置可见与运行时修改 | 已对齐 | [F001](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F001-config-visibility.md)、[F004](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F004-runtime-config.md) | [hub-capability](features/hub-capability.md)、[AGENTS.md 常见操作](../AGENTS.md) | Hub 点保存改内存再落盘立即生效——改配置和跑代码不能是两套真相 |
| 14 | 跨线程传话溯源 | 缺失 | [F052](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F052-cross-thread-identity-isolation.md) | | 跨线程传话我没做——要做就得先解决「同名猫自引用过滤」的身份坑 |
| 15 | 记忆写入治理 | 部分对齐(差物化到 .md 真相源、索引为可重建编译产物) | [F102](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F102-memory-adapter-refactor.md) | [memory-evidence](features/memory-evidence.md) | 记忆入库必须人点头——模型喜欢把猜测写成决定,人一签下一线程才敢用 |
| 16 | 记忆划界、出处与联邦检索 | 部分对齐(差联邦检索、Collection 治理、生命周期) | [F186](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F186-library-memory-architecture.md) | [memory-scope](features/memory-scope.md) | 记忆按仓划界、注入带出处——猫看得出这条约定来自哪个项目、什么时候确认的 |
| 17 | 记忆召回度量 | 缺失 | [F200](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F200-memory-recall-eval.md) | | 我不知道猫召回的记忆用没用上——要量就用真实行为信号,不用自评 |
| 18 | 技能按需注入 | 已对齐 | [F038](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F038-skills-discovery.md) | [skills](features/skills.md) | 技能是被喊到才出现的说明书——不常驻上下文,省 token 也避免永远用审查口吻写代码 |
| 19 | 技能/工具使用度量 | 缺失 | [F150](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F150-tool-usage-stats.md) | | 我说不清哪个技能真被用过——这是厚薄表上最薄的一条 |
| 20 | 跨猫互审与人批落地 | 部分对齐(差云端第二层 review) | [F031](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F031-review-two-layer-process.md) | [approval](features/approval.md)、[review-conclusion](features/review-conclusion.md) | 审查是猫推理、落地是人拍板——互审是内建管线,不是聊天里求人 |
| 21 | 按风险面选审查官 | 已对齐 | [SOP](https://github.com/zts212653/clowder-ai/blob/main/docs/SOP.md) | [risk-routed-reviewer](features/risk-routed-reviewer.md) | 强制力跟风险走——审查官按 diff 命中的风险面选,任何情况不许自审 |
| 22 | 验证闸(没证据不算通过) | 已对齐 | [SOP](https://github.com/zts212653/clowder-ai/blob/main/docs/SOP.md) | [verification-gate](features/verification-gate.md) | 没证据不算通过——闸只管卡上结论和自动落地,不管顶栏文案 |
| 23 | GitHub PR 自动化 | 部分对齐(差 review 回流、CI 追踪、冲突检测) | [F140](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F140-github-pr-automation.md)、[F133](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F133-cicd-tracking.md) | [pr-open](features/pr-open.md)、[approval-void](features/approval-void.md) | 猫能自己开 PR,合了平台自己停——但 PR 上的 review comment 还不会流回来叫醒猫 |
| 24 | 统一审批中心 | 缺失 | [F246](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F246-approval-hub.md) | | 审批卡散在各条线程里——我缺一个「全局待批」的聚合视图 |
| 25 | 操作审计流水 | 部分对齐(差 CLI 原始日志取证层) | [F013](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F013-audit-log-v2.md) | [audit-trail](features/audit-trail.md) | 业务代码不写审计调用——让 store 边界自动记账,不靠人记得 |
| 26 | token 归一化与按猫账本 | 已对齐 | [F008](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F008-token-budget-observability.md) | [quota-board](features/quota-board.md)、[platform-spend](features/platform-spend.md) | 账本只展示报上来的花费——估出来的数字比没有数字更能骗人 |
| 27 | 额度池看板与预算闸 | 缺失 | [F051](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F051-real-quota-dashboard.md) | | 账本我只看不管——超预算该不该拒跑,是「平台会不会拒绝」那条道的关键一刀 |
| 28 | 消息分层可观测 | 部分对齐(差 thinking/plan 可观测层、遥测层) | [F045](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F045-ndjson-observability.md) | [system-message-kind](features/system-message-kind.md)、[live-sync](features/live-sync.md) | 平台知道的事件类型我打在消息字段里——改文案再也不会让顶栏静默失灵 |
| 29 | 邮箱/统一消息队列 | 缺失 | [F039](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F039-message-queue-delivery.md)、[F122](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F122-unified-dispatch-queue.md)、[F175](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F175-unified-message-queue.md) | | 我先做成一场接力——异步靠 pendingHop 槽;邮箱是 README 明写的形态缺口,按迭代节奏后补,是顺序问题不是不做 |
| 30 | SOP 流程守护 | 缺失 | [SOP](https://github.com/zts212653/clowder-ai/blob/main/docs/SOP.md)、[F073](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F073-sop-auto-guardian.md)、[F083](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F083-design-gate-sop.md) | | 我的家规写在 AGENTS.md 给人读——SOP 外化是 README 明写的形态缺口,下一步把接力棒外化成猫也读的共享结构 |
| 31 | MCP 协作工具与配置编排 | 缺失 | [F043](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F043-mcp-unification.md)、[F145](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F145-mcp-portable-provisioning.md)、[F249](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F249-multi-project-mcp-sync-management.md)、[F286](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F286-mcp-surface-lifecycle-governance.md) | | 猫的协作现在全靠平台拼 prompt——结构化工具通道是 README 明写的形态缺口,还没开的那扇门 |

## 有意不做(不计入分母)

| 条目 | clowder 出处 | 不做的理由 |
|---|---|---|
| 游戏引擎(像素格斗/狼人杀/象棋等) | [F090](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F090-pixel-cat-brawl.md)、[F101](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F101-mode-v2-game-engine.md)、[F107](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F107-headband-guess-game.md)、[F119](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F119-who-is-spy-game.md)、[F170](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F170-web-chinese-chess.md) | 和「多 Agent 协作平台」的核心叙事无关,机制复杂度全在游戏本身 |
| 语音链路(输入/TTS/声纹/生态) | [F020](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F020-voice-input-suite.md)、[F034](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F034-voice-message.md)、[F066](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F066-voice-pipeline-upgrade.md)、[F092](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F092-voice-companion-experience.md)、[F103](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F103-per-cat-voice-identity.md)、[F111](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F111-streaming-tts-chunker.md)、[F112](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F112-voice-playback-queue.md)、[F124](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F124-apple-ecosystem-voice-interaction.md)、[F176](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F176-native-cli-assistant-speech-rendering.md) | 面试叙事讲编排不讲外设;语音是一条独立工程线,对齐了也讲不进协作内核的故事 |
| 硬件四肢(肢体控制/蓝牙设备) | [F126](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F126-limb-control-plane.md)、[F270](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F270-ble-typed-limb-device-family.md)、[F285](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F285-stackchan-physical-limb-plugin.md) | 需要实体设备,与本机开发工具的定位无关 |
| IM 网关(飞书/钉钉/微信/小艺) | [F088](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F088-multi-platform-chat-gateway.md)、[F132](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F132-dingtalk-wecom-gateway.md)、[F134](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F134-feishu-group-chat.md)、[F137](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F137-weixin-personal-gateway.md)、[F151](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F151-xiaoyi-channel-gateway.md) | 分发渠道不是编排能力;自带 Web UI 已覆盖演示路径,网关只增加账号与合规成本 |
| 桌面发布管线(安装器/应用内更新) | [F179](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F179-desktop-installer-release-pipeline.md)、[F273](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F273-desktop-in-app-update.md) | 打包分发问题,不是多 Agent 机制问题 |
| 视频管线(视频工作室/provider 插件) | [F138](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F138-video-studio.md)、[F205](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F205-video-provider-plugins.md) | 内容生产垂直场景,与协作内核无关 |
| 陪伴/世界引擎(梦境/虚拟世界) | [F093](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F093-cats-and-u-world-engine.md)、[F255](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F255-auto-dream.md)、[F258](https://github.com/zts212653/clowder-ai/blob/main/docs/features/F258-visible-cafe.md) | 叙事型陪伴是另一个产品命题,机制级对齐的代价远高于叙事收益 |

## 补缺口的建议顺序

按「面试叙事价值 × 工程依赖 × 成本(不花钱优先)」排,每条开工前仍先写薄设计、等人点头:

1. **F140 review 回流 + CI 追踪**(补第 23 行)——「合了就停」的自然续章,讲「事件该回流到哪只猫」;轮询只读不花钱;预计 3–4 刀(comment 回流 / CI 状态 / 冲突检测 / 叫醒策略,inline comment 抓不到的坑先写进薄设计)。
2. **预算闸**(补第 27 行的 budget 半)——账本数据已经在 `Message.usage` 里,只差 `executeTurn` 的准入判断;「平台会不会拒绝」从「中」补厚的关键;预计 1–2 刀。
3. **技能/工具使用度量**(补第 19 行)——计数 + 看板,fake 可测、不花钱;厚薄表唯一「薄」的那条道;预计 2 刀。
4. **邮箱/统一队列形态**(补第 29 行)——租约、收尸、at-least-once 的地基已经打好,叙事是「从一条槽到一个队列」;预计 4–6 刀。
5. **SOP 外化**(补第 30 行)——AGENTS.md 和踩坑清单是现成素材,把 workflow 共享结构 + 压缩后恢复胶囊做薄;预计 3–4 刀。
6. **MCP 最小形态**(补第 31 行)——先做协作工具补全一层(搜消息/列线程),配置编排后议;预计 3–5 刀。
7. **记忆写侧加厚**(补第 15 行)——对齐「真相在文件、索引可重建」:确认时物化 .md + 重建脚本;预计 3–4 刀。
8. **审计取证层**(补第 25 行)——CLI 原始事件按调用分片归档、短保留期,和追责层分开;预计 2 刀。
