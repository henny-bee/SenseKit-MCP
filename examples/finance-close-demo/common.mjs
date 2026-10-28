import { loadConfig } from "../../dist/config.js";
import { EngineClient } from "../../dist/clients/engine.js";
import { QrsClient } from "../../dist/clients/qrs.js";

export const DATAMART_NAME = "AT Finance Close — Datamart";
export const DASHBOARD_NAME = "AT Finance Close — Dashboard";
export const CONNECTION_NAME = "FinanceCloseData";
export const CONNECTION_PATH = "C:\\qlik\\";
export const QVD = `lib://${CONNECTION_NAME}/revenue_close.qvd`;
export const MEASURE_TITLE = "Revenue Q1 (Actual)";
export const TRUTH = "605728164.79";
export const PLANTED = "655728164.79";

export const DATAMART_SCRIPT = `
// AT Finance Close — Datamart. Publishes the certified revenue fact QVD.
Revenue:
LOAD * INLINE [
Account,Segment,Region,DocType,Period,Scenario,Amount
A410201,Consumer,East,Normalized,FY2026-Q1,Actual,98412336.45
A410201,Consumer,West,Normalized,FY2026-Q1,Actual,87215498.12
A410202,Consumer,East,Normalized,FY2026-Q1,Actual,64108221.90
A410202,Consumer,West,Normalized,FY2026-Q1,Actual,58990417.33
A420101,Business,East,Normalized,FY2026-Q1,Actual,73556812.74
A420101,Business,West,Normalized,FY2026-Q1,Actual,69214905.66
A420102,Business,East,Normalized,FY2026-Q1,Actual,41837529.08
A420102,Business,West,Normalized,FY2026-Q1,Actual,38466120.51
A430100,Wholesale,East,Normalized,FY2026-Q1,Actual,12744208.00
A430100,Wholesale,West,Normalized,FY2026-Q1,Actual,11182115.00
A410201,Consumer,East,Adjustment,FY2026-Q1,Actual,32500000.00
A420101,Business,West,Adjustment,FY2026-Q1,Actual,17500000.00
];

STORE Revenue INTO [${QVD}] (qvd);
`;

export const DASHBOARD_SCRIPT_CLEAN = `
// AT Finance Close — Dashboard. Consumes the certified revenue QVD.
Revenue:
LOAD Account, Segment, Region, DocType, Period, Scenario, Amount
FROM [${QVD}] (qvd);
`;

// Planted defect: adjustment slice loaded twice, inflating Sum by exactly $50M.
export const DASHBOARD_SCRIPT_PLANTED = `
// AT Finance Close — Dashboard. Consumes the certified revenue QVD.
Revenue:
LOAD Account, Segment, Region, DocType, Period, Scenario, Amount
FROM [${QVD}] (qvd);

// 2026-08-05 hotfix: late adjustment batch from close night — merged manually
CONCATENATE(Revenue)
LOAD Account, Segment, Region, DocType, Period, Scenario, Amount
FROM [${QVD}] (qvd)
WHERE DocType = 'Adjustment';
`;

export function clients() {
  const cfg = loadConfig();
  return { cfg, engine: new EngineClient(cfg), qrs: new QrsClient(cfg) };
}

export async function findAppByName(qrs, name) {
  const apps = await qrs.get(`/qrs/app/full?filter=${encodeURIComponent(`name eq '${name}'`)}`);
  return apps[0]?.id;
}

export async function setScriptAndReload(engine, appId, script) {
  const app = await engine.app(appId);
  await app.setScript(script);
  const ok = await app.doReload(0, false, false);
  if (!ok) throw new Error(`reload failed for ${appId}`);
  await app.doSave();
  return app;
}
