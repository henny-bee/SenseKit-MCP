// Text only: live measures need client inline markup we can't synthesize.

import type { ChartType } from "./contract.js";

export const textImage: ChartType = {
  name: "text-image",
  spec: { minDims: 0, maxDims: 0, minMeasures: 0, maxMeasures: 0, cube: "none" },
  build: ({ base, title }) => {
    return {
      ...base,
      markdown: title ?? "",
      showTitles: true, subtitle: "", footnote: "",
    };
  },
};
