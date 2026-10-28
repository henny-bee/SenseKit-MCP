export function tailText(text: string, n: number): { lines: string[]; dropped: number; totalLines: number } {
  const all = text.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const lines = all.slice(Math.max(0, all.length - n));
  return { lines, dropped: all.length - lines.length, totalLines: all.length };
}
