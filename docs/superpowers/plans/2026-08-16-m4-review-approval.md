# M4 实现计划:跨模型互审 + 审批流

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写手改动文件后自动生成审批卡片,另一 agent 审查,用户 `#approve`/`#reject` 决策,批准后 git 基线提交落地。

**Architecture:** OpenCodeAdapter(第二个 provider)+ 线程工作目录 git 化(空基线)+ `gitDiffHead` 产出 diff + `ApprovalStore` 卡片 + executeTurn 自动审查与命令分支 + 审查配对纯函数。

**Tech Stack:** 同前。新增 `services/git.ts`(execFile 封装)、opencode 的 ndjson 解析器与 fixture。

## Global Constraints

- 沿用 M1-M3 约束;`#approve`/`#reject` 为系统操作分支(不调写手 agent)
- 审查在 executeTurn 内同步完成(一次 HTTP 响应走完);reviewer 不可用时不阻塞卡片创建
- diff 文本截断 20k 字符;新增用例 ≥ 15
- opencode 模型默认 `opencode-go/deepseek-v4-flash`,可用 `OPENCODE_MODEL` 覆盖

---

### Task 1: shared 命令解析 + 审查配对(纯函数 TDD)

**Files:**
- Modify: `packages/shared/src/types.ts`(ApprovalStatus、ApprovalCard)
- Modify: `packages/shared/src/commands.ts`(parseApproveCommand、parseRejectCommand)
- Create: `packages/shared/src/pairing.ts`(selectReviewer)
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/approval-commands.test.ts`
- Create: `packages/shared/test/pairing.test.ts`

**Interfaces:**
- Produces: `ApprovalCard`、`ApprovalStatus`;`parseApproveCommand(content): { id } | null`;`parseRejectCommand(content): { id; reason } | null`;`selectReviewer(writer: AgentId, available: AgentId[]): AgentId | undefined`

- [ ] **Step 1: 写失败测试**

`packages/shared/test/approval-commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseApproveCommand, parseRejectCommand } from '../src/commands.js';

describe('parseApproveCommand', () => {
  it('解析 #approve ap_xxx', () => {
    expect(parseApproveCommand('#approve ap_a1b2c3d4')).toEqual({ id: 'ap_a1b2c3d4' });
  });

  it('普通消息返回 null', () => {
    expect(parseApproveCommand('好的')).toBeNull();
  });
});

describe('parseRejectCommand', () => {
  it('解析 #reject 带理由', () => {
    expect(parseRejectCommand('#reject ap_a1b2c3d4 边界没覆盖')).toEqual({
      id: 'ap_a1b2c3d4',
      reason: '边界没覆盖',
    });
  });

  it('无理由也返回(空理由)', () => {
    expect(parseRejectCommand('#reject ap_a1b2c3d4')).toEqual({
      id: 'ap_a1b2c3d4',
      reason: '',
    });
  });

  it('普通消息返回 null', () => {
    expect(parseRejectCommand('不同意')).toBeNull();
  });
});
```

`packages/shared/test/pairing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectReviewer } from '../src/pairing.js';

