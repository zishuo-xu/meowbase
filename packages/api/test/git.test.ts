import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  gitAddAll,
  gitCommit,
  gitDiffHead,
  gitInit,
  parseStrayFiles,
  sweepStrayFiles,
} from '../src/services/git.js';

describe('git 辅助函数', () => {
  it('init 空基线;新增文件后 diff 非空;commit 后 diff 为空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meowbase-git-'));
    await gitInit(dir);
    expect(await gitDiffHead(dir)).toBeNull();

    writeFileSync(join(dir, 'a.txt'), 'hello');
    await gitAddAll(dir);
    const diff = await gitDiffHead(dir);
    expect(diff).not.toBeNull();
    expect(diff?.stat).toContain('a.txt');
    expect(diff?.text).toContain('+hello');

    await gitCommit(dir, 'baseline');
    expect(await gitDiffHead(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('parseStrayFiles 只取未跟踪且不在 work/ 下的文件', () => {
    const status = [
      '?? packages/api/mul.js',
      '?? work/abc/x.txt',
      ' M packages/api/edited.js',
      '?? 另一个.txt',
      '',
    ].join('\n');
    expect(parseStrayFiles(status)).toEqual(['packages/api/mul.js', '另一个.txt']);
  });

  it('parseStrayFiles 不碰源码树里的未跟踪文件', () => {
    const status = [
      '?? packages/api/src/providers/gemini.ts',
      '?? packages/api/test/gemini-json.test.ts',
      '?? packages/api/test/fixtures/fake-gemini.mjs',
      '?? docs/notes.md',
      '?? mul.js',
      '?? packages/api/mul.js',
    ].join('\n');
    expect(parseStrayFiles(status)).toEqual(['mul.js', 'packages/api/mul.js']);
  });

  it('sweepStrayFiles 把散落文件移回沙箱', async () => {
    const root = mkdtempSync(join(tmpdir(), 'meowbase-sweep-'));
    await gitInit(root);
    const workdir = join(root, 'work', 't1');
    mkdirSync(workdir, { recursive: true });
    await gitInit(workdir);

    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    writeFileSync(join(root, 'packages', 'api', 'stray.js'), 'x');
    const moved = await sweepStrayFiles(root, workdir);
    expect(moved).toContain('packages/api/stray.js');
    expect(existsSync(join(workdir, 'stray.js'))).toBe(true);
    expect(existsSync(join(root, 'packages', 'api', 'stray.js'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});
