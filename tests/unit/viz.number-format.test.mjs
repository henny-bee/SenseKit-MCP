import { test } from "node:test";
import assert from "node:assert/strict";
import { numFormatToEngine, numberFormatFromEngine } from "../../dist/viz/number-format.js";

test("numFormatToEngine maps each type to the engine qNumFormat", () => {
  assert.equal(numFormatToEngine({ type: "auto" }), undefined);
  const num = numFormatToEngine({ type: "number" });
  assert.deepEqual(num, {
    qNumFormat: { qType: "F", qFmt: "#,##0.00", qnDec: 2, qUseThou: 1, qDec: ".", qThou: "," },
    numFormatFromTemplate: false,
  });
  assert.equal(numFormatToEngine({ type: "number", decimals: 0 }).qNumFormat.qFmt, "#,##0");
  assert.deepEqual(numFormatToEngine({ type: "integer" }).qNumFormat, { qType: "I", qFmt: "#,##0", qnDec: 0, qUseThou: 1, qDec: ".", qThou: "," });
  const pct = numFormatToEngine({ type: "percent", decimals: 2 }).qNumFormat;
  assert.deepEqual([pct.qType, pct.qFmt, pct.qnDec, pct.qUseThou], ["F", "0.00%", 2, 0]);
  const money = numFormatToEngine({ type: "money", pattern: "€ #,##0" }).qNumFormat;
  assert.deepEqual([money.qType, money.qFmt], ["M", "€ #,##0"]);
  const date = numFormatToEngine({ type: "date", pattern: "MMM D, YYYY" }).qNumFormat;
  assert.deepEqual([date.qType, date.qFmt, date.qUseThou], ["D", "MMM D, YYYY", 0]); // a comma in a DATE is not a thousands separator
  const custom = numFormatToEngine({ type: "custom", pattern: "#,##0.0 'kg'" });
  assert.equal(custom.isCustomFormatted, true);
  assert.deepEqual([custom.qNumFormat.qType, custom.qNumFormat.qnDec], ["R", 1]);
  assert.throws(() => numFormatToEngine({ type: "bogus" }), /unknown numberFormat.type/);
});

test("numberFormatFromEngine inverts numFormatToEngine (update carries formats over)", () => {
  for (const nf of [
    { type: "number", decimals: 3 }, { type: "integer" }, { type: "percent" },
    { type: "money" }, { type: "date" }, { type: "custom", pattern: "0.0 'x'" },
  ]) {
    const eng = numFormatToEngine(nf);
    assert.deepEqual(numFormatToEngine(numberFormatFromEngine(eng)), eng, `round trip ${nf.type}`);
  }
  // The template-driven default "U" means no format.
  assert.equal(numberFormatFromEngine({ qNumFormat: { qType: "U" }, numFormatFromTemplate: true }), undefined);
  assert.equal(numberFormatFromEngine(undefined), undefined);
});
