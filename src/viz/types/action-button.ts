// Props mirror sn-action-button's defaults, so it matches a client-made button.

import type { ChartType, NavigateTo } from "./contract.js";

export function navigationProps(nav: NavigateTo | undefined): Record<string, unknown> {
  if (!nav || nav.action === "none") return { action: "none" };
  if (nav.action === "goToSheet") return { action: "goToSheet", sheet: nav.sheetId ?? "" };
  if (nav.action === "openWebsite") return { action: "openWebsite", websiteUrl: nav.url ?? "", sameWindow: nav.sameWindow ?? false };
  return { action: nav.action };
}

export const actionButton: ChartType = {
  name: "action-button",
  spec: { minDims: 0, maxDims: 0, minMeasures: 0, maxMeasures: 0, cube: "none", renderVerified: false },
  minTile: { colspan: 4, rowspan: 2 },
  options: ["colorMode", "navigateTo"],
  colorModes: ["auto", "single"],
  build: ({ base, title, applied }) => {
    // Title is the label; kept on the object so lists and the gate can name it.
    const label = title ?? "Button";
    const background = applied.colorMode === "single" && applied.color
      ? { index: -1, color: applied.color }
      : { index: -1, color: "none" };
    return {
      ...base,
      title: label,
      showTitles: false, subtitle: "", footnote: "",
      useEnabledCondition: false, enabledCondition: 1,
      actions: [], runtimeExpressionEvaluation: false,
      navigation: navigationProps(applied.navigateTo),
      disableNavMenu: true, showDetails: false,
      style: {
        label, showLabel: true,
        font: {
          fontFamily: "Source Sans Pro", useColorExpression: false, color: { index: -1, color: "#ffffff" }, colorExpression: "",
          size: 0.5, sizeFixed: 20, sizeBehavior: "responsive", style: { bold: true, italic: false, underline: false }, align: "center",
        },
        background: {
          useColorExpression: false, color: background, colorExpression: "", mode: "none", useImage: false,
          url: { qStaticContentUrlDef: { qUrl: "" } }, size: "auto", position: "centerCenter",
        },
        border: { useColorExpression: false, color: { index: -1, color: "none" }, colorExpression: "", useBorder: false, radius: 0, width: 0 },
        icon: { useIcon: false, iconType: "", position: "left" },
      },
    };
  },
};
