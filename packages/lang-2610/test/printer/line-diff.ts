// Which lines two texts do not share: the lines of each that are outside their longest common subsequence of lines.
// Used to pin a known difference to the lines it changes (1-based line numbers).
export type LineDiff = { formatted: number[]; printed: number[] };

export function lineDiff(formatted: string, printed: string): LineDiff {
  const a = formatted.split("\n");
  const b = printed.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // lcs[i][j]: length of the common subsequence of x[i..] and y[j..]
  const lcs = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        x[i] === y[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (lcs[i + 1] as number[])[j] as number,
              (lcs[i] as number[])[j + 1] as number,
            );
  const result: LineDiff = { formatted: [], printed: [] };
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      i++;
      j++;
    } else if (
      j >= y.length ||
      (i < x.length &&
        ((lcs[i + 1] as number[])[j] as number) >=
          ((lcs[i] as number[])[j + 1] as number))
    ) {
      result.formatted.push(head + i + 1);
      i++;
    } else {
      result.printed.push(head + j + 1);
      j++;
    }
  }
  return result;
}
