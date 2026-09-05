#!/usr/bin/env node
// 记分板「PR 合不进去了」配套写手:
// - 普通任务:写 hello.txt,不交棒
// - 叫醒那跳:任务里带「合不进去」,写 fix.txt,行首 @闪闪
import { appendFileSync, writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

const prompt = process.argv[process.argv.length - 1] ?? '';
const dump = process.env.FAKE_PROMPT_DUMP;
if (dump) {
  appendFileSync(dump, `\n--- invocation ---\n${prompt}\n`);
}

const isWake = prompt.includes('合不进去');
if (isWake) {
  writeFileSync('fix.txt', 'rebase: resolved\n');
} else {
  writeFileSync('hello.txt', 'hello from pr-conflict writer\n');
}
const text = isWake
  ? '已处理 PR 冲突:和基准分支对齐了,改动在 fix.txt。\n\n@闪闪 请审查 fix.txt'
  : '写好了 hello.txt,加法实现都在文件里,先说到这里。';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-pr-conflict"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-pr-conflict"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-pr-conflict","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
