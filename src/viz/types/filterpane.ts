import type { ChartType } from "./contract.js";

export const filterpane: ChartType = {
  name: "filterpane",
  spec: { minDims: 1, maxDims: 20, minMeasures: 0, maxMeasures: 0, cube: "filterpane" },
  build: ({ base, title }) => {
    // Without qChildListDef the client never finds the listbox children.
    return {
      ...base,
      showTitles: Boolean(title), subtitle: "", footnote: "", showDetails: false, disableNavMenu: false,
      qChildListDef: { qData: { info: "/qInfo" } },
    };
  },
};
