#!/usr/bin/env node
// 坏毛病:行首等跑 node -e。命令里没有 shell 元字符,所以元字符那道关放它过去,
// 必须由白名单那道关拦住 —— 这一行专门量白名单,别和 fake-hold-deny 那行混。
const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const text = '先自检。\n等跑 node -e "1+1"';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-hold-node"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-hold-node"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-hold-node","usage":{"input_tokens":12,"output_tokens":6,"total_tokens":18},"total_cost_usd":0.001}\n`,
);
