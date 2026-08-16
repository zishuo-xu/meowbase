import type { ToolActivity, ToolActivityStatus } from '@meowbase/shared';

export type { ToolActivity, ToolActivityStatus };

const ARG_KEYS = ['file_path', 'path', 'command', 'pattern', 'url', 'query', 'prompt', 'target_file'] as const;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function primaryArg(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ARG_KEYS) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim()) return truncate(val.trim());
  }
  return undefined;
}

function fromStateStatus(raw: unknown): ToolActivityStatus {
  if (raw === 'error' || raw === 'failed') return 'error';
  if (raw === 'completed' || raw === 'success' || raw === 'done') return 'done';
  return 'running';
}

function fromToolPart(part: Record<string, unknown>): ToolActivity | null {
  if (part.type !== 'tool') return null;
  const id = str(part.id) ?? str(part.tool) ?? 'tool';
  const name = str(part.tool) ?? str(part.name) ?? 'tool';
  const state = (part.state as Record<string, unknown> | undefined) ?? {};
  const arg = primaryArg(state.input ?? part.input);
  return { id, name, ...(arg ? { arg } : {}), status: fromStateStatus(state.status) };
}

export function extractToolActivities(obj: Record<string, unknown>): ToolActivity[] {
  const type = str(obj.type) ?? '';

  if (type === 'tool_use' && !obj.message) {
    const id = str(obj.tool_id) ?? str(obj.id) ?? str(obj.tool_name) ?? 'tool';
    const name = str(obj.tool_name) ?? str(obj.name) ?? 'tool';
    const arg = primaryArg(obj.input ?? obj.args ?? obj);
    return [{ id, name, ...(arg ? { arg } : {}), status: 'running' }];
  }

  if (type === 'tool_result') {
    const id = str(obj.tool_id) ?? str(obj.tool_use_id) ?? str(obj.id);
    if (!id) return [];
    const name = str(obj.tool_name) ?? str(obj.name) ?? 'tool';
    const status: ToolActivityStatus =
      obj.status === 'error' || obj.is_error === true ? 'error' : 'done';
    return [{ id, name, status }];
  }

  const part = obj.part as Record<string, unknown> | undefined;
  if (part && typeof part === 'object') {
    const fromPart = fromToolPart(part);
    if (fromPart) return [fromPart];
  }

  if (type === 'assistant' || type === 'user') {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    const out: ToolActivity[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'tool_use') {
        const id = str(b.id) ?? 'tool';
        const name = str(b.name) ?? 'tool';
        const arg = primaryArg(b.input);
        out.push({ id, name, ...(arg ? { arg } : {}), status: 'running' });
      } else if (b.type === 'tool_result') {
        const id = str(b.tool_use_id) ?? str(b.id);
        if (!id) continue;
        const status: ToolActivityStatus = b.is_error === true ? 'error' : 'done';
        out.push({ id, name: str(b.name) ?? 'tool', status });
      }
    }
    return out;
  }

  return [];
}

export function upsertToolActivity(list: ToolActivity[], next: ToolActivity): ToolActivity[] {
  const idx = list.findIndex((a) => a.id === next.id);
  if (idx < 0) return [...list, next];
  const prev = list[idx];
  if (!prev) return [...list, next];
  const merged: ToolActivity = {
    id: prev.id,
    name: next.name && next.name !== 'tool' ? next.name : prev.name,
    arg: next.arg ?? prev.arg,
    status: next.status,
  };
  return list.map((item, i) => (i === idx ? merged : item));
}

export function drainActivities(pending: ToolActivity[]): ToolActivity[] {
  return pending.splice(0, pending.length);
}

export function emitParsedLine(
  input: {
    onIncrement?: (delta: string) => void;
    onActivity?: (activity: ToolActivity) => void;
  },
  delta: string | null,
  activities: ToolActivity[],
): void {
  if (delta) input.onIncrement?.(delta);
  for (const activity of activities) input.onActivity?.(activity);
}
