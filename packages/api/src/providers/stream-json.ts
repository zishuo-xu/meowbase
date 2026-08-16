import type { MessageStatus, TokenUsage } from '@meowbase/shared';
import { drainActivities, extractToolActivities, type ToolActivity } from './tool-activity.js';

export interface StreamJsonEvent {
  type: string;
  subtype?: string;
  sessionId?: string;
  textDelta?: string;
  resultText?: string;
  usage?: TokenUsage;
  isError?: boolean;
  activities?: ToolActivity[];
}

interface RawBlock {
  type?: string;
  text?: unknown;
}

function extractTextDelta(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is RawBlock => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

function extractUsage(obj: Record<string, unknown>): TokenUsage | undefined {
  const usage = obj.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' ? v : undefined;
  return {
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    totalTokens: num(usage.total_tokens),
    cacheReadTokens: num(usage.cache_read_input_tokens),
    cacheCreationTokens: num(usage.cache_creation_input_tokens),
    costUsd: num(obj.total_cost_usd),
  };
}

export function parseStreamJsonLine(line: string): StreamJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const sessionId = typeof obj.session_id === 'string' ? obj.session_id : undefined;
  const activities = extractToolActivities(obj);

  if (obj.type === 'assistant') {
    return {
      type: 'assistant',
      sessionId,
      textDelta: extractTextDelta(obj.message),
      ...(activities.length > 0 ? { activities } : {}),
    };
  }
  if (obj.type === 'result') {
    return {
      type: 'result',
      subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
      sessionId,
      resultText: typeof obj.result === 'string' ? obj.result : undefined,
      usage: extractUsage(obj),
      isError: obj.is_error === true || obj.subtype === 'error_max_turns',
    };
  }
  return {
    type: typeof obj.type === 'string' ? obj.type : 'unknown',
    subtype: typeof obj.subtype === 'string' ? obj.subtype : undefined,
    sessionId,
    ...(activities.length > 0 ? { activities } : {}),
  };
}

export class StreamAccumulator {
  private parts: string[] = [];
  private pending: ToolActivity[] = [];
  private _sessionId?: string;
  private _usage?: TokenUsage;
  private _status: MessageStatus = 'completed';
  private _error?: string;

  /** 解析一行;若含增量文本则返回增量,否则返回 null */
  push(line: string): string | null {
    const event = parseStreamJsonLine(line);
    if (!event) return null;
    if (event.sessionId) this._sessionId = event.sessionId;
    if (event.activities?.length) this.pending.push(...event.activities);
    if (event.textDelta) this.parts.push(event.textDelta);
    if (event.type === 'result') {
      if (event.resultText) this.parts = [event.resultText];
      if (event.usage) this._usage = event.usage;
      if (event.isError) {
        this._status = 'failed';
        this._error = event.subtype ?? 'claude_cli_error';
      }
    }
    return event.textDelta ?? null;
  }

  takeActivities(): ToolActivity[] {
    return drainActivities(this.pending);
  }

  get content(): string {
    return this.parts.join('');
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get usage(): TokenUsage | undefined {
    return this._usage;
  }

  get status(): MessageStatus {
    return this._status;
  }

  get error(): string | undefined {
    return this._error;
  }
}
