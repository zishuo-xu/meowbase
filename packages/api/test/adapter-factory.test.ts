import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENTS } from '../src/config.js';
import { cliKindFromBin, createAdapter } from '../src/providers/factory.js';

describe('createAdapter', () => {
  it('bin 决定 CLI,agentId 仍是猫的身份', () => {
    expect(cliKindFromBin('opencode', 'claude')).toBe('opencode');
    expect(cliKindFromBin('/opt/gemini', 'claude')).toBe('gemini');
    const spec = { ...DEFAULT_AGENTS[0]!, bin: 'opencode', model: 'opencode-go/flash' };
    const adapter = createAdapter(spec, 1000);
    expect(adapter.agentId).toBe('claude');
  });
});
