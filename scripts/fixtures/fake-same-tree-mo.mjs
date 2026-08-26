#!/usr/bin/env node
// eval 写手:在同一棵树上写 mo.txt 并 git add . 之后停一下再 commit。
// 停顿是给并行窗口:若另一只同时 add .,这一提交会把别人的文件卷走。
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// 绑仓自己提交后平台会补问(踩坑 29);第二次再 commit 会 nothing to commit
if (!existsSync('mo.txt')) {
  writeFileSync('mo.txt', 'mo\n');
  execFileSync('git', ['add', '.']);
  await new Promise((resolve) => setTimeout(resolve, 400));
  execFileSync('git', [
    '-c',
    'user.name=eval-mo',
    '-c',
    'user.email=eval-mo@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    '墨墨写了 mo',
  ]);
}

const text = '已创建 mo.txt 并自己提交。';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-same-tree-mo"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-same-tree-mo"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-same-tree-mo","usage":{"input_tokens":12,"output_tokens":6,"total_tokens":18},"total_cost_usd":0.001}\n`,
);
