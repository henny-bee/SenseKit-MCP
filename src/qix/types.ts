// Hand-written types for the subset of the Qlik Engine JSON API (QIX) this
// server actually calls, and for the property/layout shapes it reads or
// writes. enigma.js is untyped here (no @types package in the lockfile), so
// EngineClient casts its handles to these interfaces once, at the boundary.
//
// Qlik property trees are OPEN by design: every client and supernova adds its
// own keys (color, legend, cId, autoSort, ...), and the engine round-trips
// keys it doesn't understand. The interfaces below type the keys this code
// touches and keep an index signature for the rest — read through the named
// keys, never by guessing through the index.

/** Open-ended JSON object (engine payloads, chart property blocks). The one
 *  deliberate escape hatch: values are `unknown`, so reads must narrow. */
export type QJson = Record<string, unknown>;

/** A supernova property block (color, legend, dataPoint, labels, ...). Open:
 *  the builder writes the keys it knows and spreads the rest through. */
export type QBlock = Record<string, unknown>;

// ── Common ───────────────────────────────────────────────────────────────────

export interface NxInfo { qId: string; qType: string }

export interface NxMeta {
  title?: string;
  description?: string;
  tags?: string[];
  published?: boolean;
  [key: string]: unknown;
}

export interface NxRange { qFrom: number; qCount: number }

export interface NxPage { qLeft: number; qTop: number; qWidth: number; qHeight: number }

export interface NxSortCriteria {
  qSortByNumeric?: number;
  qSortByAscii?: number;
  qSortByLoadOrder?: number;
  qSortByState?: number;
  qSortByExpression?: number;
  [key: string]: unknown;
}

export interface NxNumFormat {
  qType?: string;
  qFmt?: string;
  qnDec?: number;
  qUseThou?: number;
  qDec?: string;
  qThou?: string;
}

export interface NxValidationError { qErrorCode: number; qContext?: string; qExtendedMessage?: string }

// ── Property shapes (what we write with createChild / setProperties) ────────

/** Inline dimension definition (hypercube dimension qDef, or qListObjectDef.qDef). */
export interface NxInlineDimensionDef {
  qGrouping?: string;
  qFieldDefs?: string[];
  qFieldLabels?: string[];
  qSortCriterias?: NxSortCriteria[];
  autoSort?: boolean;
  cId?: string;
  [key: string]: unknown;
}

export interface NxDimension {
  qDef: NxInlineDimensionDef;
  qLibraryId?: string;
  qNullSuppression?: boolean;
  cId?: string;
  [key: string]: unknown;
}

/** Inline measure definition (hypercube measure qDef). */
export interface NxInlineMeasureDef {
  qDef?: string;
  qLabel?: string;
  qNumFormat?: NxNumFormat;
  numFormatFromTemplate?: boolean;
  isCustomFormatted?: boolean;
  autoSort?: boolean;
  cId?: string;
  coloring?: { baseColor?: { color?: string; index?: number }; [key: string]: unknown };
  [key: string]: unknown;
}

export interface NxMeasure {
  qDef: NxInlineMeasureDef;
  qLibraryId?: string;
  qSortBy?: NxSortCriteria;
  cId?: string;
  [key: string]: unknown;
}

export interface HyperCubeDef {
  qDimensions: NxDimension[];
  qMeasures: NxMeasure[];
  qInterColumnSortOrder?: number[];
  qInitialDataFetch?: NxPage[];
  qMode?: string;
  qNoOfLeftDims?: number;
  qAlwaysFullyExpanded?: boolean;
  [key: string]: unknown;
}

export interface ListObjectDef {
  qDef: NxInlineDimensionDef;
  qLibraryId?: string;
  qInitialDataFetch?: NxPage[];
  [key: string]: unknown;
}

/** A sheet grid cell as stored in sheet properties. Positions are optional
 *  on read (the client omits zeroes); see viz/layout.ts cellBox. */
export interface SheetCell {
  name: string;
  type?: string;
  col?: number;
  row?: number;
  colspan?: number;
  rowspan?: number;
  [key: string]: unknown;
}

