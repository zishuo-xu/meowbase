#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(
  process.env.RECORD_ARGS_FILE ?? '/tmp/claude-args.txt',
  JSON.stringify(process.argv.slice(2)),
);
process.stdout.write(
  '{"type":"system","subtype":"init","session_id":"sess-args"}\n' +
    '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]},"session_id":"sess-args"}\n' +
    '{"type":"result","subtype":"success","is_error":false,"result":"ok","session_id":"sess-args","total_cost_usd":0}\n',
);
