function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

export function clip(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(1, max - 1))}…`;
}

function fieldValue(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean' || typeof value === 'number') return `${key}=${value}`;
  const raw = key === 'thread' ? shortId(String(value)) : String(value);
  return /\s/.test(raw) ? `${key}=${JSON.stringify(raw)}` : `${key}=${raw}`;
}

export function formatTurnLog(event: string, fields?: Record<string, unknown>): string {
  const parts = Object.entries(fields ?? {})
    .map(([key, value]) => fieldValue(key, value))
    .filter((part): part is string => Boolean(part));
  return `[meow] ${event}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

export function turnLog(event: string, fields?: Record<string, unknown>): void {
  console.log(formatTurnLog(event, fields));
}