/** Generic object properties: charts, sheets, listboxes, session objects. */
export interface GenericObjectProperties {
  qInfo: { qId?: string; qType: string };
  qMetaDef?: NxMeta;
  visualization?: string;
  /** A plain string, or a title expression ({ qStringExpression: { qExpr } }). */
  title?: string | { qStringExpression?: { qExpr?: string }; [key: string]: unknown };
  markdown?: string;
  qHyperCubeDef?: HyperCubeDef;
  qListObjectDef?: ListObjectDef;
  qChildListDef?: QJson;
  // Supernova blocks the builder writes (see viz/props.ts, viz/options.ts).
  color?: QBlock;
  legend?: QBlock;
  dataPoint?: QBlock;
  labels?: QBlock;
  barGrouping?: QBlock;
  orientation?: string;
  // boxplot: its cube lives under boxplotDef (the client derives the box
  // measures from it).
  boxplotDef?: { qHyperCubeDef?: HyperCubeDef; [key: string]: unknown };
  // action-button (sn-action-button): navigation after a click, and styling.
  navigation?: { action?: string; sheet?: string; websiteUrl?: string; sameWindow?: boolean; [key: string]: unknown };
  style?: QBlock;
  // Sheet properties.
  cells?: SheetCell[];
  columns?: number;
  rows?: number;
  [key: string]: unknown;
}

/** Master measure properties (CreateMeasure / GetProperties). */
export interface GenericMeasureProperties {
  qInfo: { qId?: string; qType: string };
  qMeasure: {
    qLabel?: string;
    qDef: string;
    qGrouping?: string;
    qExpressions?: string[];
    qActiveExpression?: number;
    qNumFormat?: NxNumFormat;
    numFormatFromTemplate?: boolean;
    isCustomFormatted?: boolean;
    [key: string]: unknown;
  };
  qMetaDef?: NxMeta;
}

/** Master dimension properties (CreateDimension). */
export interface GenericDimensionProperties {
  qInfo: { qId?: string; qType: string };
  qDim: {
    qGrouping: string;
    qFieldDefs: string[];
    qFieldLabels?: string[];
    qLabelExpression?: string;
    title?: string;
    [key: string]: unknown;
  };
  qMetaDef?: NxMeta;
}

// ── Layout shapes (what we read back with getLayout) ────────────────────────

export interface NxDimensionInfo {
  qFallbackTitle?: string;
  qError?: NxValidationError;
  qCardinal?: number;
  [key: string]: unknown;
}

export interface NxMeasureInfo {
  qFallbackTitle?: string;
  qError?: NxValidationError;
  [key: string]: unknown;
}

/** One cell of a data page. The engine serializes NaN as the string "NaN". */
export interface NxCell {
  qText?: string;
  qNum?: number | "NaN";
  qState?: string;
  [key: string]: unknown;
}

export interface NxDataPage { qMatrix?: NxCell[][]; [key: string]: unknown }

export interface HyperCubeLayout {
  qDimensionInfo?: NxDimensionInfo[];
  qMeasureInfo?: NxMeasureInfo[];
  qSize?: { qcx: number; qcy: number };
  qMode?: string;
  qDataPages?: NxDataPage[];
  [key: string]: unknown;
}

export interface ListObjectLayout {
  qDimensionInfo?: NxDimensionInfo;
  qDataPages?: NxDataPage[];
  [key: string]: unknown;
}

/** Item of a library/app-object list (qMeasureList, qDimensionList,
 *  qAppObjectList). `D` is the shape requested through qData. */
export interface NxListItem<D = QJson> {
  qInfo: NxInfo;
  qMeta?: NxMeta;
  qData?: D;
  [key: string]: unknown;
}

export interface LibraryMeasureData {
  def?: { qLabel?: string; qDef?: string; [key: string]: unknown };
}

export interface LibraryDimensionData {
  def?: {
    qLabelExpression?: string;
    qFieldLabels?: string[];
    qFieldDefs?: string[];
    qGrouping?: string;
    [key: string]: unknown;
  };
}

export interface NxCurrentSelectionItem {
  qField: string;
  qSelectedCount: number;
  qSelected?: string;
  [key: string]: unknown;
}

export interface NxVariableListItem { qName: string; qDefinition?: string; [key: string]: unknown }

export interface NxFieldDescription { qName: string; [key: string]: unknown }

export interface GenericObjectLayout {
  qInfo: NxInfo;
  qHyperCube?: HyperCubeLayout;
  boxplotDef?: { qHyperCube?: HyperCubeLayout };
  qListObject?: ListObjectLayout;
  qSelectionObject?: { qSelections?: NxCurrentSelectionItem[] };
  qFieldList?: { qItems?: NxFieldDescription[] };
  qMeasureList?: { qItems?: NxListItem<LibraryMeasureData>[] };
  qDimensionList?: { qItems?: NxListItem<LibraryDimensionData>[] };
  qAppObjectList?: { qItems?: NxListItem<{ title?: string }>[] };
  qVariableList?: { qItems?: NxVariableListItem[] };
  [key: string]: unknown;
}

/** Properties for a session object: list/selection/cube definitions are
 *  open-ended request shapes, so only qInfo is fixed. */
export interface SessionObjectDef {
  qInfo: { qType: string };
  [key: string]: unknown;
}

// ── Engine methods (enigma.js handles) ──────────────────────────────────────

