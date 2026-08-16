#!/usr/bin/env node
const lines = [
  '{"type":"init","timestamp":"2025-10-10T12:00:00.000Z","session_id":"sess-gemini","model":"gemini-2.0-flash"}',
  '{"type":"message","role":"user","content":"你好","timestamp":"2025-10-10T12:00:01.000Z"}',
  '{"type":"message","role":"assistant","content":"你好!","delta":true,"timestamp":"2025-10-10T12:00:02.000Z"}',
  '{"type":"message","role":"assistant","content":" 我是 gemini。","delta":true,"timestamp":"2025-10-10T12:00:03.000Z"}',
  '{"type":"result","status":"success","stats":{"total_tokens":13,"input_tokens":10,"output_tokens":3,"cached":2,"duration_ms":1200,"tool_calls":0},"timestamp":"2025-10-10T12:00:04.000Z"}',
];
process.stdout.write(lines.join('\n') + '\n');
