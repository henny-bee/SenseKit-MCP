// qText alone against a numeric field silently selects nothing (or widens).
export function buildSelectValues(values: Array<string | number>) {
  return values.map((v) => {
    const n = typeof v === "number" ? v : Number(v);
    const isNum = typeof v === "number" || (String(v).trim() !== "" && Number.isFinite(n));
    return isNum
      ? { qText: String(v), qIsNumeric: true, qNumber: n }
      : { qText: String(v), qIsNumeric: false };
  });
}
