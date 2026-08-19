#!/usr/bin/env node
// 写手 fake:在 cwd 落文件,再吐 claude stream-json。行首 @ 才交棒。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('hello.txt', 'hello from writer\n');
const text =
  '已创建 hello.txt\n已运行 `node -e "console.log(1)"`，输出 1，行为正确。\n\n@闪闪 请审查 hello.txt';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-writer"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-writer"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-writer","usage":{"input_tokens":20,"output_tokens":10,"total_tokens":30},"total_cost_usd":0.001}\n`,
);
