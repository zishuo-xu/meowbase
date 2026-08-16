import { access, constants } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import type { AgentSpec, ModelProtocol } from '../config.js';
import { cliKindFromBin, createAdapter } from './factory.js';

const execFileAsync = promisify(execFile);
const PROBE_PROMPT = '只回复 pong,不要改任何文件';
const DEFAULT_TIMEOUT_MS = 45_000;

export interface VerifyModelInput {
  bin: string;
  model?: string;
  protocol?: ModelProtocol;
  baseUrl?: string;
  timeoutMs?: number;
  workdir?: string;
}

export interface VerifyModelResult {
  ok: boolean;
  stage: 'bin' | 'model';
  latencyMs: number;
  error?: string;
  preview?: string;
}

export async function resolveExecutable(bin: string): Promise<string | null> {
  const trimmed = bin.trim();
  if (!trimmed) return null;
  if (isAbsolute(trimmed) || trimmed.startsWith('.') || trimmed.includes('/')) {
    try {
      await access(trimmed, constants.X_OK);
      return trimmed;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync('which', [trimmed]);
    const found = stdout.trim();
    return found || null;
  } catch {
    return null;
  }
}

function probeSpec(input: VerifyModelInput, resolvedBin: string): AgentSpec {
  const id = cliKindFromBin(resolvedBin, 'opencode');
  return {
    id,
    name: id,
    aliases: [id],
    role: 'probe',
    personality: '',
    expertise: [],
    bin: resolvedBin,
    ...(input.model?.trim() ? { model: input.model.trim() } : {}),
    ...(input.protocol ? { protocol: input.protocol } : {}),
    ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
  };
}

export async function verifyModelConnection(input: VerifyModelInput): Promise<VerifyModelResult> {
  const started = Date.now();
  const bin = input.bin.trim();
  if (!bin) {
    return { ok: false, stage: 'bin', latencyMs: 0, error: 'CLI 不能为空' };
  }
  const resolved = await resolveExecutable(bin);
  if (!resolved) {
    return {
      ok: false,
      stage: 'bin',
      latencyMs: Date.now() - started,
      error: `找不到 CLI: ${bin}`,
    };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const adapter = createAdapter(probeSpec(input, resolved), timeoutMs);
  const output = await adapter.runTurn({
    prompt: PROBE_PROMPT,
    workdir: input.workdir ?? tmpdir(),
    timeoutMs,
  });
  const latencyMs = Date.now() - started;
  const preview = output.content.trim().slice(0, 240);
  if (output.status !== 'completed') {
    return {
      ok: false,
      stage: 'model',
      latencyMs,
      error: output.error ?? `探测失败(${output.status})`,
      preview: preview || undefined,
    };
  }
  if (!preview) {
    return {
      ok: false,
      stage: 'model',
      latencyMs,
      error: 'CLI 在,但模型没有返回内容(请检查模型 ID 与登录)',
    };
  }
  return { ok: true, stage: 'model', latencyMs, preview };
}
