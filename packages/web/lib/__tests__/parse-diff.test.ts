import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../parse-diff';

const SAMPLE = `diff --git a/quicksort.ts b/quicksort.ts
index 0000000..1111111
--- a/quicksort.ts
+++ b/quicksort.ts
@@ -0,0 +1,3 @@
+export function qs(xs: number[]): number[] {
+  return xs;
+}
diff --git a/quicksort.test.ts b/quicksort.test.ts
--- a/quicksort.test.ts
+++ b/quicksort.test.ts
@@ -1,2 +1,3 @@
 import { qs } from './quicksort';
-expect(qs([])).toEqual([]);
+expect(qs([2, 1])).toEqual([1, 2]);
`;

describe('parseUnifiedDiff', () => {
  it('按文件拆 hunk,保留加减行', () => {
    const files = parseUnifiedDiff(SAMPLE);
    expect(files.map((f) => f.path)).toEqual(['quicksort.ts', 'quicksort.test.ts']);
    expect(files[0]?.hunks[0]?.lines.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual([
      'export function qs(xs: number[]): number[] {',
      '  return xs;',
      '}',
    ]);
    const second = files[1]?.hunks[0]?.lines ?? [];
    expect(second.some((l) => l.kind === 'del' && l.text.includes('qs([])'))).toBe(true);
    expect(second.some((l) => l.kind === 'add' && l.text.includes('qs([2, 1])'))).toBe(true);
  });

  it('空文本返回空列表', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   ')).toEqual([]);
  });

  it('无法识别时整段当作一个文件', () => {
    const files = parseUnifiedDiff('just some notes\n+maybe');
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('改动');
    expect(files[0]?.hunks[0]?.lines.some((l) => l.text.includes('just some notes'))).toBe(true);
  });
});
