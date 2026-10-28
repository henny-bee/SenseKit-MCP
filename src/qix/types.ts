// Hand-typed QIX subset. Property trees are open: the engine round-trips unknown keys.

export type QJson = Record<string, unknown>;

export type QBlock = Record<string, unknown>;

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

/** Positions are optional on read: the client omits zeroes. */
export interface SheetCell {
  name: string;
  type?: string;
  col?: number;
  row?: number;
  colspan?: number;
  rowspan?: number;
  [key: string]: unknown;
}

export interface GenericObjectProperties {
  qInfo: { qId?: string; qType: string };
  qMetaDef?: NxMeta;
  visualization?: string;
  title?: string | { qStringExpression?: { qExpr?: string }; [key: string]: unknown };
  markdown?: string;
  qHyperCubeDef?: HyperCubeDef;
  qListObjectDef?: ListObjectDef;
  qChildListDef?: QJson;
  color?: QBlock;
  legend?: QBlock;
  dataPoint?: QBlock;
  labels?: QBlock;
  barGrouping?: QBlock;
  orientation?: string;
  // Boxplot cube lives here; the client derives the box measures from it.
  boxplotDef?: { qHyperCubeDef?: HyperCubeDef; [key: string]: unknown };
  navigation?: { action?: string; sheet?: string; websiteUrl?: string; sameWindow?: boolean; [key: string]: unknown };
  style?: QBlock;
  cells?: SheetCell[];
  columns?: number;
  rows?: number;
  [key: string]: unknown;
}

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

/** The engine serializes NaN as the string "NaN". */
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

export interface SessionObjectDef {
  qInfo: { qType: string };
  [key: string]: unknown;
}

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

/** EvaluateEx always sends all three fields. */
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

export interface Global {
  getDocList(): Promise<DocListEntry[]>;
  openDoc(appId: string, user: string, password: string, serial: string, noData: boolean): Promise<Doc>;
  createApp(name: string, localizedScriptMainSection: string): Promise<{ qSuccess: boolean; qAppId: string }>;
  getProgress(requestId: number): Promise<{
    qPersistentProgressMessages?: Array<{ qMessageParameters?: string[]; [key: string]: unknown }>;
    [key: string]: unknown;
  }>;
}

export interface EnigmaSession {
  open(): Promise<Global>;
  close(): Promise<void>;
  on(event: "closed", listener: () => void): void;
}
