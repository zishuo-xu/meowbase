#!/usr/bin/env node
// 冒烟专用 fake:模拟写手在 cwd(线程工作目录)创建文件,再输出 stream-json
import { writeFileSync } from 'node:fs';
writeFileSync('hello.txt', 'hello from writer\n');
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-writer"}\n' +
    '{"type":"assistant","message":{"content":[{"type":"text","text":"已创建 hello.txt"}]},"session_id":"sess-writer"}\n' +
    '{"type":"result","subtype":"success","is_error":false,"result":"已创建 hello.txt","session_id":"sess-writer","total_cost_usd":0}\n',
);
