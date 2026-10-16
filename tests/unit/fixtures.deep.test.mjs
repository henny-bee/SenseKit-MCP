import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { walkStrings } from "../../dist/core/walk.js";
import { redactSecrets } from "../../dist/core/redact.js";

// ── deep mode: a real snapshot directory of recorded qProps ──────────────────

test("deep fixture sweep (QPROP_FIXTURE_DIR)", { skip: !process.env.QPROP_FIXTURE_DIR }, () => {
  const root = process.env.QPROP_FIXTURE_DIR;
  let files = 0, leaves = 0, failures = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith(".json")) continue;
      files++;
      try {
        const doc = JSON.parse(readFileSync(p, "utf8"));
        walkStrings(doc, "", () => { leaves++; });
        redactSecrets(doc); // must never throw on real payloads
      } catch (e) {
        failures++;
        console.error("deep sweep failure:", p, String(e).slice(0, 120));
      }
    }
  };
  walk(root);
  console.log(`deep sweep: ${files} files, ${leaves} string leaves, ${failures} failures`);
  assert.equal(failures, 0);
  assert.ok(files > 0, "QPROP_FIXTURE_DIR contained no .json files");
});