/** GetFullPropertyTree entry: an object's properties plus its descendants'. */
export interface ObjectTreeEntry {
  qProperty: GenericObjectProperties;
  qChildren?: ObjectTreeEntry[];
  [key: string]: unknown;
}

export interface GenericObject {
  id: string;
  getFullPropertyTree(): Promise<ObjectTreeEntry>;
  getProperties(): Promise<GenericObjectProperties>;
  setProperties(props: GenericObjectProperties): Promise<void>;
  getLayout(): Promise<GenericObjectLayout>;
  getChildInfos(): Promise<NxInfo[]>;
  createChild(props: GenericObjectProperties): Promise<GenericObject>;
  destroyChild(id: string): Promise<boolean>;
  getParent(): Promise<GenericObject>;
  searchListObjectFor(path: string, match: string): Promise<boolean>;
}

export interface GenericMeasure {
  id?: string;
  getLayout(): Promise<{ qInfo: NxInfo; [key: string]: unknown }>;
  getProperties(): Promise<GenericMeasureProperties>;
}

export interface GenericDimension {
  id?: string;
  getLayout(): Promise<{ qInfo: NxInfo; [key: string]: unknown }>;
}

export interface FieldValue { qText?: string; qIsNumeric?: boolean; qNumber?: number }

export interface Field {
  selectValues(values: FieldValue[], toggle?: boolean, softLock?: boolean): Promise<boolean>;
  clear(): Promise<boolean>;
}

/** FieldValue as returned by EvaluateEx: the engine always sends all three. */
export interface EvaluateResult { qText: string; qIsNumeric: boolean; qNumber: number }

export interface CheckExpressionResult { qErrorMsg?: string; qBadFieldNames?: NxRange[]; qDangerousFieldNames?: NxRange[] }

export interface ScriptSyntaxError { qErrLen?: number; qTabIx?: number; qLineInTab?: number; qColInLine?: number; qTextPos?: number; [key: string]: unknown }

export interface TableRecord {
  qName: string;
  qNoOfRows?: number;
  qFields?: Array<{ qName: string; qnPresentDistinctValues?: number; qTags?: string[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface LineageInfo { qDiscriminator?: string; qStatement?: string }

export interface AppLayout { qTitle?: string; qLastReloadTime?: string; [key: string]: unknown }

/** An open app (enigma Doc handle). */
export interface Doc {
  getObject(id: string): Promise<GenericObject>;
  createObject(props: GenericObjectProperties): Promise<GenericObject>;
  createSessionObject(props: SessionObjectDef): Promise<GenericObject>;
  destroySessionObject(id: string): Promise<boolean>;
  getAllInfos(): Promise<NxInfo[]>;
  checkExpression(expression: string): Promise<CheckExpressionResult>;
  evaluateEx(expression: string): Promise<EvaluateResult>;
  doSave(): Promise<void>;
  doReload(mode?: number, partial?: boolean, debug?: boolean): Promise<boolean>;
  getScript(): Promise<string>;
  setScript(script: string): Promise<void>;
  checkScriptSyntax(): Promise<ScriptSyntaxError[]>;
  getTablesAndKeys(
    windowSize: { qcx: number; qcy: number }, nullSize: { qcx: number; qcy: number },
    cellHeight: number, syntheticMode: boolean, includeSysVars: boolean,
  ): Promise<{ qtr?: TableRecord[]; [key: string]: unknown }>;
  getField(name: string): Promise<Field>;
  clearAll(): Promise<void>;
  createMeasure(props: GenericMeasureProperties): Promise<GenericMeasure>;
  createDimension(props: GenericDimensionProperties): Promise<GenericDimension>;
  destroyMeasure(id: string): Promise<boolean>;
  destroyDimension(id: string): Promise<boolean>;
  getMeasure(id: string): Promise<GenericMeasure>;
  getLineage(): Promise<LineageInfo[]>;
  getAppLayout(): Promise<AppLayout>;
}

export interface DocListEntry {
  qDocId: string;
  qDocName: string;
  qLastReloadTime?: string;
  qFileSize?: number;
  [key: string]: unknown;
}

/** The appless Global handle. */
export interface Global {
  getDocList(): Promise<DocListEntry[]>;
  openDoc(appId: string, user: string, password: string, serial: string, noData: boolean): Promise<Doc>;
  createApp(name: string, localizedScriptMainSection: string): Promise<{ qSuccess: boolean; qAppId: string }>;
  getProgress(requestId: number): Promise<{
    qPersistentProgressMessages?: Array<{ qMessageParameters?: string[]; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
}

/** enigma.js session (the websocket wrapper). */
export interface EnigmaSession {
  open(): Promise<Global>;
  close(): Promise<void>;
  on(event: "closed", listener: () => void): void;
}
