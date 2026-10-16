/** Escape a literal value for use inside a QRS filter string ('...'). */
export function qrsQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
