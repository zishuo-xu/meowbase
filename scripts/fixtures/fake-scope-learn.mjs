#!/usr/bin/env node
// 记分板「别的项目的记忆被灌进来」配套:产出可 #learn 的正文,并把系统提示词落到 FAKE_PROMPT_DUMP。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const dump = process.env.FAKE_PROMPT_DUMP;
if (dump) {
  const idx = process.argv.indexOf('--append-system-prompt');
  writeFileSync(dump, idx >= 0 ? String(process.argv[idx + 1] ?? '') : '');
}

const text = '仓A独有约定:只用斑马纹协议 UNIQUE_SCOPE_A_ONLY';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-scope-learn"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-scope-learn"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-scope-learn","usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20},"total_cost_usd":0.001}\n`,
);
