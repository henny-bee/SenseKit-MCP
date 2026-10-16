// Engine object walks: sheets, sheet ownership, master-item references.

import { walkStrings } from "../core/walk.js";
import { mapPool, ENGINE_CONCURRENCY } from "../core/pool.js";
import { ToolError } from "../core/errors.js";
import type { Doc, GenericObject, GenericObjectProperties, ObjectTreeEntry } from "./types.js";

export async function sheetList(app: Doc): Promise<Array<{ sheetId: string; title: string; published: boolean }>> {
  const obj = await app.createSessionObject({
    qInfo: { qType: "mcp-sheetlist" },
    qAppObjectListDef: {
      qType: "sheet",
      qData: { title: "/qMetaDef.title" },
    },
  });
  try {
    const layout = await obj.getLayout();
    return (layout.qAppObjectList?.qItems ?? []).map((s) => ({
      sheetId: s.qInfo.qId,
      title: s.qMeta?.title ?? s.qData?.title ?? "",
      published: Boolean(s.qMeta?.published),
    }));
  } finally {
    await app.destroySessionObject(obj.id).catch(() => {});
  }
}

/** sheetId -> {title}; objectId -> owning sheet. Built once per call that
 *  needs ownership annotation. */
export async function objectToSheetMap(app: Doc): Promise<Map<string, { sheetId: string; sheetTitle: string }>> {
  const map = new Map<string, { sheetId: string; sheetTitle: string }>();
  const sheets = await sheetList(app);
  // Sheets are read concurrently, but applied in sheet order so an object
  // listed under two sheets resolves exactly as the sequential walk did.
  const children = await mapPool(sheets, ENGINE_CONCURRENCY, async (s) => {
    try {
      return await (await app.getObject(s.sheetId)).getChildInfos();
    } catch { return []; /* sheet unreadable — skip */ }
  });
  sheets.forEach((s, i) => {
    for (const c of children[i]) map.set(c.qId, { sheetId: s.sheetId, sheetTitle: s.title });
  });
  return map;
}

/** Property paths in an object's qProps that link to the given master item.
 *  Master items are referenced by qLibraryId — never by title — so this is
 *  the reference test delete_master_item uses. */
export function findLibraryRefs(prop: unknown, libraryId: string): string[] {
  const out: string[] = [];
  walkStrings(prop, "", (path, s) => {
    if (s === libraryId && (path === "qLibraryId" || path.endsWith(".qLibraryId"))) out.push(path);
  });
  return out;
}

export interface LibraryReference {
  objectId: string; qType: string; title?: string;
  sheetId?: string; sheetTitle?: string; parentId?: string;
  paths: string[];
}

/** getAllInfos entries that can never carry a qLibraryId link: master items
 *  themselves, sheets/stories (layout containers — their charts are separate
 *  objects), and handles that are not generic objects at all (getObject
 *  would only fail on them). Skipping them saves two round trips each. */
const NON_LINKING_TYPES = new Set(["measure", "dimension", "sheet", "story", "appprops", "LoadModel", "bookmark", "variable"]);

type SheetOwner = { sheetId: string; sheetTitle: string };

/** id -> properties for every DESCENDANT in a GetFullPropertyTree result
 *  (the root itself excluded). */
