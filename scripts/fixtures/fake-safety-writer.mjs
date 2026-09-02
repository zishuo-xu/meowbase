#!/usr/bin/env node
// eval 写手:改一个安全面路径的文件(packages/shared/src/hold-command.ts)并提交。
// 用来验「按风险面选审查官」:安全面改动应落到声明了 safety 的审查官,不是 handoffTo 默认那只。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

if (!existsSync('packages/shared/src/hold-command.ts')) {
  mkdirSync('packages/shared/src', { recursive: true });
  writeFileSync('packages/shared/src/hold-command.ts', 'export {}\n');
  execFileSync('git', ['add', '.']);
  execFileSync('git', [
    '-c',
    'user.name=eval-safety',
    '-c',
    'user.email=eval-safety@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    '改白名单',
  ]);
}

const text = '已改 packages/shared/src/hold-command.ts 并自己提交。';
process.stdout.write(
  '{"type":"system","subtype":"init","cwd":"/tmp","session_id":"sess-safety-writer"}\n' +
    `{"type":"assistant","message":{"content":[{"type":"text","text":${JSON.stringify(text)}}]},"session_id":"sess-safety-writer"}\n` +
    `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)},"session_id":"sess-safety-writer","usage":{"input_tokens":12,"output_tokens":6,"total_tokens":18},"total_cost_usd":0.001}\n`,
);
