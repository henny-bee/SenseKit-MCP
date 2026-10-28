import { ToolError } from "../core/errors.js";
import type { Doc } from "./types.js";

/** LOCERR_PERSISTENCE_WRITE_FAILED; transient while another save is in flight. */
export const WRITE_FAILED = 9000;

const RETRY_DELAYS_MS = [250, 750, 1500];

const engineCode = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;

export async function saveApp(app: Pick<Doc, "doSave">, delays: readonly number[] = RETRY_DELAYS_MS): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await app.doSave();
      return;
    } catch (e) {
      if (engineCode(e) !== WRITE_FAILED) throw e;
      if (attempt >= delays.length) {
        throw new ToolError(
          "ENGINE_ERROR",
          `save failed: the engine answered "Write Failed" ${attempt + 1} times. The change exists in the engine session but is NOT saved, ` +
          "and it is lost when the session closes. Check the app's current state (for example get_sheet_objects) before retrying, so the retry does not create a duplicate.",
          { engineCode: WRITE_FAILED, attempts: attempt + 1 },
        );
      }
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
