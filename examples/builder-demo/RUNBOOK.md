# Builder demo: an agent builds a sheet — and knows whether it will render

> ⚠ **Runs against a live Qlik site.** `trace.mjs` works only in its own app, **MCP Builder Demo** (it deletes any earlier copy, rebuilds it and leaves it on the site for inspection), but it still needs `QSEOW_ALLOW_MUTATIONS=true`. Point it at a sandbox or the demo box, **never production.**

**In one sentence:** an agent turns "give me a regional sales sheet"
into four working visualizations, refuses the requests that would produce
broken objects, and verifies that what it built will actually draw — because
Qlik's engine happily saves definitions the client renders blank.

**Why the gate matters.** Anything can POST a chart definition
to Qlik. The engine will accept a misspelled measure and render `0`, accept a
treemap with the wrong cube mode and render an error box, accept an object
placed off the sheet grid and render nothing at all — silently, every time.
This server refuses what it can refuse, and checks what it builds.

**Runtime:** ~30 seconds of tool calls. Budget 5 minutes with narration.

## Pre-flight

- `QSEOW_ALLOW_MUTATIONS=true` (the demo creates and deletes an app).
- Nothing else — `trace.mjs` creates its own app and data.

```bash
cd examples/builder-demo && node trace.mjs
```

Every line it prints is an assertion. It exits non-zero if any claim fails, so
a green run is proof, not decoration.

## The five beats

1. **Build from the brief.** `create_app` → `create_sheet` → four
   `add_sheet_object` calls (KPI, bar, line, table). Each response carries the
   gate verdict; all four come back `pass`.

2. **Refusals that happen *before* anything is written.** A misspelled
   dimension (`Regoin`) and an impossible shape (pie chart with two
   dimensions) are both rejected pre-create. Nothing lands in the app.

3. **The nastier case: a misspelled *measure*.** Qlik accepts `Sum(Salse)` and
   renders **0** with no error — a wrong number that looks like an answer. The
   object is created, and the gate marks it `fail` with the unknown field
   named. This is the beat worth pausing on.

4. **Whole-sheet verdict.** `validate_sheet` returns `FAIL` while the bad
   object exists, then `PASS` on a clean rebuild with zero placement findings.

5. **The numbers carry their own context.** `evaluate_expression` returns the
   value *plus* the active selections it was computed under; an unknown field
   produces a warning instead of a silent zero; and `crosscheck_expression`
   confirms `Sum(Sales)` is additive while flagging `Count(distinct Month)`,
   where sum-of-parts (4) contradicts the true total (2).

## What to say

> "The engine is not a validator. It will store a chart that renders blank and
> a measure that returns zero, and tell you everything is fine. So the agent
> refuses what it can refuse up front, and verifies what it builds. And every
> number it hands back arrives with the filters it was computed under — an
> agent should never be able to quote you a filtered figure as the total."

## Visual confirmation

The trace leaves **MCP Builder Demo** on the site — open it in the hub to see
the four rendered panels. For a systematic pixel check across every supported
visualization type, see `scripts/render_proof.mjs` and "Verification status" in
[docs/chart-building.md](../../docs/chart-building.md). The 12 original types
were render-verified upstream on Qlik Sense May 2026 with plain inputs; styling
options, number formats, master-item links and filterpane are not verified yet.
