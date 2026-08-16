#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(
  process.env.RECORD_ARGS_FILE ?? '/tmp/gemini-args.txt',
  JSON.stringify(process.argv.slice(2)),
);
process.stdout.write(
  '{"type":"init","session_id":"sess-args","model":"gemini-2.0-flash"}\n' +
    '{"type":"message","role":"assistant","content":"ok","delta":true}\n' +
    '{"type":"result","status":"success","stats":{"total_tokens":3,"input_tokens":1,"output_tokens":2,"cached":0,"duration_ms":10,"tool_calls":0}}\n',
);
