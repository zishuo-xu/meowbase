import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentSpec,
  applyAgentPatch,
  applySharedModel,
  cloneAgentSpec,
  DEFAULT_AGENTS,
  loadConfig,
  writeTeamFile,
} from '../src/config.js';

describe('loadConfig a2aMaxDepth', () => {
  it('默认 3', () => {
    expect(loadConfig({}).a2aMaxDepth).toBe(3);
  });

  it('读取 A2A_MAX_DEPTH', () => {
    expect(loadConfig({ A2A_MAX_DEPTH: '5' }).a2aMaxDepth).toBe(5);
  });

  it('非法或过小回退默认,过大封顶 10', () => {
    expect(loadConfig({ A2A_MAX_DEPTH: '0' }).a2aMaxDepth).toBe(3);
    expect(loadConfig({ A2A_MAX_DEPTH: 'nope' }).a2aMaxDepth).toBe(3);
    expect(loadConfig({ A2A_MAX_DEPTH: '99' }).a2aMaxDepth).toBe(10);
  });
});

describe('loadConfig 团队名册', () => {
  it('默认三只猫与模型', () => {
    const cfg = loadConfig({});
    expect(cfg.agents.map((a) => a.id)).toEqual(['claude', 'gemini', 'opencode']);
    expect(agentSpec(cfg, 'claude').name).toBe('墨墨');
    expect(agentSpec(cfg, 'opencode').model).toBe('opencode-go/deepseek-v4-flash');
    expect(cfg.defaultAgentId).toBe('claude');
    expect(cfg.models.some((m) => m.id === 'flash')).toBe(true);
    expect(agentSpec(cfg, 'opencode').modelId).toBe('flash');
  });

  it('文件覆盖模型与别名,env 再覆盖 bin/model', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-cfg-'));
    const path = join(dir, 'meowbase.config.json');
    writeFileSync(
      path,
      JSON.stringify({
        a2a: { maxDepth: 4 },
        defaultAgentId: 'gemini',
        agents: [
          { id: 'gemini', model: 'gemini-file', aliases: ['闪闪', 'gemini', '闪'] },
          { id: 'opencode', model: 'file-model' },
        ],
      }),
    );
    const cfg = loadConfig({ GEMINI_MODEL: 'gemini-env', OPENCODE_BIN: '/opt/opencode' }, { configPath: path });
    expect(cfg.a2aMaxDepth).toBe(4);
    expect(cfg.defaultAgentId).toBe('gemini');
    expect(agentSpec(cfg, 'gemini').model).toBe('gemini-env');
    expect(agentSpec(cfg, 'gemini').aliases).toContain('闪');
    expect(agentSpec(cfg, 'opencode').model).toBe('file-model');
    expect(agentSpec(cfg, 'opencode').bin).toBe('/opt/opencode');
  });
});

describe('applyAgentPatch / writeTeamFile', () => {
  it('更新名字别名模型,空 model 清除', () => {
    const patched = applyAgentPatch(DEFAULT_AGENTS[0]!, {
      name: ' 墨墨酱 ',
      aliases: ['@墨墨酱', 'claude'],
      model: 'claude-opus',
      role: '架构',
    });
    expect(patched.name).toBe('墨墨酱');
    expect(patched.aliases).toEqual(['墨墨酱', 'claude']);
    expect(patched.model).toBe('claude-opus');
    expect(patched.role).toBe('架构');
    expect(applyAgentPatch(patched, { model: '' }).model).toBeUndefined();
  });

  it('落盘后 loadConfig 能读回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-cfg-write-'));
    const path = join(dir, 'meowbase.config.json');
    const agents = DEFAULT_AGENTS.map((a) =>
      a.id === 'claude' ? applyAgentPatch(a, { name: '墨墨酱', aliases: ['墨墨酱', 'claude'] }) : { ...a, aliases: [...a.aliases], expertise: [...a.expertise] },
    );
    writeTeamFile(path, { a2aMaxDepth: 5, defaultAgentId: 'gemini', agents });
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { a2a: { maxDepth: number }; defaultAgentId: string };
    expect(raw.a2a.maxDepth).toBe(5);
    expect(raw.defaultAgentId).toBe('gemini');
    const cfg = loadConfig({}, { configPath: path });
    expect(cfg.a2aMaxDepth).toBe(5);
    expect(cfg.defaultAgentId).toBe('gemini');
    expect(agentSpec(cfg, 'claude').name).toBe('墨墨酱');
  });
});

