#!/usr/bin/env node
// 记分板「PR 上来了人写的 review」配套写手:
// - 普通任务和出口补问:写 hello.txt,不交棒(链停在自己这轮,平台才轮得到叫醒)
// - 叫醒那跳:任务里带评论正文「除零要炸」,写 fix.txt,行首 @闪闪 收尾
// 正文必须落在 result 里(踩坑 18);nudge 识别照 fake-forget-at 读 argv。
// FAKE_PROMPT_DUMP 有值时把每跳 prompt 追加落盘,供记分板核对叫醒那跳的输入带评论正文。
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

const isWake = prompt.includes('除零要炸');
if (isWake) {
  writeFileSync('fix.txt', 'divide: guard zero\n');
} else {
  writeFileSync('hello.txt', 'hello from pr-review writer\n');
}
const text = isWake
  ? '已处理 PR 评论:补上除零保护,改动在 fix.txt。\n\n@闪闪 请审查 fix.txt'
  : '写好了 hello.txt,加法实现都在文件里,先说到这里。';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-pr-review"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-pr-review"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-pr-review","usage":{"input_tokens":16,"output_tokens":8,"total_tokens":24},"total_cost_usd":0.001}\n`,
);
