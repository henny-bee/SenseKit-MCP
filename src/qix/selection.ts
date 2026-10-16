/** Build engine field-value duals for SelectValues. Numeric values (and
 *  numeric-looking strings) get qIsNumeric + qNumber — a text-only qText
 *  against a numeric field silently selects nothing or widens. */
export function buildSelectValues(values: Array<string | number>) {
  return values.map((v) => {
    const n = typeof v === "number" ? v : Number(v);
    const isNum = typeof v === "number" || (String(v).trim() !== "" && Number.isFinite(n));
    return isNum
      ? { qText: String(v), qIsNumeric: true, qNumber: n }
      : { qText: String(v), qIsNumeric: false };
  });
}
