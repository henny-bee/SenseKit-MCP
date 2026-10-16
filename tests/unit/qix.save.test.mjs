import { test } from "node:test";
import assert from "node:assert/strict";
import { saveApp, WRITE_FAILED } from "../../dist/qix/save.js";

const writeFailed = () => Object.assign(new Error("Write Failed"), { code: WRITE_FAILED });

// ── DoSave with retry on "Write Failed" ──────────────────────────────────────

test("saveApp: retries 'Write Failed' until the save succeeds", async () => {
  let calls = 0;
  await saveApp({ doSave: async () => { if (++calls < 3) throw writeFailed(); } }, [0, 0, 0]);
  assert.equal(calls, 3);
});

test("saveApp: any other error is passed through without a retry", async () => {
  let calls = 0;
  const denied = Object.assign(new Error("Access denied"), { code: 5 });
  await assert.rejects(saveApp({ doSave: async () => { calls++; throw denied; } }, [0, 0, 0]), (e) => e === denied);
  assert.equal(calls, 1);
});

test("saveApp: after the last retry, an ENGINE_ERROR that says the change is not saved", async () => {
  let calls = 0;
  await assert.rejects(saveApp({ doSave: async () => { calls++; throw writeFailed(); } }, [0, 0]), (e) => {
    assert.equal(e.code, "ENGINE_ERROR");
    assert.match(e.message, /NOT saved/);
    assert.deepEqual(e.details, { engineCode: WRITE_FAILED, attempts: 3 });
    return true;
  });
  assert.equal(calls, 3);
});
