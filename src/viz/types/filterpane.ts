// filterpane: parent object + one listbox child per dimension. The children
// reuse the render-verified standalone listbox shape, but the parent/child
// assembly has NOT been proven in a browser client yet — hence unverified.

import type { ChartType } from "./contract.js";

export const filterpane: ChartType = {
  name: "filterpane",
  spec: { minDims: 1, maxDims: 20, minMeasures: 0, maxMeasures: 0, cube: "filterpane", renderVerified: false },
  build: ({ base, title }) => {
    // The pane holds no data itself: the client discovers its listboxes
    // through the qChildList this def requests, so qChildListDef is what
    // makes the children appear at all. Children: buildFilterpaneChildren.
    return {
      ...base,
      showTitles: Boolean(title), subtitle: "", footnote: "", showDetails: false, disableNavMenu: false,
      qChildListDef: { qData: { info: "/qInfo" } },
    };
  },
};
