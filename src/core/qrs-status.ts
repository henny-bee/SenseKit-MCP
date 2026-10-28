export const EXECUTION_STATUS: Record<number, string> = {
  0: "NeverStarted", 1: "Triggered", 2: "Started", 3: "Queued", 4: "AbortInitiated",
  5: "Aborting", 6: "Aborted", 7: "FinishedSuccess", 8: "FinishedFail", 9: "Skipped",
  10: "Retry", 11: "Error", 12: "Reset",
};

/** QRS's "no file" reference (e.g. no script log). */
export const NIL_GUID = "00000000-0000-0000-0000-000000000000";
