// Unit tests for the pure logic layer (node --test; no live site needed).
//
// Fixture modes:
//   - tests/fixtures/*.json  — synthetic, shipped with the repo, always run
//   - QPROP_FIXTURE_DIR=<dir> — optional deep mode: recursively walks every
//     .json under the dir (e.g. a real site snapshot with thousands of
//     recorded qProps) through the same code paths. Not shipped.
//
// Shared by every tests/unit/*.test.mjs (this file is not a test itself).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
export const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
