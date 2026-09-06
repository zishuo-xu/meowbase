#!/usr/bin/env node
// 坏毛病:等跑后面跟中文说明。没有元字符,必须由白名单多余参数那道关拦住。
const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text = '先自检。\n等跑 npm test 平台替跑确认 12/12 全绿';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-hold-tail"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-hold-tail"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-hold-tail","usage":{"input_tokens":12,"output_tokens":6,"total_tokens":18},"total_cost_usd":0.001}\n`,
);
