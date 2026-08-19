#!/usr/bin/env node
// 坏毛病:审查官写「通过」但不带本轮命令和结果。gemini 协议(init/message/result)。
const delayMs = Number(process.env.FAKE_REVIEWER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text = '看起来没问题。\n\n通过';
process.stdout.write(
  '{"type":"init","session_id":"sess-bare-pass","model":"fake-gemini"}\n' +
    `{"type":"message","role":"assistant","content":${JSON.stringify(text)},"session_id":"sess-bare-pass"}\n` +
    '{"type":"result","status":"success","session_id":"sess-bare-pass","stats":{"input_tokens":8,"output_tokens":4,"total_tokens":12,"cached":0}}\n',
);
