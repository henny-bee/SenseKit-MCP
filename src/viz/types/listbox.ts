// listbox: a single-field list object (also the child type of a filterpane).

import { fieldDef } from "../inputs.js";
import { finishDim } from "../build.js";
import { ToolError } from "../../core/errors.js";
import type { ChartType } from "./contract.js";

export const listbox: ChartType = {
  name: "listbox",
  spec: { minDims: 1, maxDims: 1, minMeasures: 0, maxMeasures: 0, cube: "listobject" },
  build: ({ viz, base, dims }) => {
    if (!dims[0]) throw new ToolError("INVALID_INPUT", `${viz} needs exactly one dimension`);
    return {
      ...base,
      qListObjectDef: finishDim({
        qDef: { qFieldDefs: [fieldDef(dims[0])] },
        qInitialDataFetch: [{ qLeft: 0, qTop: 0, qWidth: 1, qHeight: 100 }],
      }, dims[0]),
    };
  },
};
