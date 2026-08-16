import { describe, expect, it } from 'vitest';
import { clip, formatTurnLog } from '../src/services/turn-log.js';

describe('turn-log', () => {
  it('拼一行可检索的管线日志', () => {
    expect(
      formatTurnLog('turn start', {
        thread: '20f7707a-b7d9-4ee1-913b-41cb44cdd147',
        targets: 'claude',
        preview: '@墨墨 写快排',
      }),
    ).toBe('[meow] turn start thread=20f7707a targets=claude preview="@墨墨 写快排"');
  });

  it('clip 压成单行并截断', () => {
    expect(clip('a\nb  c', 8)).toBe('a b c');
    expect(clip('abcdefghij', 8)).toBe('abcdefg…');
  });
});
