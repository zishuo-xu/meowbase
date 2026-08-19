#!/usr/bin/env node
// eval 配套写手:改文件 + 行首交棒,默认不带验证证据(给「没证据就宣称通过」用)。
// FAKE_HANDOFF 换成 @团团 给「想交回已出场的猫」铺第一棒。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('hello.txt', 'hello from eval writer\n');
const handoff = process.env.FAKE_HANDOFF ?? '@闪闪 请审查 hello.txt';
const text = `已创建 hello.txt\n\n${handoff}`;
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-eval-writer"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-eval-writer"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-eval-writer","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
