/** Classify a lineage entry by its discriminator/statement. */
export function classifyLineage(discriminator: string | undefined, statement: string | undefined): string {
  const s = (discriminator ?? "").toUpperCase();
  const st = (statement ?? "").toUpperCase();
  if (st.startsWith("STORE")) return "store";
  if (s.startsWith("INLINE")) return "inline";
  if (s.startsWith("RESIDENT")) return "resident";
  if (s.includes(".QVD")) return "qvd";
  if (s.startsWith("BINARY")) return "binary";
  if (s.includes("PROVIDER=") || s.includes("ODBC") || s.includes("OLEDB") || s.includes("CUSTOM CONNECT")) return "database";
  return "other";
}
