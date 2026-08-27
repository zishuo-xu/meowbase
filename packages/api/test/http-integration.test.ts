import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as factory from '../src/providers/factory.js';
import { createMemoryStores } from '../src/stores/factories.js';
import { ensureSeededProfiles } from '../src/stores/seeds.js';
import { createAgentRegistry } from '../src/providers/registry.js';
import type { AgentService } from '../src/providers/types.js';
import { buildServer } from '../src/http/server.js';
import { DEFAULT_AGENTS } from '../src/config.js';

const exec = promisify(execFile);

async function initScratchRepo(dir: string): Promise<void> {
  await exec('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'tester'], { cwd: dir });
  await exec('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  await exec('git', ['add', '-A'], { cwd: dir });
  await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
}

const workdirBase = mkdtempSync(join(tmpdir(), 'meowbase-test-'));
const FAKE_CLAUDE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs');

const hangGemini: AgentService = {
  agentId: 'gemini',
  async runTurn(input) {
    await new Promise<void>((resolve) => {
      if (input.signal?.aborted) {
        resolve();
        return;
      }
      input.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    return {
      sessionId: 'sess-hang',
      content: '',
      status: 'terminated',
      error: '已中止',
    };
  },
};

const fakeClaude: AgentService = {
  agentId: 'claude',
  async runTurn(input) {
    const parts = ['你好', ',我是', ' claude。'];
    for (const part of parts) {
      input.onIncrement?.(part);
    }
    input.onActivity?.({ id: 't-http', name: 'Write', arg: 'hello.js', status: 'done' });
    return {
      sessionId: 'sess-http',
      content: parts.join(''),
      status: 'completed',
      usage: { inputTokens: 3, outputTokens: 5 },
    };
  },
};

let baseUrl = '';
let server: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  const stores = createMemoryStores([
    { id: 'tdd', name: '测试驱动开发', description: 'd', triggers: ['tdd'], prompt: '红绿重构' },
  ]);
  await ensureSeededProfiles(stores.profiles);
  server = await buildServer({
    stores,
    registry: createAgentRegistry([fakeClaude, hangGemini]),
    workdirBase,
    agents: DEFAULT_AGENTS,
    defaultAgentId: 'claude',
    a2aMaxDepth: 3,
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(workdirBase, { recursive: true, force: true });
});

describe('HTTP 集成', () => {
  it('创建线程 → 发消息 → 拿到完成结果', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '集成测试', primaryAgentId: 'claude' }),
    });
    expect(createRes.status).toBe(201);
    const thread = (await createRes.json()) as { id: string };

    const msgRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@claude 写个 hello' }),
    });
    expect(msgRes.status).toBe(200);
    const message = (await msgRes.json()) as { content: string; status: string; usage?: { inputTokens?: number } };
    expect(message.content).toBe('你好,我是 claude。');
    expect(message.status).toBe('completed');
    expect(message.usage?.inputTokens).toBe(3);

    const listRes = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`);
    const messages = (await listRes.json()) as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('POST /api/threads/:id/cancel 中止进行中的一轮', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '中止', primaryAgentId: 'claude' }),
    });
    const thread = (await createRes.json()) as { id: string };
    const idle = await fetch(`${baseUrl}/api/threads/${thread.id}/cancel`, { method: 'POST' });
    expect(idle.status).toBe(409);

    const pending = fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '@gemini 挂住' }),
    });
    let cancelled = false;
    for (let i = 0; i < 30; i++) {
      const cancel = await fetch(`${baseUrl}/api/threads/${thread.id}/cancel`, { method: 'POST' });
      if (cancel.status === 200) {
        cancelled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(cancelled).toBe(true);
    const message = (await (await pending).json()) as { status: string; error?: string };
    expect(message.status).toBe('terminated');
    expect(message.error).toBe('已中止');
  });

  it('DELETE /api/threads/:id 删线程', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '待删', primaryAgentId: 'claude' }),
    });
    const thread = (await createRes.json()) as { id: string };
    const del = await fetch(`${baseUrl}/api/threads/${thread.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const list = (await (await fetch(`${baseUrl}/api/threads`)).json()) as { id: string }[];
    expect(list.some((t) => t.id === thread.id)).toBe(false);
    const missing = await fetch(`${baseUrl}/api/threads/no-such-thread`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });

  it('POST /api/threads 带合法 repoPath 返回绑定;非法路径 400 且不建线程', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-http-repo-'));
    await initScratchRepo(repo);

    const ok = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '绑仓成功', primaryAgentId: 'claude', repoPath: repo }),
    });
    expect(ok.status).toBe(201);
    const thread = (await ok.json()) as {
      id: string;
      workdir: string;
      repo?: { path: string; baseBranch: string; branch: string };
    };
    expect(thread.repo?.path).toBe(repo);
    expect(thread.repo?.baseBranch).toBe('main');
    expect(thread.repo?.branch).toBe(`meow/${thread.id}`);
    expect(
      (thread.repo as { allowRemote?: boolean } | undefined)?.allowRemote,
    ).toBeUndefined();

    const remoteOk = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '开远程',
        primaryAgentId: 'claude',
        repoPath: repo,
        allowRemote: true,
      }),
    });
    expect(remoteOk.status).toBe(201);
    const remoteThread = (await remoteOk.json()) as {
      id: string;
      repo?: { allowRemote?: boolean };
    };
    expect(remoteThread.repo?.allowRemote).toBe(true);
    await fetch(`${baseUrl}/api/threads/${remoteThread.id}`, { method: 'DELETE' });
    const listed = await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain']);
    expect(listed.stdout).toContain(thread.id);

    const missingPathTitle = `坏路径-${Date.now()}`;
    const missingPath = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: missingPathTitle, repoPath: join(repo, 'no-such-dir') }),
    });
    expect(missingPath.status).toBe(400);
    expect(((await missingPath.json()) as { error: string }).error).toMatch(/不存在/);

    const notRepo = mkdtempSync(join(tmpdir(), 'meowbase-http-norepo-'));
    const notRepoTitle = `非仓库-${Date.now()}`;
    const notGit = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: notRepoTitle, repoPath: notRepo }),
    });
    expect(notGit.status).toBe(400);
    expect(((await notGit.json()) as { error: string }).error).toMatch(/不是 git 仓库/);

    const missingBranchTitle = `缺分支-${Date.now()}`;
    const missingBranch = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: missingBranchTitle,
        repoPath: repo,
        baseBranch: 'no-such-branch',
      }),
    });
    expect(missingBranch.status).toBe(400);
    expect(((await missingBranch.json()) as { error: string }).error).toMatch(/分支不存在/);

    const list = (await (await fetch(`${baseUrl}/api/threads`)).json()) as { title: string }[];
    expect(list.some((t) => t.title === missingPathTitle)).toBe(false);
    expect(list.some((t) => t.title === notRepoTitle)).toBe(false);
    expect(list.some((t) => t.title === missingBranchTitle)).toBe(false);

    await fetch(`${baseUrl}/api/threads/${thread.id}`, { method: 'DELETE' });
    rmSync(notRepo, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('DELETE 绑仓线程时卸 worktree 并保留 meow/<id> 分支', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'meowbase-http-del-'));
    await initScratchRepo(repo);
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '待卸 worktree', repoPath: repo }),
    });
    const thread = (await createRes.json()) as {
      id: string;
      workdir: string;
      repo?: { branch: string };
    };
    expect(createRes.status).toBe(201);
    const before = await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain']);
    expect(before.stdout).toContain(thread.id);

    const del = await fetch(`${baseUrl}/api/threads/${thread.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const after = await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain']);
    expect(after.stdout).not.toContain(thread.id);
    expect(existsSync(thread.workdir)).toBe(false);
    const branches = await exec('git', ['-C', repo, 'branch', '--list', `meow/${thread.id}`]);
    expect(branches.stdout).toContain(`meow/${thread.id}`);
    rmSync(repo, { recursive: true, force: true });
  });

  it('空 content 返回 400', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't' }),
    });
    const thread = (await createRes.json()) as { id: string };
    const res = await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('WebSocket 收到流式增量', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ws' }),
    });
    const thread = (await createRes.json()) as { id: string };

    const ws = new WebSocket(`ws://127.0.0.1:${new URL(baseUrl).port}/api/ws?threadId=${thread.id}`);
    const received: string[] = [];
    ws.onmessage = (event) => {
      received.push((event.data as string).toString());
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    const events = received.map((raw) => JSON.parse(raw) as { type: string; delta?: string });
    expect(events.some((e) => e.type === 'start')).toBe(true);
    expect(events.filter((e) => e.type === 'increment').map((e) => e.delta).join('')).toBe(
      '你好,我是 claude。',
    );
  });

  it('WebSocket 收到工具过程', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ws-cli' }),
    });
    const thread = (await createRes.json()) as { id: string };

    const ws = new WebSocket(`ws://127.0.0.1:${new URL(baseUrl).port}/api/ws?threadId=${thread.id}`);
    const received: Array<{ type: string; activity?: { name: string; arg?: string } }> = [];
    ws.onmessage = (event) => {
      received.push(JSON.parse((event.data as string).toString()) as (typeof received)[number]);
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    const activities = received.filter((e) => e.type === 'activity');
    expect(activities.map((e) => e.activity?.name)).toContain('Write');
  });

  it('GET /api/config 返回 A2A 链深与角色别名', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as {
      a2aMaxDepth: number;
      defaultAgentId: string;
      agents: { id: string; name: string; aliases: string[]; model?: string }[];
    };
    expect(cfg.a2aMaxDepth).toBe(3);
    expect(cfg.defaultAgentId).toBe('claude');
    expect(cfg.agents.map((a) => a.name)).toEqual(['墨墨', '闪闪', '团团']);
    expect(cfg.agents[0]?.aliases).toContain('墨墨');
    expect(cfg.agents[0]?.aliases).toContain('claude');
    expect(cfg.agents[2]?.model).toBe('opencode-go/deepseek-v4-flash');
  });

  it('POST /api/config/models/verify 探测 CLI', async () => {
    const missing = await fetch(`${baseUrl}/api/config/models/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: 'meowbase-no-such-cli-xyz', model: 'x' }),
    });
    expect(missing.status).toBe(200);
    const bad = (await missing.json()) as { ok: boolean; stage: string };
    expect(bad.ok).toBe(false);
    expect(bad.stage).toBe('bin');

    const okRes = await fetch(`${baseUrl}/api/config/models/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: FAKE_CLAUDE, model: 'sonnet' }),
    });
    expect(okRes.status).toBe(200);
    const good = (await okRes.json()) as { ok: boolean; preview?: string; usage?: { costUsd?: number } };
    expect(good.ok).toBe(true);
    expect(good.preview).toContain('claude');
    expect(good.usage?.costUsd).toBe(0.0012);
  });

  it('POST /api/config/models/verify 模型名为空则 400 且适配器零调用', async () => {
    const spy = vi.spyOn(factory, 'createAdapter');
    const empty = await fetch(`${baseUrl}/api/config/models/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: 'opencode', model: '' }),
    });
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { error: string; field?: string };
    expect(body.field).toBe('model');
    expect(body.error).toMatch(/model/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('GET /api/profiles 与 /api/evidence', async () => {
    const createRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'm2' }),
    });
    const thread = (await createRes.json()) as { id: string };

    // 通过消息协议创建 draft
    await fetch(`${baseUrl}/api/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '#learn 集成测试结论' }),
    });

    const profilesRes = await fetch(`${baseUrl}/api/profiles`);
    const profiles = (await profilesRes.json()) as { name: string }[];
    expect(profiles.map((p) => p.name)).toEqual(['墨墨', '闪闪', '团团']);

    const evidenceRes = await fetch(`${baseUrl}/api/evidence?threadId=${thread.id}`);
    const evidence = (await evidenceRes.json()) as { status: string; title: string }[];
    expect(evidence.length).toBe(1);
    expect(evidence[0]?.status).toBe('draft');
  });

  it('GET /api/skills 返回技能清单', async () => {
    const res = await fetch(`${baseUrl}/api/skills`);
    const skills = (await res.json()) as { id: string; name: string }[];
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.map((s) => s.id)).toContain('tdd');
  });

  it('PATCH /api/profiles/:agentId 更新 autoApprove', async () => {
    const res = await fetch(`${baseUrl}/api/profiles/claude`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApprove: true }),
    });
    expect(res.status).toBe(200);
    const profile = (await res.json()) as { autoApprove: boolean };
    expect(profile.autoApprove).toBe(true);

    const bad = await fetch(`${baseUrl}/api/profiles/claude`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApprove: 'yes' }),
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${baseUrl}/api/profiles/nonexistent`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ autoApprove: true }),
    });
    expect(missing.status).toBe(404);
  });
});

describe('HTTP 团队配置 PATCH', () => {
  const workdir = mkdtempSync(join(tmpdir(), 'meowbase-cfg-http-'));
  const configPath = join(workdir, 'meowbase.config.json');
  let url = '';
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    const stores = createMemoryStores();
    await ensureSeededProfiles(stores.profiles);
    app = await buildServer({
      stores,
      registry: createAgentRegistry([fakeClaude]),
      workdirBase: workdir,
      agents: DEFAULT_AGENTS.map((a) => ({
        ...a,
        aliases: [...a.aliases],
        expertise: [...a.expertise],
      })),
      defaultAgentId: 'claude',
      a2aMaxDepth: 3,
      configPath,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('PATCH agent 更新名册并落盘', async () => {
    const res = await fetch(`${url}/api/config/agents/claude`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '墨墨酱',
        aliases: ['墨墨酱', 'claude'],
        role: '架构猫',
        personality: '更沉稳',
        expertise: ['架构'],
        model: 'opus-test',
        autoApprove: true,
      }),
    });
    expect(res.status).toBe(200);
    const agent = (await res.json()) as {
      name: string;
      role: string;
      model?: string;
      autoApprove?: boolean;
      personality: string;
    };
    expect(agent.name).toBe('墨墨酱');
    expect(agent.role).toBe('架构猫');
    expect(agent.model).toBe('opus-test');
    expect(agent.autoApprove).toBe(true);
    expect(agent.personality).toBe('更沉稳');

    const cfgRes = await fetch(`${url}/api/config`);
    const cfg = (await cfgRes.json()) as { agents: { id: string; name: string }[] };
    expect(cfg.agents.find((a) => a.id === 'claude')?.name).toBe('墨墨酱');

    expect(existsSync(configPath)).toBe(true);
    const file = JSON.parse(readFileSync(configPath, 'utf8')) as {
      agents: { id: string; name: string }[];
    };
    expect(file.agents.find((a) => a.id === 'claude')?.name).toBe('墨墨酱');
  });

  it('PATCH /api/config 更新链深与默认猫', async () => {
    const res = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a2aMaxDepth: 5, defaultAgentId: 'gemini' }),
    });
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as { a2aMaxDepth: number; defaultAgentId: string };
    expect(cfg.a2aMaxDepth).toBe(5);
    expect(cfg.defaultAgentId).toBe('gemini');
  });

  it('PATCH /api/config applyModel 把同一模型配给多只猫', async () => {
    const res = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        applyModel: {
          model: 'opencode-go/shared-flash',
          agentIds: ['claude', 'opencode'],
          bin: 'opencode',
        },
      }),
    });
    expect(res.status).toBe(200);
    const cfg = (await res.json()) as {
      agents: { id: string; model?: string; bin: string }[];
    };
    const claude = cfg.agents.find((a) => a.id === 'claude');
    const gemini = cfg.agents.find((a) => a.id === 'gemini');
    const opencode = cfg.agents.find((a) => a.id === 'opencode');
    expect(claude?.model).toBe('opencode-go/shared-flash');
    expect(claude?.bin).toBe('opencode');
    expect(opencode?.model).toBe('opencode-go/shared-flash');
    expect(gemini?.bin).toBe('gemini');
  });

  it('PATCH /api/config models 后 agent 可选用目录', async () => {
    const save = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        models: [
          { id: 'flash', label: 'Flash', bin: 'opencode', model: 'opencode-go/shared-flash' },
          { id: 'sonnet', label: 'Sonnet', bin: 'claude', model: 'sonnet' },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const pick = await fetch(`${url}/api/config/agents/gemini`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'sonnet' }),
    });
    expect(pick.status).toBe(200);
    const agent = (await pick.json()) as { modelId?: string; bin: string; model?: string };
    expect(agent.modelId).toBe('sonnet');
    expect(agent.bin).toBe('claude');
    expect(agent.model).toBe('sonnet');
  });

  it('PATCH 多 CLI 模型时保留猫当前 CLI', async () => {
    const save = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        models: [
          {
            id: 'flash',
            label: 'Flash',
            bins: ['opencode', 'gemini'],
            model: 'opencode-go/shared-flash',
          },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const reset = await fetch(`${url}/api/config/agents/gemini`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bin: 'gemini', modelId: '' }),
    });
    expect(reset.status).toBe(200);
    const pick = await fetch(`${url}/api/config/agents/gemini`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'flash' }),
    });
    expect(pick.status).toBe(200);
    const agent = (await pick.json()) as { modelId?: string; bin: string; model?: string };
    expect(agent.modelId).toBe('flash');
    expect(agent.bin).toBe('gemini');
    expect(agent.model).toBe('opencode-go/shared-flash');
  });

  it('PATCH models 按协议丢掉不兼容 CLI', async () => {
    const save = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        models: [
          {
            id: 'gpt',
            label: 'GPT',
            bins: ['opencode', 'claude'],
            protocol: 'openai',
            model: 'gpt-4.1',
          },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const cfg = (await save.json()) as {
      models: { id: string; protocol?: string; bins: string[] }[];
    };
    const gpt = cfg.models.find((m) => m.id === 'gpt');
    expect(gpt?.protocol).toBe('openai');
    expect(gpt?.bins).toEqual(['opencode']);
  });

  it('未知 agent / 空名字 / 非法链深返回 4xx', async () => {
    const missing = await fetch(`${url}/api/config/agents/nope`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(missing.status).toBe(404);

    const empty = await fetch(`${url}/api/config/agents/claude`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(empty.status).toBe(400);

    const badDepth = await fetch(`${url}/api/config`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a2aMaxDepth: 0 }),
    });
    expect(badDepth.status).toBe(400);
  });
});
