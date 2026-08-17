export interface ChildKillers {
  timedOut: () => boolean;
  aborted: () => boolean;
  clear: () => void;
}

/** 超时或人中止时杀掉子进程。 */
export function attachChildKillers(
  child: { kill: (signal?: NodeJS.Signals) => boolean },
  opts: { timeoutMs: number; signal?: AbortSignal },
): ChildKillers {
  let timedOut = false;
  let aborted = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, opts.timeoutMs);
  const onAbort = () => {
    aborted = true;
    child.kill('SIGTERM');
  };
  if (opts.signal?.aborted) onAbort();
  else opts.signal?.addEventListener('abort', onAbort, { once: true });
  return {
    timedOut: () => timedOut,
    aborted: () => aborted,
    clear: () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    },
  };
}
