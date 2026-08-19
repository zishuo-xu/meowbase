#!/usr/bin/env node
// 坏毛病:不改文件、不写结论就往下丢。平台现在没有机制拦它,记分板这一行如期是 0。
const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text = '先交给闪闪看一眼。\n\n@闪闪 请审查';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-empty"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-empty"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-empty","usage":{"input_tokens":12,"output_tokens":6,"total_tokens":18},"total_cost_usd":0.001}\n`,
);