export function indexPropertyTree(root: ObjectTreeEntry): Map<string, GenericObjectProperties> {
  const out = new Map<string, GenericObjectProperties>();
  const walk = (e: ObjectTreeEntry): void => {
    for (const c of e.qChildren ?? []) {
      if (c.qProperty.qInfo.qId) out.set(c.qProperty.qInfo.qId, c.qProperty);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** Properties of every object below a sheet, read with ONE GetFullPropertyTree
 *  per sheet instead of a getObject + getProperties pair per chart, plus the
 *  object -> sheet map those trees imply. Ownership mirrors objectToSheetMap +
 *  getParent: a sheet's direct children are owned by it; a grandchild (a
 *  filterpane's listbox) records its parent and is owned through it; deeper
 *  descendants record their parent only. A sheet whose tree cannot be read
 *  falls back to getChildInfos for ownership, and its objects are then read
 *  one by one by the caller. */
async function readSheetTrees(app: Doc): Promise<{
  byId: Map<string, { prop: GenericObjectProperties; owner?: SheetOwner; parentId?: string }>;
  sheetOf: Map<string, SheetOwner>;
}> {
  const sheets = await sheetList(app);
  const trees = await mapPool(sheets, ENGINE_CONCURRENCY, async (s): Promise<{ tree?: ObjectTreeEntry; childIds?: string[] }> => {
    try {
      const sheet = await app.getObject(s.sheetId);
      try {
        return { tree: await sheet.getFullPropertyTree() };
      } catch {
        return { childIds: (await sheet.getChildInfos()).map((c) => c.qId) };
      }
    } catch { return {}; /* sheet unreadable — skip */ }
  });
  const byId = new Map<string, { prop: GenericObjectProperties; owner?: SheetOwner; parentId?: string }>();
  const sheetOf = new Map<string, SheetOwner>();
  const descend = (entry: ObjectTreeEntry, parentId: string, owner: SheetOwner | undefined): void => {
    for (const c of entry.qChildren ?? []) {
      const id = c.qProperty.qInfo.qId;
      if (!id) continue;
      byId.set(id, { prop: c.qProperty, owner, parentId });
      descend(c, id, undefined);
    }
  };
  sheets.forEach((s, i) => {
    const owner = { sheetId: s.sheetId, sheetTitle: s.title };
    for (const id of trees[i].childIds ?? []) sheetOf.set(id, owner);
    for (const child of trees[i].tree?.qChildren ?? []) {
      const id = child.qProperty.qInfo.qId;
      if (!id) continue;
      sheetOf.set(id, owner);
      byId.set(id, { prop: child.qProperty, owner });
      descend(child, id, owner);
    }
  });
  return { byId, sheetOf };
}

/** Every app object whose properties link to libraryId, with its owning
 *  sheet. Objects nested below a sheet child (a filterpane's listboxes) are
 *  attributed through their parent. Sheet contents come from one property
 *  tree per sheet; anything not under a sheet (master visualizations, ...)
 *  is read individually, bounded-parallel. Result order = getAllInfos order. */
export async function libraryReferences(app: Doc, libraryId: string): Promise<LibraryReference[]> {
  const [allInfos, trees] = await Promise.all([app.getAllInfos(), readSheetTrees(app)]);
  const infos = allInfos.filter((info) => !NON_LINKING_TYPES.has(info.qType));
  const refs = await mapPool(infos, ENGINE_CONCURRENCY, async (info): Promise<LibraryReference | undefined> => {
    const ref = (prop: GenericObjectProperties, paths: string[], owner?: SheetOwner, parentId?: string): LibraryReference => ({
      objectId: info.qId, qType: info.qType,
      title: typeof prop.title === "string" ? prop.title : prop.qMetaDef?.title,
      ...(owner ?? {}), ...(parentId ? { parentId } : {}), paths,
    });
    const inTree = trees.byId.get(info.qId);
    if (inTree) {
      const paths = findLibraryRefs(inTree.prop, libraryId);
      return paths.length ? ref(inTree.prop, paths, inTree.owner, inTree.parentId) : undefined;
    }
    try {
      const obj = await app.getObject(info.qId);
      const prop = await obj.getProperties();
      const paths = findLibraryRefs(prop, libraryId);
      if (!paths.length) return undefined;
      let owner = trees.sheetOf.get(info.qId);
      let parentId: string | undefined;
      if (!owner) {
        try {
          const parent = await obj.getParent();
          parentId = parent?.id;
          owner = parentId ? trees.sheetOf.get(parentId) : undefined;
        } catch { /* top-level object (master visualization etc.) */ }
      }
      return ref(prop, paths, owner, parentId);
    } catch { return undefined; /* not a generic object (field, ...) — cannot hold a link */ }
  });
  return refs.filter((r): r is LibraryReference => r !== undefined);
}

/** Throw unless objectId is a direct child of the sheet. */
export async function requireChildOf(sheet: GenericObject, sheetId: string, objectId: string): Promise<void> {
  const children = (await sheet.getChildInfos()).map((c) => c.qId);
  if (!children.includes(objectId)) {
    throw new ToolError("NOT_FOUND", `object ${objectId} is not a child of sheet ${sheetId}`, { objectId, sheetId });
  }
}
