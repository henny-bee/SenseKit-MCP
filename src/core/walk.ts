/** Walk any JSON value; call visit(path, string) on every string leaf. */
export function walkStrings(v: unknown, path: string, visit: (path: string, s: string) => void): void {
  if (typeof v === "string") {
    visit(path, v);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, visit));
  } else if (v !== null && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      walkStrings(val, path ? `${path}.${k}` : k, visit);
    }
  }
}