describe('模型目录', () => {
  it('文件里的 models 可被 agent.modelId 选用', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-models-'));
    const path = join(dir, 'meowbase.config.json');
    writeFileSync(
      path,
      JSON.stringify({
        models: [
          { id: 'flash', label: 'Flash', bin: 'opencode', model: 'opencode-go/deepseek-v4-flash' },
          { id: 'sonnet', label: 'Sonnet', bin: 'claude', model: 'sonnet' },
        ],
        agents: [{ id: 'claude', modelId: 'flash' }],
      }),
    );
    const cfg = loadConfig({}, { configPath: path });
    expect(agentSpec(cfg, 'claude').bin).toBe('opencode');
    expect(agentSpec(cfg, 'claude').model).toBe('opencode-go/deepseek-v4-flash');
    expect(agentSpec(cfg, 'claude').modelId).toBe('flash');
    expect(cfg.models.map((m) => m.id)).toEqual(['flash', 'sonnet']);
    expect(cfg.models[0]?.bins).toEqual(['opencode']);
    expect(cfg.models[0]?.protocol).toBe('openai');
    expect(cfg.models[1]?.protocol).toBe('anthropic');
  });

  it('同一模型可挂多个 CLI,选用时保留猫自己的 CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-multibin-'));
    const path = join(dir, 'meowbase.config.json');
    writeFileSync(
      path,
      JSON.stringify({
        models: [
          {
            id: 'flash',
            label: 'Flash',
            bins: ['opencode', 'claude'],
            model: 'opencode-go/deepseek-v4-flash',
          },
        ],
        agents: [{ id: 'claude', modelId: 'flash' }],
      }),
    );
    const cfg = loadConfig({}, { configPath: path });
    expect(agentSpec(cfg, 'claude').bin).toBe('claude');
    expect(agentSpec(cfg, 'claude').model).toBe('opencode-go/deepseek-v4-flash');
    expect(agentSpec(cfg, 'claude').modelId).toBe('flash');
    expect(cfg.models[0]?.bins).toEqual(['opencode', 'claude']);
    expect(cfg.models[0]?.bin).toBe('opencode');
    expect(cfg.models[0]?.protocol).toBe('anthropic');
  });

  it('显式 openai 协议会丢掉不兼容的 claude CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-protocol-'));
    const path = join(dir, 'meowbase.config.json');
    writeFileSync(
      path,
      JSON.stringify({
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
    );
    const cfg = loadConfig({}, { configPath: path });
    expect(cfg.models[0]?.protocol).toBe('openai');
    expect(cfg.models[0]?.bins).toEqual(['opencode']);
  });

  it('接受 anthropic-messages 别名', () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-proto-alias-'));
    const path = join(dir, 'meowbase.config.json');
    writeFileSync(
      path,
      JSON.stringify({
        models: [{ id: 'sonnet', label: 'Sonnet', bin: 'claude', protocol: 'anthropic-messages', model: 'sonnet' }],
      }),
    );
    const cfg = loadConfig({}, { configPath: path });
    expect(cfg.models[0]?.protocol).toBe('anthropic');
    expect(cfg.models[0]?.bins).toEqual(['claude']);
  });
});

describe('applySharedModel', () => {
  it('把同一模型写到多只猫,可选统一 CLI', () => {
    const agents = DEFAULT_AGENTS.map((a) => cloneAgentSpec(a));
    const next = applySharedModel(agents, {
      model: 'opencode-go/deepseek-v4-flash',
      agentIds: ['claude', 'opencode'],
      bin: 'opencode',
    });
    expect(next.find((a) => a.id === 'claude')?.model).toBe('opencode-go/deepseek-v4-flash');
    expect(next.find((a) => a.id === 'claude')?.bin).toBe('opencode');
    expect(next.find((a) => a.id === 'opencode')?.bin).toBe('opencode');
    expect(next.find((a) => a.id === 'gemini')?.bin).toBe('gemini');
    expect(next.find((a) => a.id === 'gemini')?.model).toBeUndefined();
  });
});
