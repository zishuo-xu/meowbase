import type { MessageStatus, TokenUsage } from '@meowbase/shared';
import { drainActivities, extractToolActivities, type ToolActivity } from './tool-activity.js';

export class OpenCodeAccumulator {
  private parts: string[] = [];
  private thinkingParts: string[] = [];
  private thinkingEmitted = 0;
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
    if (typeof obj.sessionID === 'string') this._sessionId = obj.sessionID;
    this.pending.push(...extractToolActivities(obj));

    const part = obj.part as Record<string, unknown> | undefined;
    if (
      (obj.type === 'reasoning' || part?.type === 'reasoning') &&
      typeof part?.text === 'string' &&
      part.text.length > 0
    ) {
      this.thinkingParts.push(part.text);
      return null;
    }
    if (obj.type === 'text' && part?.type === 'text' && typeof part.text === 'string') {
      this.parts.push(part.text);
      return part.text;
    }
    if (obj.type === 'step_finish') {
      const reason = typeof part?.reason === 'string' ? part.reason : '';
      const tokens = part?.tokens as Record<string, unknown> | undefined;
      if (reason === 'stop') {
        // 最终 step 正常结束
        if (tokens) {
          const num = (v: unknown): number | undefined =>
            typeof v === 'number' ? v : undefined;
          const cache = tokens.cache as Record<string, unknown> | undefined;
          this._usage = {
            inputTokens: num(tokens.input),
            outputTokens: num(tokens.output),
            totalTokens: num(tokens.total),
            cacheReadTokens: cache ? num(cache.read) : undefined,
            costUsd: typeof obj.cost === 'number' ? obj.cost : undefined,
            costEstimated: typeof obj.cost === 'number',
          };
        }
        this._status = 'completed';
        this._error = undefined;
      } else if (reason === 'error' || reason === 'max_turns' || reason === 'cancel') {
        // 确定性的失败原因;'tool-calls' 等中间 step 结束不算失败
        this._status = 'failed';
        this._error = reason;
      }
    }
    return null;
  }

  takeActivities(): ToolActivity[] {
    return drainActivities(this.pending);
  }

  takeThinking(): string | null {
    const full = this.thinkingParts.join('');
    const extra = full.slice(this.thinkingEmitted);
    this.thinkingEmitted = full.length;
    return extra.length > 0 ? extra : null;
  }

  get thinking(): string {
    return this.thinkingParts.join('');
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