describe('selectReviewer', () => {
  it('claude 写 → opencode 审', () => {
    expect(selectReviewer('claude', ['claude', 'opencode'])).toBe('opencode');
  });

  it('opencode 写 → claude 审', () => {
    expect(selectReviewer('opencode', ['claude', 'opencode'])).toBe('claude');
  });

  it('只有写手自己 → undefined', () => {
    expect(selectReviewer('claude', ['claude'])).toBeUndefined();
  });

  it('写手不可用时选第一个可用且不同的', () => {
    expect(selectReviewer('claude', ['gemini'])).toBe('gemini');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/shared exec vitest run test/approval-commands.test.ts test/pairing.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/shared/src/types.ts`(追加):

```ts
export type ApprovalStatus = 'draft' | 'reviewing' | 'approved' | 'rejected' | 'applied';

export interface ApprovalCard {
  id: string;
  threadId: string;
  writerAgentId: AgentId;
  reviewerAgentId: AgentId;
  status: ApprovalStatus;
  diffText: string;
  diffStat: string;
  reviewComment?: string;
  rejectReason?: string;
  createdAt: string;
}
```

`packages/shared/src/commands.ts`(追加):

```ts
const APPROVE_PATTERN = /#approve\s+(ap_[a-f0-9]{8})\b/;

export function parseApproveCommand(content: string): { id: string } | null {
  const match = content.match(APPROVE_PATTERN);
  const id = match?.[1];
  return id ? { id } : null;
}

const REJECT_PATTERN = /#reject\s+(ap_[a-f0-9]{8})(?:\s+(.*))?$/;

export function parseRejectCommand(content: string): { id: string; reason: string } | null {
  const match = content.match(REJECT_PATTERN);
  const id = match?.[1];
  if (!id) return null;
  return { id, reason: (match?.[2] ?? '').trim() };
}
```

`packages/shared/src/pairing.ts`:

```ts
import type { AgentId } from './types.js';

const PREFERRED_PAIRS: Record<AgentId, AgentId> = {
  claude: 'opencode',
  opencode: 'claude',
  gemini: 'claude',
};

export function selectReviewer(
  writer: AgentId,
  available: AgentId[],
): AgentId | undefined {
  const preferred = PREFERRED_PAIRS[writer];
  if (preferred && available.includes(preferred)) return preferred;
  return available.find((id) => id !== writer);
}
```

`packages/shared/src/index.ts`(追加):

```ts
export type { ApprovalCard, ApprovalStatus } from './types.js';
export { parseApproveCommand, parseRejectCommand } from './commands.js';
export { selectReviewer } from './pairing.js';
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 7 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(shared): 审批命令解析 + 审查配对"
```

---

### Task 2: ApprovalStore 端口 + 内存/Redis 实现

**Files:**
- Modify: `packages/api/src/stores/ports.ts`
- Modify: `packages/api/src/stores/memory.ts`
- Modify: `packages/api/src/stores/redis.ts`
- Modify: `packages/api/src/stores/factories.ts`
- Modify: `packages/api/test/stores-memory.test.ts`
- Modify: `packages/api/test/redis-stores.test.ts`

**Interfaces:**
- Produces: `ApprovalStore { create; get; list(threadId?); approve(id); reject(id, reason); markApplied(id) }`,id 前缀 `ap_` + 8 位;`createMemoryStores` 增加 `approvals`

- [ ] **Step 1: 写失败测试**

`packages/api/test/stores-memory.test.ts`(追加):

```ts
describe('内存 Approval 存储', () => {
  it('create → approve → markApplied 状态流转', async () => {
    const { approvals } = createMemoryStores();
    const card = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: '1 file changed',
    });
    expect(card.id).toMatch(/^ap_[a-f0-9]{8}$/);
    expect(card.status).toBe('draft');

    const approved = await approvals.approve(card.id);
    expect(approved?.status).toBe('approved');
    expect(await approvals.approve(card.id)).toBeNull(); // 重复 approve 失败

    const applied = await approvals.markApplied(card.id);
    expect(applied?.status).toBe('applied');
  });

  it('reject 带理由;list 按线程过滤', async () => {
    const { approvals } = createMemoryStores();
    const card = await approvals.create({
      threadId: 't1', writerAgentId: 'claude', reviewerAgentId: 'opencode',
      diffText: 'd', diffStat: 's',
    });
    const rejected = await approvals.reject(card.id, '理由');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectReason).toBe('理由');
    expect(await approvals.reject(card.id, 'x')).toBeNull();
    expect((await approvals.list('t1')).length).toBe(1);
    expect(await approvals.get('ap_00000000')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/stores-memory.test.ts`
Expected: FAIL,无 approvals。

- [ ] **Step 3: 实现**

`packages/api/src/stores/ports.ts`(追加):

```ts
import type { AgentId, ApprovalCard, AgentProfile, EvidenceEntry, EvidenceKind, Message, Skill, Thread } from '@meowbase/shared';

export interface ApprovalStore {
  create(input: {
    threadId: string;
    writerAgentId: AgentId;
    reviewerAgentId: AgentId;
    diffText: string;
    diffStat: string;
  }): Promise<ApprovalCard>;
  get(id: string): Promise<ApprovalCard | null>;
  list(threadId?: string): Promise<ApprovalCard[]>;
  approve(id: string): Promise<ApprovalCard | null>;
  reject(id: string, reason: string): Promise<ApprovalCard | null>;
  markApplied(id: string): Promise<ApprovalCard | null>;
}
```

`packages/api/src/stores/memory.ts`(追加):

```ts
import { generateApprovalId } from '@meowbase/shared'; // 见下方 Step 3 补充

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly cards = new Map<string, ApprovalCard>();

  async create(input: Parameters<ApprovalStore['create']>[0]): Promise<ApprovalCard> {
    const card: ApprovalCard = {
      id: generateApprovalId(),
      threadId: input.threadId,
      writerAgentId: input.writerAgentId,
      reviewerAgentId: input.reviewerAgentId,
      status: 'draft',
      diffText: input.diffText,
      diffStat: input.diffStat,
      createdAt: new Date().toISOString(),
    };
    this.cards.set(card.id, card);
    return card;
  }

  async get(id: string): Promise<ApprovalCard | null> {
    return this.cards.get(id) ?? null;
  }

  async list(threadId?: string): Promise<ApprovalCard[]> {
    const all = [...this.cards.values()];
    return threadId ? all.filter((c) => c.threadId === threadId) : all;
  }

  async approve(id: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'approved' };
    this.cards.set(id, updated);
    return updated;
  }

  async reject(id: string, reason: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || (card.status !== 'draft' && card.status !== 'reviewing')) return null;
    const updated: ApprovalCard = { ...card, status: 'rejected', rejectReason: reason };
    this.cards.set(id, updated);
    return updated;
  }

  async markApplied(id: string): Promise<ApprovalCard | null> {
    const card = this.cards.get(id);
    if (!card || card.status !== 'approved') return null;
    const updated: ApprovalCard = { ...card, status: 'applied' };
    this.cards.set(id, updated);
    return updated;
  }
}
```

`packages/shared/src/commands.ts`(追加,供 id 生成):

```ts
export function generateApprovalId(): string {
  return `ap_${randomBytes(4).toString('hex')}`;
}
```

(shared index.ts 同步导出 `generateApprovalId`)

`packages/api/src/stores/redis.ts`(追加,key 前缀 `approval:` + `approval:index`,与 evidence 同构——复用 hydrate/hset 模式)

`packages/api/src/stores/factories.ts`:createMemoryStores 加 `approvals: new InMemoryApprovalStore()`;`createApprovalStore(redis)`

- [ ] **Step 4: 运行确认通过**

Run: 同上命令(Redis 用例:新增 create→approve→applied 一条,见 redis-stores.test.ts)
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): ApprovalStore(内存+Redis)"
```

---

### Task 3: git 辅助函数(真实 git 验证)

**Files:**
- Create: `packages/api/src/services/git.ts`
- Create: `packages/api/test/git.test.ts`

**Interfaces:**
- Produces: `gitInit(dir)`:init + user 配置 + 空基线提交;`gitAddAll(dir)`;`gitDiffHead(dir): Promise<{ stat; text } | null>`(无改动返回 null);`gitCommit(dir, message)`

- [ ] **Step 1: 写失败测试**

`packages/api/test/git.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitAddAll, gitCommit, gitDiffHead, gitInit } from '../src/services/git.js';

describe('git 辅助函数', () => {
  it('init 空基线;新增文件后 diff 非空;commit 后 diff 为空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-'));
    await gitInit(dir);
    expect(await gitDiffHead(dir)).toBeNull();

    writeFileSync(join(dir, 'a.txt'), 'hello');
    await gitAddAll(dir);
    const diff = await gitDiffHead(dir);
    expect(diff).not.toBeNull();
    expect(diff?.stat).toContain('a.txt');
    expect(diff?.text).toContain('+hello');

    await gitCommit(dir, 'baseline');
    expect(await gitDiffHead(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/git.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/api/src/services/git.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function run(dir: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: dir });
  return stdout;
}

export async function gitInit(dir: string): Promise<void> {
  await run(dir, ['init', '-q']);
  await run(dir, ['config', 'user.name', 'meowbase']);
  await run(dir, ['config', 'user.email', 'meowbase@local']);
  await run(dir, ['commit', '--allow-empty', '-q', '-m', 'baseline']);
}

export async function gitAddAll(dir: string): Promise<void> {
  await run(dir, ['add', '-A']);
}

export async function gitDiffHead(dir: string): Promise<{ stat: string; text: string } | null> {
  const text = await run(dir, ['diff', 'HEAD', '--', '.']);
  if (!text.trim()) return null;
  const stat = await run(dir, ['diff', 'HEAD', '--stat']);
  return { stat: stat.trim(), text: text.slice(0, 20_000) };
}

export async function gitCommit(dir: string, message: string): Promise<void> {
  await run(dir, ['commit', '-q', '-m', message]);
}
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 1 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): git 辅助函数(基线/diff/提交)"
```

---

### Task 4: OpenCodeAdapter + golden fixture

**Files:**
- Create: `packages/api/test/fixtures/opencode-sample.jsonl`(真实录制)
- Create: `packages/api/src/providers/opencode-json.ts`(解析器)
- Create: `packages/api/src/providers/opencode.ts`(适配器)
- Modify: `packages/api/src/providers/registry.ts`(AgentRegistry 增加 `list()`)
- Modify: `packages/api/src/config.ts`(opencodeBin、opencodeModel)
- Create: `packages/api/test/fixtures/fake-opencode.mjs`
- Create: `packages/api/test/opencode-adapter.test.ts`

**Interfaces:**
- Produces: `OpenCodeAdapter implements AgentService`(agentId='opencode');`parseOpencodeLine` / `OpenCodeAccumulator`(与 claude 版同构)

- [ ] **Step 1: 写失败测试 + fixture + fake**

`packages/api/test/fixtures/opencode-sample.jsonl`(真实录制内容,格式:step_start / text / step_finish):

```jsonl
{"type":"step_start","sessionID":"ses_fixture1","part":{"type":"step-start","messageID":"m1"}}
{"type":"text","sessionID":"ses_fixture1","part":{"type":"text","text":"收到"}}
{"type":"step_finish","sessionID":"ses_fixture1","part":{"type":"step-finish","reason":"stop","tokens":{"total":100,"input":6,"output":2,"reasoning":0,"cache":{"write":0,"read":90}}},"cost":0.00002}
```

`packages/api/src/providers/opencode-json.ts` 的测试(`packages/api/test/opencode-json.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { OpenCodeAccumulator } from '../src/providers/opencode-json.js';

describe('OpenCodeAccumulator', () => {
  it('text 增量累积;step_finish 出 usage 与 sessionId', () => {
    const acc = new OpenCodeAccumulator();
    let total = '';
    for (const line of [
      '{"type":"step_start","sessionID":"ses_fixture1","part":{"type":"step-start"}}',
      '{"type":"text","sessionID":"ses_fixture1","part":{"type":"text","text":"收"}}',
      '{"type":"text","sessionID":"ses_fixture1","part":{"type":"text","text":"到"}}',
      '{"type":"step_finish","sessionID":"ses_fixture1","part":{"type":"step-finish","reason":"stop","tokens":{"total":100,"input":6,"output":2,"cache":{"read":90}}},"cost":0.00002}',
    ]) {
      const delta = acc.push(line);
      if (delta) total += delta;
    }
    expect(total).toBe('收到');
    expect(acc.content).toBe('收到');
    expect(acc.sessionId).toBe('ses_fixture1');
    expect(acc.usage?.inputTokens).toBe(6);
    expect(acc.usage?.outputTokens).toBe(2);
    expect(acc.usage?.costUsd).toBe(0.00002);
    expect(acc.status).toBe('completed');
  });

  it('非 step_finish 结束标记 failed', () => {
    const acc = new OpenCodeAccumulator();
    acc.push('{"type":"step_finish","sessionID":"s","part":{"type":"step-finish","reason":"error"}}');
    expect(acc.status).toBe('failed');
  });
});
```

`packages/api/test/fixtures/fake-opencode.mjs`:

```js
#!/usr/bin/env node
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-fake","part":{"type":"step-start"}}\n' +
    '{"type":"text","sessionID":"ses-fake","part":{"type":"text","text":"审查通过"}}\n' +
    '{"type":"step_finish","sessionID":"ses-fake","part":{"type":"step-finish","reason":"stop","tokens":{"total":50,"input":5,"output":4}},"cost":0.00001}\n',
);
```

`packages/api/test/opencode-adapter.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter } from '../src/providers/opencode.js';

const FAKE_BIN = join(import.meta.dirname, 'fixtures', 'fake-opencode.mjs');

describe('OpenCodeAdapter', () => {
  it('跑通一轮:解析增量、usage、会话 ID', async () => {
    const adapter = new OpenCodeAdapter({ bin: FAKE_BIN });
    const deltas: string[] = [];
    const output = await adapter.runTurn({
      prompt: '审查', workdir: '/tmp', onIncrement: (d) => deltas.push(d),
    });
    expect(deltas.join('')).toBe('审查通过');
    expect(output.content).toBe('审查通过');
    expect(output.sessionId).toBe('ses-fake');
    expect(output.status).toBe('completed');
    expect(output.usage?.outputTokens).toBe(4);
  });

  it('超时返回 terminated', async () => {
    const adapter = new OpenCodeAdapter({ bin: FAKE_BIN, timeoutMs: 1 });
    const output = await adapter.runTurn({ prompt: 'hi', workdir: '/tmp' });
    expect(output.status).toBe('terminated');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/opencode-json.test.ts test/opencode-adapter.test.ts`
Expected: FAIL,模块不存在。

- [ ] **Step 3: 实现**

`packages/api/src/providers/opencode-json.ts`:

```ts
import type { MessageStatus, TokenUsage } from '@meowbase/shared';

export class OpenCodeAccumulator {
  private parts: string[] = [];
  private _sessionId?: string;
  private _usage?: TokenUsage;
  private _status: MessageStatus = 'completed';
  private _error?: string;

  push(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (typeof obj.sessionID === 'string') this._sessionId = obj.sessionID;

    const part = obj.part as Record<string, unknown> | undefined;
    if (obj.type === 'text' && part?.type === 'text' && typeof part.text === 'string') {
      this.parts.push(part.text);
      return part.text;
    }
    if (obj.type === 'step_finish') {
      const reason = typeof part?.reason === 'string' ? part.reason : '';
      const tokens = part?.tokens as Record<string, unknown> | undefined;
      if (reason === 'stop') {
        if (tokens) {
          const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
          const cache = tokens.cache as Record<string, unknown> | undefined;
          this._usage = {
            inputTokens: num(tokens.input),
            outputTokens: num(tokens.output),
            totalTokens: num(tokens.total),
            cacheReadTokens: cache ? num(cache.read) : undefined,
            costUsd: typeof obj.cost === 'number' ? obj.cost : undefined,
            costEstimated: typeof obj.cost === 'number',
          };
        }
      } else {
        this._status = 'failed';
        this._error = reason || 'opencode_step_error';
      }
    }
    return null;
  }

  get content(): string { return this.parts.join(''); }
  get sessionId(): string | undefined { return this._sessionId; }
  get usage(): TokenUsage | undefined { return this._usage; }
  get status(): MessageStatus { return this._status; }
  get error(): string | undefined { return this._error; }
}
```

`packages/api/src/providers/opencode.ts`(与 claude.ts 同构:spawn + 行缓冲 + 超时):

```ts
import { spawn } from 'node:child_process';
import type { AgentId } from '@meowbase/shared';
import { OpenCodeAccumulator } from './opencode-json.js';
import type { AgentService, AgentTurnInput, AgentTurnOutput } from './types.js';

export class OpenCodeAdapter implements AgentService {
  readonly agentId: AgentId = 'opencode';

  constructor(
    private readonly opts: { bin?: string; model?: string; timeoutMs?: number } = {},
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
    const bin = this.opts.bin ?? process.env.OPENCODE_BIN ?? 'opencode';
    const timeoutMs = input.timeoutMs ?? this.opts.timeoutMs ?? 300_000;
    const model = this.opts.model ?? process.env.OPENCODE_MODEL ?? 'opencode-go/deepseek-v4-flash';

    const args = ['run', input.prompt, '--format', 'json'];
    if (input.sessionId) args.push('--session', input.sessionId);
    args.push('-m', model);

    const accumulator = new OpenCodeAccumulator();
    const child = spawn(bin, args, { cwd: input.workdir, stdio: ['ignore', 'pipe', 'pipe'] });

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);

    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

    let buffer = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const delta = accumulator.push(line);
          if (delta && input.onIncrement) input.onIncrement(delta);
        }
      });
      child.on('close', () => resolve());
      child.on('error', (err) => { stderrChunks.push(String(err)); resolve(); });
    });
    clearTimeout(timer);

    const sessionId = accumulator.sessionId ?? input.sessionId ?? '';
    if (timedOut) {
      return { sessionId, content: accumulator.content, status: 'terminated', usage: accumulator.usage, error: `opencode 执行超时(${timeoutMs}ms)` };
    }
    if (accumulator.status === 'failed') {
      return { sessionId, content: accumulator.content, status: 'failed', usage: accumulator.usage, error: accumulator.error ?? 'opencode 执行失败' };
    }
    return { sessionId, content: accumulator.content, status: 'completed', usage: accumulator.usage };
  }
}
```

`packages/api/src/providers/registry.ts`(扩展):

```ts
import type { AgentId } from '@meowbase/shared';
import type { AgentRegistry, AgentService } from './types.js';

export function createAgentRegistry(services: AgentService[]): AgentRegistry {
  const byId = new Map<AgentId, AgentService>(services.map((s) => [s.agentId, s]));
  return {
    get: (agentId) => byId.get(agentId),
    list: () => [...byId.keys()],
  };
}
```

`packages/api/src/providers/types.ts`(AgentRegistry 增加):

```ts
export interface AgentRegistry {
  get(agentId: AgentId): AgentService | undefined;
  list(): AgentId[];
}
```

`packages/api/src/config.ts`(追加):

```ts
opencodeBin: string;   // env.OPENCODE_BIN ?? 'opencode'
opencodeModel: string; // env.OPENCODE_MODEL ?? 'opencode-go/deepseek-v4-flash'
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 4 个用例全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): OpenCodeAdapter + golden fixture"
```

---

### Task 5: executeTurn 审批流 + 命令分支

**Files:**
- Modify: `packages/api/src/router/execute-turn.ts`
- Modify: `packages/api/src/http/server.ts`(线程创建时 gitInit)
- Modify: `packages/api/src/router/execute-turn.ts` 的 TurnContext(stores 加 approvals)
- Modify: `packages/api/test/execute-turn.test.ts`(追加)
- Modify: `packages/api/test/http-integration.test.ts`(线程创建后目录为 git 仓库)

**Interfaces:**
- 行为:① `#approve` 分支(approve + gitCommit + markApplied + 回执);② `#reject` 分支;③ 完成轮有 diff → 卡片 + 自动审查 + 系统消息

- [ ] **Step 1: 写失败测试(追加)**

`packages/api/test/execute-turn.test.ts`(追加 describe;注意需要真实 git 工作目录):

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitAddAll } from '../src/services/git.js';

describe('executeTurn 审批流', () => {
  const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-approval-'));

  async function makeThread(stores: ReturnType<typeof createMemoryStores>, workdir?: string) {
    const thread = await stores.threads.create({
      title: 't', primaryAgentId: 'claude', workdirBase: workdir ?? workdirBase,
    });
    return thread;
  }

  it('完成轮有 diff → 创建卡片并自动审查', async () => {
    const stores = createMemoryStores([reviewSkillForTest()]);
    const reviewedPrompts: string[] = [];
    const registry = createAgentRegistry([
      stubAgent('claude', '完成'),
      {
        agentId: 'opencode',
        async runTurn(input) {
          reviewedPrompts.push(input.prompt);
          return { sessionId: 's', content: '审查意见:通过', status: 'completed' };
        },
      },
    ]);
    const thread = await makeThread(stores);
    // 在 workdir 里写一个文件,模拟写手改动
    writeFileSync(join(process.cwd(), thread.workdir, 'x.txt'), 'hello');

    const final = await executeTurn({
      threadId: thread.id, content: '写个文件', context: { stores, registry },
    });
    expect(final.status).toBe('completed');

    const cards = await stores.approvals.list(thread.id);
    expect(cards.length).toBe(1);
    expect(cards[0]?.status).toBe('reviewing');
    expect(cards[0]?.reviewComment).toContain('通过');
    expect(reviewedPrompts[0]).toContain('x.txt');

    const messages = await stores.messages.list(thread.id);
    const cardMsg = messages.find((m) => m.role === 'system' && m.content.includes('审批卡片'));
    expect(cardMsg?.content).toContain('#approve');
  });
});

function reviewSkillForTest() {
  return { id: 'review', name: '代码审查', description: 'd', triggers: ['review'], prompt: '审查清单' };
}
```

注意:`thread.workdir` 是相对 `work/<id>`,需在测试里 mkdir 该目录(或改用手动 gitInit)。**执行时以实际可行为准**:测试里 `gitInit(thread.workdir)` + `writeFileSync` + `gitAddAll`。补 #approve/#reject 两个分支用例:

```ts
it('#approve 批准卡片并落地', async () => {
  const stores = createMemoryStores();
  const registry = createAgentRegistry([stubAgent('claude', 'x')]);
  const thread = await makeThread(stores);
  const card = await stores.approvals.create({
    threadId: thread.id, writerAgentId: 'claude', reviewerAgentId: 'opencode',
    diffText: 'd', diffStat: 's',
  });
  const final = await executeTurn({
    threadId: thread.id, content: `#approve ${card.id}`, context: { stores, registry },
  });
  expect(final.role).toBe('system');
  expect(final.content).toContain('✅ 已批准并落地');
  const updated = await stores.approvals.get(card.id);
  expect(updated?.status).toBe('applied');
});

it('#reject 打回卡片带理由', async () => {
  const stores = createMemoryStores();
  const registry = createAgentRegistry([stubAgent('claude', 'x')]);
  const thread = await makeThread(stores);
  const card = await stores.approvals.create({
    threadId: thread.id, writerAgentId: 'claude', reviewerAgentId: 'opencode',
    diffText: 'd', diffStat: 's',
  });
  const final = await executeTurn({
    threadId: thread.id, content: `#reject ${card.id} 边界没覆盖`, context: { stores, registry },
  });
  expect(final.content).toContain('⛔ 已打回');
  expect((await stores.approvals.get(card.id))?.status).toBe('rejected');
  expect((await stores.approvals.get(card.id))?.rejectReason).toBe('边界没覆盖');
});

it('无 diff 不创建卡片', async () => {
  const stores = createMemoryStores();
  const registry = createAgentRegistry([stubAgent('claude', '纯聊天')]);
  const thread = await makeThread(stores);
  await executeTurn({ threadId: thread.id, content: '聊聊', context: { stores, registry } });
  expect((await stores.approvals.list(thread.id)).length).toBe(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /Users/xuzishuo/code/meowbase && pnpm --filter @meowbase/api exec vitest run test/execute-turn.test.ts`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

`packages/api/src/router/execute-turn.ts`(关键增量):

```ts
import { gitAddAll, gitCommit, gitDiffHead } from '../services/git.js';
import { buildSystemPrompt, matchSkills, parseApproveCommand, parseConfirmCommand, parseEvidenceRefs, parseLearnCommand, parseRejectCommand, resolveTargetAgent, selectReviewer } from '@meowbase/shared';
import type { AgentId, ApprovalCard, EvidenceEntry, Message } from '@meowbase/shared';
import type { AgentRegistry } from '../providers/types.js';
import type { ApprovalStore, EvidenceStore, MessageStore, ProfileStore, SkillStore, ThreadStore } from '../stores/ports.js';

export interface TurnContext {
  stores: {
    threads: ThreadStore;
    messages: MessageStore;
    profiles: ProfileStore;
    evidence: EvidenceStore;
    skills: SkillStore;
    approvals: ApprovalStore;
  };
  registry: AgentRegistry;
  onIncrement?: (threadId: string, messageId: string, delta: string) => void;
}
```

`#approve` 分支(放在 #confirm 之后):

```ts
  const approve = parseApproveCommand(content);
  if (approve) {
    const card = await context.stores.approvals.approve(approve.id);
    if (card) {
      try {
        await gitCommit(thread.workdir, `approve ${card.id}`);
        await context.stores.approvals.markApplied(card.id);
      } catch {
        // git 提交失败不阻塞回执,卡片保持 approved
      }
    }
    const reply = card
      ? `✅ 已批准并落地:${card.id}`
      : `⚠️ 找不到可批准的卡片:${approve.id}`;
    return context.stores.messages.append({
      threadId, role: 'system', content: reply, status: 'completed',
    });
  }

  const reject = parseRejectCommand(content);
  if (reject) {
    const card = await context.stores.approvals.reject(reject.id, reject.reason);
    const reply = card
      ? `⛔ 已打回:${card.id} 理由:${reject.reason || '(未填)'}`
      : `⚠️ 找不到可打回的卡片:${reject.id}`;
    return context.stores.messages.append({
      threadId, role: 'system', content: reply, status: 'completed',
    });
  }
```

完成轮后(在 #learn 沉淀之前或之后均可,放 #learn 之后):

```ts
  // 审批流:有 diff → 卡片 + 自动审查
  if (output.status === 'completed') {
    try {
      await gitAddAll(thread.workdir);
      const diff = await gitDiffHead(thread.workdir);
      if (diff) {
        const reviewerAgentId = selectReviewer(targetAgentId, context.registry.list());
        const card = await context.stores.approvals.create({
          threadId,
          writerAgentId: targetAgentId,
          reviewerAgentId: reviewerAgentId ?? targetAgentId,
          diffText: diff.text,
          diffStat: diff.stat,
        });
        let reviewComment = '(无可用审查 agent)';
        if (reviewerAgentId && reviewerAgentId !== targetAgentId) {
          const reviewerService = context.registry.get(reviewerAgentId);
          if (reviewerService) {
            const reviewerProfile = await context.stores.profiles.get(reviewerAgentId);
            const reviewSkill = (await context.stores.skills.list()).find((s) => s.id === 'review');
            const reviewerPrompt = buildSystemPrompt({
              profile: reviewerProfile ?? undefined,
              skills: reviewSkill ? [reviewSkill] : [],
              evidenceRefs: [],
            });
            const reviewOutput = await reviewerService.runTurn({
              prompt: `请作为审查官审查以下代码改动,输出:问题列表→建议→结论(通过/需修改)\n\n${diff.stat}\n\n${diff.text}`,
              systemPrompt: reviewerPrompt,
              workdir: thread.workdir,
            });
            reviewComment = reviewOutput.content || '(审查无输出)';
          }
        }
        // 通过 patch 保存审查意见(ApprovalStore 无专用方法,用 approve/reject 之外的直接更新 —— 见下方补充方法 setReviewComment)
        await context.stores.approvals.setReviewComment(card.id, reviewComment);
        await context.stores.messages.append({
          threadId,
          role: 'system',
          content: `📋 审批卡片 ${card.id}(写:${card.writerAgentId} → 审:${reviewerAgentId})\n改动:${diff.stat}\n审查意见:${reviewComment}\n回复 #approve ${card.id} 批准 / #reject ${card.id} <理由> 打回`,
          status: 'completed',
        });
      }
    } catch {
      // diff 计算失败不阻塞主流程
    }
  }
```

`ApprovalStore` 补充方法(ports + 内存 + Redis):

```ts
setReviewComment(id: string, comment: string): Promise<ApprovalCard | null>; // draft/reviewing → reviewing + comment
```

`packages/api/src/http/server.ts`(线程创建时 gitInit):

```ts
import { gitInit } from '../services/git.js';
// POST /api/threads 里, mkdirSync 之后:
await gitInit(thread.workdir);
```

- [ ] **Step 4: 运行确认通过**

Run: 同上命令
Expected: 全部用例 PASS(含旧用例——注意旧用例的 workdir 现在需要 git init 吗?executeTurn 的 diff 计算有 try/catch,非 git 目录会静默跳过,旧用例不受影响)

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat(api): executeTurn 审批流(#approve/#reject/自动审查)"
```

---

### Task 6: 装配 + 冒烟扩展 + README + 验收

**Files:**
- Modify: `packages/api/src/index.ts`(OpenCodeAdapter 入 registry;approvals store)
- Modify: `scripts/smoke.ts`(stores 加 approvals;registry 加 OpenCodeAdapter(fake);消息改为写文件触发 diff)
- Modify: `README.md`
- Modify: `packages/api/test/http-integration.test.ts`(补一条完整链路:写→审→批)

**Interfaces:**
- 验收:`pnpm test` 全绿(≥82);fake 冒烟(双适配器)通过;合并 main

- [ ] **Step 1: 更新冒烟**

`scripts/smoke.ts`:
- stores 加 `approvals: createApprovalStore(redis)`
- registry:`createAgentRegistry([new ClaudeAdapter({bin: config.claudeBin, ...}), new OpenCodeAdapter({bin: config.opencodeBin, model: config.opencodeModel, timeoutMs: config.agentTimeoutMs})])`
- 冒烟消息改为 `@claude 创建一个名为 hello.txt 的文件,内容为 hello\n#learn 冒烟测试结论`(写手产生真实文件改动 → 触发 diff → 自动审查)
- 断言追加:`GET /api/approvals?threadId=` length ≥ 1,且审查意见非空(fake opencode 输出"审查通过")
- 需要 `GET /api/approvals` 路由 —— server.ts 追加:

```ts
app.get('/api/approvals', async (request) => {
  const { threadId } = request.query as { threadId?: string };
  return deps.stores.approvals.list(threadId);
});
```

- [ ] **Step 2: 全量验证**

Run:

```bash
cd /Users/xuzishuo/code/meowbase && pnpm test && pnpm -r build
CLAUDE_BIN="$PWD/packages/api/test/fixtures/fake-claude.mjs" \
OPENCODE_BIN="$PWD/packages/api/test/fixtures/fake-opencode.mjs" pnpm smoke
```

Expected: 全部用例 PASS;冒烟输出包含审批卡片与审查意见,`✅ 冒烟通过`。

- [ ] **Step 3: README**

```markdown
## 审批流(M4)

- 写手 agent 改动文件后,平台自动生成审批卡片并请另一 agent 审查
- `#approve ap_xxxxxxxx` —— 批准(改动提交为基线)
- `#reject ap_xxxxxxxx <理由>` —— 打回
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: M4 装配 + 双适配器冒烟 + README"
```

---

## M4 完成后的验证清单

```bash
cd /Users/xuzishuo/code/meowbase
pnpm test
pnpm -r build
CLAUDE_BIN=.../fake-claude.mjs OPENCODE_BIN=.../fake-opencode.mjs pnpm smoke
```

验收标准(来自 M4 spec §10):测试全绿且新增用例 ≥ 15;集成证明"写→审→批→applied"完整链路;双适配器冒烟通过。
