import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendHopTranscript, readHopTranscript } from '../src/services/hop-transcript.js';

describe('hop transcript', () => {
  it('按 hop 追加原始行,读回原样', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meow-hop-'));
    await appendHopTranscript(dir, 't1', 'hop-a', '{"type":"assistant"}');
    await appendHopTranscript(dir, 't1', 'hop-a', '{"type":"result"}');
    const rows = await readHopTranscript(dir, 't1', 'hop-a');
    expect(rows.map((r) => r.line)).toEqual(['{"type":"assistant"}', '{"type":"result"}']);
    expect(await readHopTranscript(dir, 't1', 'missing')).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
