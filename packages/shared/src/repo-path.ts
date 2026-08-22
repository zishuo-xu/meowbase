import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

export type RepoPathDecision =
  | { ok: true }
  | { ok: false; selectedPath: string; allowedRoots: string[] };

/** 能 realpath 就 realpath;路径还不存在时沿父目录往上找已存在的那截再拼回去。 */
export function canonicalizePath(input: string): string {
  const abs = resolve(input);
  try {
    return realpathSync(abs);
  } catch {
    const parts: string[] = [];
    let current = abs;
    while (true) {
      const parent = dirname(current);
      if (parent === current) return abs;
      parts.unshift(basename(current));
      try {
        return join(realpathSync(parent), ...parts);
      } catch {
        current = parent;
      }
    }
  }
}

function isUnderRoot(realPath: string, realRoot: string): boolean {
  if (realPath === realRoot) return true;
  const prefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  return realPath.startsWith(prefix);
}

/**
 * 人填的路径是否落在允许的根下面。
 * `selectedPath` 原样回传,不改成 realpath。
 */
export function isRepoPathAllowed(
  selectedPath: string,
  allowedRoots: readonly string[],
): RepoPathDecision {
  if (selectedPath.trim() === '') {
    return { ok: false, selectedPath, allowedRoots: [...allowedRoots] };
  }
  const realSelected = canonicalizePath(selectedPath);
  for (const root of allowedRoots) {
    if (isUnderRoot(realSelected, canonicalizePath(root))) return { ok: true };
  }
  return { ok: false, selectedPath, allowedRoots: [...allowedRoots] };
}

/** 默认根必须取 realpath。macOS 上 `os.tmpdir()` 是 `/var/folders/...`,realpath 到 `/private/var/folders/...`。 */
export function defaultAllowedRepoRoots(): string[] {
  const home = canonicalizePath(homedir());
  const tmp = canonicalizePath(tmpdir());
  return home === tmp ? [home] : [home, tmp];
}

/** 未配 / 空串 → null(调用方走默认)。配了按 `,` 或 `:` 拆,是覆盖不是追加。 */
export function parseAllowedRepoRoots(raw: unknown): string[] | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed
    .split(/[,:]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export function resolveAllowedRepoRoots(configured?: readonly string[] | null): string[] {
  if (configured && configured.length > 0) {
    return configured.map((root) => canonicalizePath(root));
  }
  return defaultAllowedRepoRoots();
}
