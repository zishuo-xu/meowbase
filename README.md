# Meowbase(喵窝)

多 Agent 协作平台:让 Claude Code / Gemini CLI / opencode 三支 agent CLI 像一支团队一样协作。
架构参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT),代码为独立实现。

## 快速开始

```bash
pnpm install
pnpm dev   # 起 Redis + API(3200)+ Web(3300)
```

浏览器打开 http://localhost:3300:线程管理、猫耳气泡聊天、审批卡片按钮、证据确认。
(API 需要本机 Redis 与 claude CLI;冒烟/演示可设 CLAUDE_BIN / OPENCODE_BIN 指向 fake)

```bash
# 仅 API:
pnpm --filter @meowbase/api dev
```

创建线程并让 claude 干活:

```bash
curl -X POST localhost:3200/api/threads \
  -H 'content-type: application/json' \
  -d '{"title":"hello","primaryAgentId":"claude"}'
# 记录返回的 id,然后:
curl -X POST localhost:3200/api/threads/<id>/messages \
  -H 'content-type: application/json' \
  -d '{"content":"@claude 用一句话介绍你自己"}'
```

## 架构

三层:模型(推理)→ Agent CLI(工具)→ 平台(路由/线程/记忆/技能/审批)。
本仓库当前进度:M4 跨模型互审+审批流(claude 写 → opencode 审 → 人批准落地)。

## 审批流(M4)

- 写手 agent 改动文件后,平台自动生成审批卡片并请另一 agent 审查
- `#approve ap_xxxxxxxx` —— 批准(改动提交为基线)
- `#reject ap_xxxxxxxx <理由>` —— 打回

## Skills(M3)

消息中带触发词(如 "tdd"、"review"、"debug")时,对应技能会注入该轮上下文:

- `tdd` / `测试驱动` → 测试驱动开发
- `review` / `审查` / `代码评审` → 代码审查
- `debug` / `调试` / `bug` → 系统化调试

## 多角色协作

- **同题并行**:`@墨墨 @团团 帮我看看这个方案` —— 同一消息并行发给所有目标,各自回答(适合征求意见/评审)
- **A2A 接力**:agent 回复中行首 `@其他角色 任务` → 平台自动交接继续执行(链深 3,防环)
- 分工由猫们自己协调,你不必当"路由器"

## 消息协议(M2)

- `#learn <标题>` —— 请求沉淀本轮回复为证据,系统会给出确认提示
- `#confirm ev_xxxxxxxx` —— 确认沉淀
- `#ev_xxxxxxxx` —— 在消息中引用历史证据,注入 agent 上下文
- 三个 agent 有内置身份(墨墨/闪闪/团团),新会话自动注入

## 测试

```bash
pnpm test              # 单测(内存存储,不依赖 Redis/CLI)
pnpm smoke             # 真实冒烟(需要 Redis + claude CLI)
```

> 提示:冒烟需要 claude CLI 可用(能正常认证)。若 CLI 配置了中转/自定义 provider,请先确保 key 有效。
