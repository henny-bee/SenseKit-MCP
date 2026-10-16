/** Last n lines of a (possibly huge) log. Returns the tail plus how many
 *  lines were dropped, so a truncated log can't masquerade as complete. */
export function tailText(text: string, n: number): { lines: string[]; dropped: number; totalLines: number } {
  const all = text.split(/\r?\n/);
  // A trailing newline yields one empty final element — not a log line.
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const lines = all.slice(Math.max(0, all.length - n));
  return { lines, dropped: all.length - lines.length, totalLines: all.length };
}
