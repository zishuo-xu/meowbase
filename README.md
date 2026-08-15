# Meowbase(喵窝)

多 Agent 协作平台:让 Claude Code / Gemini CLI / opencode 三支 agent CLI 像一支团队一样协作。
架构参考 [clowder-ai](https://github.com/zts212653/clowder-ai)(MIT),代码为独立实现。

## 快速开始

```bash
pnpm install
pnpm --filter @meowbase/api dev   # 启动 API(需本机 Redis 与 claude CLI)
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
本仓库当前进度:M1 骨架(线程消息 + @mention 路由 + ClaudeAdapter + WebSocket 流式)。

## 测试

```bash
pnpm test              # 单测(内存存储,不依赖 Redis/CLI)
pnpm smoke             # 真实冒烟(需要 Redis + claude CLI)
```

> 提示:冒烟需要 claude CLI 可用(能正常认证)。若 CLI 配置了中转/自定义 provider,请先确保 key 有效。
