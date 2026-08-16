import type { AgentId } from '@meowbase/shared';
import type { AgentSpec } from '../config.js';
import { ClaudeAdapter } from './claude.js';
import { GeminiAdapter } from './gemini.js';
import { OpenCodeAdapter } from './opencode.js';
import type { AgentService } from './types.js';

export type CliKind = 'claude' | 'gemini' | 'opencode';

/** 按 bin 选 CLI 适配器,这样多只猫可以共用同一条 CLI / 同一个模型 */
export function cliKindFromBin(bin: string, fallback: AgentId): CliKind {
  const base = (bin.split(/[\\/]/).pop() ?? bin).toLowerCase();
  if (base.includes('opencode')) return 'opencode';
  if (base.includes('gemini')) return 'gemini';
  if (base.includes('claude')) return 'claude';
  return fallback;
}

export function createAdapter(spec: AgentSpec, timeoutMs: number): AgentService {
  const kind = cliKindFromBin(spec.bin, spec.id);
  const shared = { agentId: spec.id, bin: spec.bin, model: spec.model, timeoutMs };
  if (kind === 'gemini') return new GeminiAdapter(shared);
  if (kind === 'opencode') return new OpenCodeAdapter(shared);
  return new ClaudeAdapter(shared);
}
