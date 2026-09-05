import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function hopTranscriptPath(dir: string, threadId: string, hopId: string): string {
  return join(dir, threadId, `${hopId}.jsonl`);
}

export async function appendHopTranscript(
  dir: string,
  threadId: string,
  hopId: string,
  line: string,
): Promise<void> {
  const path = hopTranscriptPath(dir, threadId, hopId);
  await mkdir(dirname(path), { recursive: true });
  const row = `${JSON.stringify({ ts: new Date().toISOString(), line })}\n`;
  try {
    await appendFile(path, row, 'utf8');
  } catch {
    await writeFile(path, row, 'utf8');
  }
}

export async function readHopTranscript(
  dir: string,
  threadId: string,
  hopId: string,
): Promise<Array<{ ts: string; line: string }>> {
  try {
    const text = await readFile(hopTranscriptPath(dir, threadId, hopId), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((row) => JSON.parse(row) as { ts: string; line: string });
  } catch {
    return [];
  }
}
