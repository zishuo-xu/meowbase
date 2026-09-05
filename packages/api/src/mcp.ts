import { createInterface } from 'node:readline';
import { callCollabTool } from './mcp/client.js';
import { handleMcpRequest } from './mcp/protocol.js';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const response = await handleMcpRequest(line, (name, args) => callCollabTool(name, args));
  if (!response || response.id == null) return;
  process.stdout.write(`${JSON.stringify(response)}\n`);
});
