export const APP_NAME = "MCP Builder Demo";
export const SHEET_TITLE = "Regional Sales";

export const SCRIPT = `
Sales:
LOAD * INLINE [
Region,Product,Month,Sales,Qty
East,Widget,Jan,120,10
East,Gadget,Jan,90,8
West,Widget,Jan,150,12
West,Gadget,Jan,70,6
East,Widget,Feb,130,11
East,Gadget,Feb,110,9
West,Widget,Feb,160,13
West,Gadget,Feb,95,7
];
`;

export const PANELS = [
  { visualization: "kpi",       title: "Total Sales",     dimensions: [],                    measures: ["Sum(Sales)"] },
  { visualization: "barchart",  title: "Sales by Region", dimensions: ["Region"],            measures: ["Sum(Sales)"] },
  { visualization: "linechart", title: "Sales by Month",  dimensions: ["Month"],             measures: ["Sum(Sales)"] },
  { visualization: "table",     title: "Detail",          dimensions: ["Region", "Product"], measures: ["Sum(Sales)", "Sum(Qty)"] },
];

export const TOTAL_SALES = 925;
