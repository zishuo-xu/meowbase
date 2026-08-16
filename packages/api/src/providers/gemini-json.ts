import type { MessageStatus, TokenUsage } from '@meowbase/shared';
import { drainActivities, extractToolActivities, type ToolActivity } from './tool-activity.js';

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export class GeminiAccumulator {
  private parts: string[] = [];
  private pending: ToolActivity[] = [];
  private _sessionId?: string;
  private _usage?: TokenUsage;
  private _status: MessageStatus = 'completed';
  private _error?: string;

  push(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }

    if (typeof obj.session_id === 'string') this._sessionId = obj.session_id;
    this.pending.push(...extractToolActivities(obj));

    if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
      if (obj.delta === true) {
        this.parts.push(obj.content);
        return obj.content;
      }
      if (this.parts.length === 0) {
        this.parts.push(obj.content);
        return obj.content;
      }
      return null;
    }

    if (obj.type === 'result') {
      if (obj.status === 'error') {
        this._status = 'failed';
        const err = obj.error as Record<string, unknown> | undefined;
        this._error =
          err && typeof err.message === 'string' ? err.message : 'gemini_cli_error';
      }
      const stats = obj.stats as Record<string, unknown> | undefined;
      if (stats) {
        this._usage = {
          inputTokens: num(stats.input_tokens),
          outputTokens: num(stats.output_tokens),
          totalTokens: num(stats.total_tokens),
          cacheReadTokens: num(stats.cached),
        };
      }
    }

    return null;
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
