import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultAllowedRepoRoots,
  isRepoPathAllowed,
  parseAllowedRepoRoots,
  resolveAllowedRepoRoots,
} from '../src/repo-path.js';

const cleanups: string[] = [];

afterEach(() => {
  for (const dir of cleanups.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

describe('isRepoPathAllowed', () => {
  it('根本身放行', () => {
    const root = scratch('meow-root-self-');
    expect(isRepoPathAllowed(root, [root])).toEqual({ ok: true });
  });

  it('根下面的路径放行', () => {
    const root = scratch('meow-root-child-');
    const child = join(root, 'code', 'app');
    mkdirSync(child, { recursive: true });
    expect(isRepoPathAllowed(child, [root])).toEqual({ ok: true });
  });

  it('.. 绕回根内放行', () => {
    const root = scratch('meow-root-dotdot-in-');
    mkdirSync(join(root, 'code'), { recursive: true });
    const wrapped = join(root, 'code', '..', 'inside');
    mkdirSync(join(root, 'inside'));
    expect(isRepoPathAllowed(wrapped, [root])).toEqual({ ok: true });
  });

  it('根外拒,selectedPath 是人填的原话', () => {
    const root = scratch('meow-root-deny-');
    const outside = scratch('meow-outside-');
    const typed = `${outside}${sep}..${sep}${outside.split(sep).pop()}`;
    const denied = isRepoPathAllowed(typed, [root]);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.selectedPath).toBe(typed);
      expect(denied.selectedPath).not.toBe(realpathSync(outside));
      expect(denied.allowedRoots).toEqual([root]);
    }
  });

  it('symlink 从根内指到根外拒', () => {
    const root = scratch('meow-root-link-');
    const outside = scratch('meow-link-target-');
    writeFileSync(join(outside, 'secret.txt'), 'nope\n');
    const link = join(root, 'escape');
    symlinkSync(outside, link);
    const denied = isRepoPathAllowed(link, [root]);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.selectedPath).toBe(link);
  });

  it('空路径拒,selectedPath 仍是原话', () => {
    const root = scratch('meow-root-empty-');
    expect(isRepoPathAllowed('', [root])).toEqual({
      ok: false,
      selectedPath: '',
      allowedRoots: [root],
    });
    expect(isRepoPathAllowed('   ', [root])).toEqual({
      ok: false,
      selectedPath: '   ',
      allowedRoots: [root],
    });
  });

  it('不存在但 resolve 后落在根内 → 放行(存在性留给 API 400)', () => {
    const root = scratch('meow-root-missing-in-');
    const missing = join(root, 'no-such-repo');
    expect(isRepoPathAllowed(missing, [root])).toEqual({ ok: true });
  });

  it('不存在且落在根外 → 拒', () => {
    const root = scratch('meow-root-missing-out-');
    const missing = join(root, '..', `no-such-${Date.now()}`);
    const denied = isRepoPathAllowed(missing, [root]);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.selectedPath).toBe(missing);
  });

  it('邻接名不放行(/root 不放行 /root-other)', () => {
    const root = scratch('meow-root-prefix-');
    const neighbor = `${root}-other`;
    mkdirSync(neighbor, { recursive: true });
    cleanups.push(neighbor);
    expect(isRepoPathAllowed(neighbor, [root]).ok).toBe(false);
  });
});

describe('defaultAllowedRepoRoots / resolveAllowedRepoRoots', () => {
  it('默认根是 realpath 之后的家目录和临时目录', () => {
    const roots = defaultAllowedRepoRoots();
    expect(roots).toContain(realpathSync(homedir()));
    expect(roots).toContain(realpathSync(tmpdir()));
  });

  it('tmpdir 下的路径(eval 临时仓那种)能过默认根', () => {
    const dir = scratch('meowbase-eval-repo-');
    expect(isRepoPathAllowed(dir, defaultAllowedRepoRoots())).toEqual({ ok: true });
    // 人填的是 os.tmpdir() 字面,realpath 到 /private/var/folders/... 也能过
    expect(isRepoPathAllowed(resolve(dir), defaultAllowedRepoRoots())).toEqual({ ok: true });
  });

  it('配了自定义根就是覆盖,家目录不再放行', () => {
    const custom = scratch('meow-custom-root-');
    const roots = resolveAllowedRepoRoots([custom]);
    expect(roots).toEqual([realpathSync(custom)]);
    expect(isRepoPathAllowed(homedir(), roots).ok).toBe(false);
    expect(isRepoPathAllowed(join(homedir(), 'code'), roots).ok).toBe(false);
    expect(isRepoPathAllowed(custom, roots)).toEqual({ ok: true });
  });

  it('parseAllowedRepoRoots: 未配是 null(走默认);配了按分隔符拆', () => {
    expect(parseAllowedRepoRoots(undefined)).toBeNull();
    expect(parseAllowedRepoRoots('')).toBeNull();
    expect(parseAllowedRepoRoots('  ')).toBeNull();
    const a = scratch('meow-parse-a-');
    const b = scratch('meow-parse-b-');
    expect(parseAllowedRepoRoots(`${a}:${b}`)).toEqual([a, b]);
    expect(parseAllowedRepoRoots(`${a},${b}`)).toEqual([a, b]);
  });
});
