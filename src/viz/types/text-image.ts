// text-image takes authored text only: embedding a live measure requires
// the client's inline markup, which can't be synthesized server-side.

import type { ChartType } from "./contract.js";

export const textImage: ChartType = {
  name: "text-image",
  spec: { minDims: 0, maxDims: 0, minMeasures: 0, maxMeasures: 0, cube: "none" },
  build: ({ base, title }) => {
    // text-image renders authored rich text. Embedding a live measure needs
    // the Sense client's own inline markup, which cannot be synthesized
    // reliably from here — an earlier attempt shipped literal "[Measure 1]"
    // placeholder text to users. So: render the given text, and take no
    // measures (VIZ_SPECS enforces maxMeasures 0). Use a kpi for a live value.
    return {
      ...base,
      markdown: title ?? "",
      showTitles: true, subtitle: "", footnote: "",
    };
  },
};
