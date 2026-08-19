#!/usr/bin/env node
// 坏毛病:行首 @ 回本链已经出场的写手。团团走 opencode 协议(text / step_finish)。
const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text = '我看完了,请墨墨再改一版。\n\n@墨墨 请再改一版';
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-revisit","part":{"type":"step-start"}}\n' +
    `{"type":"text","sessionID":"ses-revisit","part":{"type":"text","text":${JSON.stringify(text)}}}\n` +
    '{"type":"step_finish","sessionID":"ses-revisit","part":{"type":"step-finish","reason":"stop","tokens":{"total":18,"input":10,"output":8}},"cost":0.00001}\n',
);
