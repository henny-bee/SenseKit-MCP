// Headless browser for render_sheet: opens a sheet with the proxy session cookie.

import { createRequire } from "node:module";
import { vpPath, type Config } from "../config.js";
import { ToolError } from "../core/errors.js";

// 16:9 laptop screen: the sheet grid lays out as the user sees it.
const VIEWPORT = { width: 1600, height: 900 };
const RENDER_TIMEOUT_MS = 20_000;

// EN + DE: the client follows the hub profile language, not the browser locale.
export const RENDER_ERROR = /Incomplete visualization|Invalid (dimension|measure)|cannot be displayed|not found on the server|License Expired|Unvollständige Visualisierung|Ungültige (Dimension|Kennzahl)|kann nicht angezeigt werden/i;

export type RenderStatus = "renders" | "blank" | "error" | "not-rendered" | "missing";

export function playwrightInstalled(): boolean {
  try { createRequire(import.meta.url).resolve("playwright-core"); return true; } catch { return false; }
}

export const sheetUrl = (cfg: Config, appId: string, sheetId: string): string =>
  `https://${cfg.host}:${cfg.proxyPort}${vpPath(cfg)}/sense/app/${appId}/sheet/${encodeURIComponent(sheetId)}/state/analysis`;

export function browserCookie(cfg: Config, cookie: string) {
  const eq = cookie.indexOf("=");
  return { name: cookie.slice(0, eq), value: cookie.slice(eq + 1), domain: cfg.host, path: "/", secure: true, httpOnly: true, sameSite: "None" as const };
}

export interface SheetChild { id: string; type: string }

function paintedCells(ids: string[]): Record<string, { state: string | null; painted: boolean }> {
  const shown = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== "hidden"; };
  const inked = (c: HTMLCanvasElement) => {
    if (!c.width || !c.height) return false;
    // WebGL or cross-origin canvas: can't sample, assume painted.
    try {
      const d = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
      if (!d) return true;
      for (let i = 3; i < d.length; i += 16) if (d[i]) return true;
      return false;
    } catch { return true; }
  };
  const out: Record<string, { state: string | null; painted: boolean }> = {};
  for (const id of ids) {
    const cell = document.querySelector(`.qv-gridcell[tid="${id}"]`);
    if (!cell) continue;
    const title = cell.querySelector(".qv-object-title");
    const body = [...cell.querySelectorAll("*")].filter((e) => !title?.contains(e) && !e.closest(".hidden-screen-reader-label") && shown(e));
    const painted = body.some((e) => e.matches("svg :is(rect, path, circle, line, polygon, polyline, ellipse), img")
      || (e instanceof HTMLCanvasElement && inked(e))
      || (!e.children.length && !!e.textContent?.trim()));
    out[id] = { state: cell.getAttribute("data-render-state"), painted };
  }
  return out;
}

export async function renderSheet(cfg: Config, cookie: string, appId: string, sheetId: string, children: SheetChild[], objectId?: string) {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch(/[\\/]/.test(cfg.browser) ? { executablePath: cfg.browser } : { channel: cfg.browser });
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", ignoreHTTPSErrors: !cfg.tlsVerify });
    await ctx.addCookies([browserCookie(cfg, cookie)]);
    const page = await ctx.newPage();
    const res = await page.goto(sheetUrl(cfg, appId, sheetId), { waitUntil: "domcontentloaded", timeout: 30_000 });
    // As a 401, so ProxySession.run logs in again once.
    if (page.url().includes("/internal_forms_authentication/") || res?.status() === 401 || res?.status() === 403) {
      throw new ToolError("AUTH_ERROR", "render_sheet: the proxy did not accept the session (login page or 401/403)", { status: res?.status() === 403 ? 403 : 401 });
    }
    // data-render-state="1" is the client's own per-cell "painted" flag.
    await page.waitForFunction(
      (ids) => ids.every((id) => document.querySelector(`.qv-gridcell[tid="${id}"]`)?.getAttribute("data-render-state") === "1"),
      children.map((c) => c.id), { timeout: RENDER_TIMEOUT_MS },
    ).catch(() => undefined);
    await page.waitForTimeout(1000); // chart entry animations
    const cells = await page.evaluate(paintedCells, children.map((c) => c.id));
    const objects: (SheetChild & { status: RenderStatus; message?: string })[] = [];
    for (const c of children) {
      const cell = cells[c.id];
      if (!cell) { objects.push({ ...c, status: "missing" }); continue; }
      const err = page.locator(`.qv-gridcell[tid="${c.id}"]`).getByText(RENDER_ERROR).first();
      if (await err.count()) objects.push({ ...c, status: "error", message: (await err.textContent())?.trim().slice(0, 200) });
      else objects.push({ ...c, status: cell.painted ? "renders" : cell.state === "1" ? "blank" : "not-rendered" });
    }
    const shot = await (objectId ? page.locator(`.qv-gridcell[tid="${objectId}"]`) : page).screenshot();
    return { image: shot.toString("base64"), objects };
  } finally {
    await browser.close();
  }
}
