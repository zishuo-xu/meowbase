#!/usr/bin/env node
// 团团 fake:在 cwd 落文件,再吐 opencode json。行首 @ 才交棒。
import { writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

writeFileSync('hello.txt', 'hello from writer\n');
const text =
  '已创建 hello.txt\n已运行 `node -e "console.log(1)"`，输出 1，行为正确。\n\n@闪闪 请审查 hello.txt';
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-web-tuan","part":{"type":"step-start"}}\n' +
    `{"type":"text","sessionID":"ses-web-tuan","part":{"type":"text","text":${JSON.stringify(text)}}}\n` +
    '{"type":"step_finish","sessionID":"ses-web-tuan","part":{"type":"step-finish","reason":"stop","tokens":{"total":30,"input":20,"output":10}},"cost":0.001}\n',
);
