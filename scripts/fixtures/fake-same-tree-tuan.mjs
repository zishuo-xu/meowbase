#!/usr/bin/env node
// eval 团团:在同一棵树上写 tuan.txt 并 git add . 立刻 commit(opencode 协议)。
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const delayMs = Number(process.env.FAKE_WRITER_DELAY_MS ?? process.env.FAKE_DELAY_MS ?? 0);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

// 绑仓自己提交后平台会补问(踩坑 29);第二次再 commit 会 nothing to commit
if (!existsSync('tuan.txt')) {
  writeFileSync('tuan.txt', 'tuan\n');
  execFileSync('git', ['add', '.']);
  execFileSync('git', [
    '-c',
    'user.name=eval-tuan',
    '-c',
    'user.email=eval-tuan@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    '团团写了 tuan',
  ]);
}

const text = '已创建 tuan.txt 并自己提交。';
process.stdout.write(
  '{"type":"step_start","sessionID":"ses-same-tree-tuan","part":{"type":"step-start"}}\n' +
    `{"type":"text","sessionID":"ses-same-tree-tuan","part":{"type":"text","text":${JSON.stringify(text)}}}\n` +
    '{"type":"step_finish","sessionID":"ses-same-tree-tuan","part":{"type":"step-finish","reason":"stop","tokens":{"total":16,"input":10,"output":6}},"cost":0.00001}\n',
);
