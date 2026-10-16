// Sheet grid layout: tile sizes, cell placement, and the placement lint.

import type { VizFinding } from "./specs.js";
import { CHART_TYPES } from "./types/index.js";
import type { GenericObject, GenericObjectProperties, SheetCell } from "../qix/types.js";

/** Minimum tile the type needs to actually draw at sheet scale (declared per
 *  type as ChartType.minTile). */
export const MIN_TILE: Record<string, { colspan: number; rowspan: number }> = Object.fromEntries(
  CHART_TYPES.flatMap((t) => (t.minTile ? [[t.name, t.minTile]] : [])),
);

/** Sheet-cell placement lint: every child placed, every cell backed by a
 *  child, everything inside the grid, no overlaps. These are the "object
 *  exists but the sheet shows nothing / garbage" failure modes. */
export function checkCellPlacement(
  cells: Array<{ name: string; col: number; row: number; colspan: number; rowspan: number }>,
  childIds: string[],
  columns: number,
  rows: number,
): VizFinding[] {
  const out: VizFinding[] = [];
  const placed = new Set(cells.map((c) => c.name));
  for (const id of childIds) {
    if (!placed.has(id)) out.push({ severity: "fail", message: `object ${id} has no cell on the sheet — it will not appear` });
  }
  for (const c of cells) {
    if (!childIds.includes(c.name)) {
      out.push({ severity: "warn", message: `cell references ${c.name} which is not a child of the sheet (orphan cell)` });
    }
    if (c.col < 0 || c.row < 0 || c.col + c.colspan > columns || c.row + c.rowspan > rows) {
      out.push({ severity: "fail", message: `cell ${c.name} (${c.col},${c.row} span ${c.colspan}x${c.rowspan}) exceeds the ${columns}x${rows} grid` });
    }
    if (c.colspan <= 0 || c.rowspan <= 0) {
      out.push({ severity: "fail", message: `cell ${c.name} has non-positive span` });
    }
  }
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i], b = cells[j];
      const overlap = a.col < b.col + b.colspan && b.col < a.col + a.colspan &&
                      a.row < b.row + b.rowspan && b.row < a.row + a.rowspan;
      if (overlap) out.push({ severity: "warn", message: `cells ${a.name} and ${b.name} overlap` });
    }
  }
  return out;
}

export const cellBox = (c: SheetCell) => ({ name: c.name, col: c.col ?? 0, row: c.row ?? 0, colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1 });

type Box = { col: number; row: number; colspan: number; rowspan: number };
const overlaps = (a: Box, b: Box) =>
  a.col < b.col + b.colspan && b.col < a.col + a.colspan && a.row < b.row + b.rowspan && b.row < a.row + a.rowspan;

/** Auto-placement slot for a `span` tile, given the other cells. The classic
 *  slot (3 tiles per 4-row band, by cell count n) wins whenever it is free, so
 *  sheets of uniform 8x4 tiles lay out exactly as before. When it would
 *  overlap an earlier, taller tile (piechart/scatterplot 8x6, treemap 8x8),
 *  take the first 8-column-aligned slot, scanning rows top-down, that
 *  overlaps nothing; failing that, go below the lowest cell. */
function autoSlot(others: Box[], n: number, span: { colspan: number; rowspan: number }, columns: number) {
  const free = (b: Box) => !others.some((o) => overlaps(b, o));
  const classic = { col: (n % 3) * 8, row: Math.floor(n / 3) * 4, ...span };
  if (free(classic)) return classic;
  const bottom = others.reduce((m, o) => Math.max(m, o.row + o.rowspan), 0);
  for (let row = 0; row < bottom; row++) {
    for (let col = 0; col + span.colspan <= columns; col += 8) {
      const b = { col, row, ...span };
      if (free(b)) return b;
    }
  }
  return { col: 0, row: bottom, ...span };
}

/** Put objectId's cell at `position` (or auto-place it), replacing the cell
 *  it already has, and grow the grid to fit. Mutates the sheet props. */
export function placeCell(
  props: GenericObjectProperties,
  objectId: string,
  viz: string,
  position?: { col: number; row: number; colspan: number; rowspan: number },
) {
  const cells: SheetCell[] = props.cells ?? [];
  const grid = { columns: props.columns ?? 24, rows: props.rows ?? 12 };
  const idx = cells.findIndex((c) => c.name === objectId);
  let cell: SheetCell & { type: string; col: number; row: number; colspan: number; rowspan: number };
  if (position) {
    cell = { name: objectId, type: viz, ...position };
  } else {
    // Auto-place: next free row band, 8x4 tiles, 3 per row.
    // Treemap refuses to draw ("This chart cannot be displayed") in a
    // short tile — it needs real estate. Verified live at sheet-tile
    // sizes, which is why auto-placement is per-type, not one-size.
    const n = cells.length;
    const span = MIN_TILE[viz] ?? { colspan: 8, rowspan: 4 };
    const others = cells.filter((_, i) => i !== idx).map(cellBox);
    cell = { name: objectId, type: viz, ...autoSlot(others, n, span, grid.columns) };
  }
  // A cell below the grid renders NOTHING (caught by our own gate on the
  // first live matrix run — 14 auto-placed tiles overflowed the default
  // 12-row grid). Grow the sheet instead of silently placing off-grid.
  if (cell.row + cell.rowspan > grid.rows) {
    props.rows = cell.row + cell.rowspan;
    grid.rows = props.rows;
  }
  if (cell.col + cell.colspan > grid.columns) {
    props.columns = cell.col + cell.colspan;
    grid.columns = props.columns;
  }
  props.cells = idx >= 0 ? cells.map((c, i) => (i === idx ? cell : c)) : [...cells, cell];
  return { cell, grid };
}

/** Placement lint for the sheet, narrowed to findings about one object. */
export async function placementFor(sheet: GenericObject, props: GenericObjectProperties, grid: { columns: number; rows: number }, objectId: string) {
  return checkCellPlacement(
    (props.cells ?? []).map(cellBox),
    (await sheet.getChildInfos()).map((c) => c.qId),
    grid.columns, grid.rows,
  ).filter((f) => f.message.includes(objectId));
}
