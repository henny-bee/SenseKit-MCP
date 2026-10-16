# Demos

Three runnable demos against a live Qlik Sense on-prem site. Each one has a
**RUNBOOK** (what to say, beat by beat) and a **`trace.mjs`** that executes the
same sequence with assertions on every claim — so a green run is evidence, not
a screenshot. Each also ships the transcript of a real run.

The demos and transcripts come from the upstream project (qseow-mcp 0.5.x,
recorded in August 2026). The tool names they use are unchanged, but response
and error text in this version can differ from the transcripts.

All three require the server env vars and `QSEOW_ALLOW_MUTATIONS=true`.

| Demo | Shows | Tool time | Setup |
|---|---|---|---|
| [finance-close-demo](finance-close-demo/) | **Root-cause a wrong number.** Dashboard says $655.7M, the certified datamart says $605.7M. The agent walks KPI → object → sheet → definition → lineage → script, finds a double-loaded adjustment batch, fixes the script and ties out. | ~5 s | `setup.mjs` once, then `plant.mjs` before every showing |
| [ops-demo](ops-demo/) | **Run the site.** Why did last night's reload fail (execution timeline + the actual error and file path from one call), is the engine the problem, and has the security-rule baseline drifted — measured as a before/after delta around a planted rule. | ~3 s | `setup.mjs` once |
| [builder-demo](builder-demo/) | **Build, and know it works.** Four visualizations from a brief; nonsense refused before it is written; a misspelled measure caught (Qlik would render it as `0` with no error); whole-sheet verdict; and every number returned with its selection context. | ~20 s | none — creates its own app |

## Running them

```bash
cd examples/<demo> && node trace.mjs
```

Non-zero exit means an assertion failed. The traces are the regression suite
for the demos: run them before any live showing.

## Before a live showing

**Never trust remembered state.** `finance-close-demo/trace.mjs` ends in the
CLEAN state, so re-arm with `plant.mjs` (it exits non-zero unless the planted
value verifies to the cent). The ops-demo's failing nightly task is standing
state by design and needs no re-arming; its planted security rule is removed
by the trace itself.

## Suggested order

1. **finance-close** (~8 min with narration): an agent walks a wrong number
   back to its root cause the way a support engineer does.
2. **ops-demo Beat 1** (~3 min) — reload forensics without opening the QMC or
   RDP-ing to the server.
3. **builder-demo** (~5 min) — building with a quality gate, and the trust
   envelope on returned numbers.
4. Leave the rest for questions.
