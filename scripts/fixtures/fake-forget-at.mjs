#!/usr/bin/env node
// 坏毛病:写手改了文件,只在句中提下一只。补问后再给出行首 @。
// 正文必须落在 claude 的 result 里,否则 StreamAccumulator 会盖掉 assistant 增量。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const isNudge = process.argv.slice(2).join(' ').includes('【出口补问】');
const text = isNudge
  ? '补上出口。\n\n@闪闪 请审查 hello.txt'
  : '已创建 hello.txt，请 @闪闪 审查一下。';

if (!isNudge) {
  writeFileSync('hello.txt', 'hello from forgetful writer\n');
}

process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-forget"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-forget"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-forget","usage":{"input_tokens":20,"output_tokens":10,"total_tokens":30},"total_cost_usd":0.001}\n`,
);
