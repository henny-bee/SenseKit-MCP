import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QrsClient } from "../clients/qrs.js";
import type {
  QrsServiceStatus, QrsLicense, QrsAccessType, QrsApp, QrsOwned, QrsReloadTask, QrsUser, QrsDataConnection,
} from "../clients/qrs-types.js";
import type { Config } from "../config.js";
import { text } from "../core/result.js";
import { READ } from "../core/annotations.js";
import { guid, pageParams } from "../core/schemas.js";
import { paginate } from "../core/paging.js";
import { redactSecrets } from "../core/redact.js";
import { EXECUTION_STATUS } from "../core/qrs-status.js";

export function registerAdminTools(server: McpServer, qrs: QrsClient, cfg: Config): void {
  server.registerTool(
    "qrs_about",
    {
      description: "Qlik Sense server version and build info from the Repository Service. Cheap health check.",
      annotations: { ...READ, idempotentHint: true },
    },
    async () => text(await qrs.get("/qrs/about")),
  );

  server.registerTool(
    "service_status",
    {
      description: "Health of all Qlik services on every node (repository, proxy, engine, scheduler, printing).",
      annotations: { ...READ, idempotentHint: true },
    },
    async () => {
      const rows = await qrs.get<QrsServiceStatus[]>("/qrs/servicestatus/full");
      // QRS enum: healthy services report serviceState 2.
      const TYPE: Record<number, string> = { 0: "Repository", 1: "Proxy", 2: "Scheduler", 3: "Engine", 4: "AppMigration", 5: "Printing" };
      const STATE: Record<number, string> = { 0: "Initializing", 1: "CertificatesNotInstalled", 2: "Running", 3: "NoCommunication", 4: "Disabled", 5: "Unknown" };
      return text(rows.map((r) => ({
        node: r.serverNodeConfiguration?.hostName ?? r.serverNodeConfiguration?.name,
        service: TYPE[r.serviceType] ?? `type-${r.serviceType}`,
        state: STATE[r.serviceState] ?? `state-${r.serviceState}`,
        healthy: r.serviceState === 2,
      })));
    },
  );

  server.registerTool(
    "license_summary",
    {
      description: "License overview: serial, edition, expiry, and professional/analyzer access allocations.",
      annotations: { ...READ, idempotentHint: true },
    },
    async () => {
      const lic = await qrs.get<QrsLicense>("/qrs/license");
      const pro = await qrs.get<QrsAccessType[]>("/qrs/license/professionalaccesstype/full");
      const ana = await qrs.get<QrsAccessType[]>("/qrs/license/analyzeraccesstype/full");
      return text({
        serial: lic.serial, name: lic.name, organization: lic.organization,
        isExpired: lic.isExpired, isSubscription: lic.isSubscription,
        keyDetails: lic.keyDetails,
        professionalAllocated: pro.map((p) => `${p.user?.userDirectory}\\${p.user?.userId}`),
        analyzerAllocated: ana.map((a) => `${a.user?.userDirectory}\\${a.user?.userId}`),
      });
    },
  );

  server.registerTool(
    "list_apps",
    {
      description: "List apps in the repository with owner, stream, size, and reload time. Optional QRS filter, e.g. \"name sw 'Sales'\" or \"stream.name eq 'Everyone'\". Paged.",
      inputSchema: { filter: z.string().optional().describe("QRS filter expression"), ...pageParams },
      annotations: READ,
    },
    async ({ filter, offset, limit }) => {
      const path = `/qrs/app/full${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      const apps = await qrs.get<QrsApp[]>(path);
      return text(paginate(apps.map((a) => ({
        id: a.id, name: a.name, owner: `${a.owner?.userDirectory}\\${a.owner?.userId}`,
        stream: a.stream?.name ?? null, published: a.published,
        lastReloadTime: a.lastReloadTime, fileSizeBytes: a.fileSize,
      })), offset, limit));
    },
  );

  server.registerTool(
    "list_streams",
    {
      description: "List streams (publish targets) with owner. Paged.",
      inputSchema: { ...pageParams },
      annotations: READ,
    },
    async ({ offset, limit }) => {
      const s = await qrs.get<QrsOwned[]>("/qrs/stream/full");
      return text(paginate(
        s.map((x) => ({ id: x.id, name: x.name, owner: `${x.owner?.userDirectory}\\${x.owner?.userId}` })),
        offset, limit,
      ));
    },
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List reload tasks with enabled state and last execution result. Optional QRS filter. Paged.",
      inputSchema: { filter: z.string().optional().describe("QRS filter expression"), ...pageParams },
      annotations: READ,
    },
    async ({ filter, offset, limit }) => {
      const path = `/qrs/reloadtask/full${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      const tasks = await qrs.get<QrsReloadTask[]>(path);
      return text(paginate(tasks.map((t) => ({
        id: t.id, name: t.name, app: t.app?.name, enabled: t.enabled,
        lastStatus: EXECUTION_STATUS[t.operational?.lastExecutionResult?.status ?? -1] ?? "Unknown",
        lastStart: t.operational?.lastExecutionResult?.startTime,
        lastStop: t.operational?.lastExecutionResult?.stopTime,
      })), offset, limit));
    },
  );

  // Read-only servers never register mutating tools, so tools/list stays honest.
  if (cfg.allowMutations) {
    server.registerTool(
      "start_task",
      {
        description: "Start a reload task by id (fire-and-forget; poll list_tasks for status). MUTATION: the task's reload replaces app data.",
        inputSchema: { taskId: guid.describe("Reload task id") },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      },
      async ({ taskId }) => {
        await qrs.post(`/qrs/task/${taskId}/start`);
        return text(`Task ${taskId} start requested. Poll list_tasks for status.`);
      },
    );
  }

  server.registerTool(
    "list_users",
    {
      description: "List users known to the repository. Optional QRS filter, e.g. \"userId eq 'qservice'\". Paged.",
      inputSchema: { filter: z.string().optional().describe("QRS filter expression"), ...pageParams },
      annotations: READ,
    },
    async ({ filter, offset, limit }) => {
      const path = `/qrs/user/full${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      const users = await qrs.get<QrsUser[]>(path);
      return text(paginate(users.map((u) => ({
        id: u.id, user: `${u.userDirectory}\\${u.userId}`, name: u.name,
        roles: u.roles, inactive: u.inactive, removedExternally: u.removedExternally,
      })), offset, limit));
    },
  );

  server.registerTool(
    "list_extensions",
    {
      description: "List installed visualization extensions. Paged.",
      inputSchema: { ...pageParams },
      annotations: READ,
    },
    async ({ offset, limit }) => {
      const ext = await qrs.get<QrsOwned[]>("/qrs/extension/full");
      return text(paginate(
        ext.map((e) => ({ id: e.id, name: e.name, owner: `${e.owner?.userDirectory}\\${e.owner?.userId}` })),
        offset, limit,
      ));
    },
  );

  server.registerTool(
    "list_data_connections",
    {
      description: "List data connections. Credentials are redacted, including secrets embedded in connection strings. Paged.",
      inputSchema: { ...pageParams },
      annotations: READ,
    },
    async ({ offset, limit }) => {
      const dc = await qrs.get<QrsDataConnection[]>("/qrs/dataconnection/full");
      return text(paginate(redactSecrets(dc.map((d) => ({
        id: d.id, name: d.name, type: d.type, connectionstring: d.connectionstring,
        owner: `${d.owner?.userDirectory}\\${d.owner?.userId}`,
      }))), offset, limit));
    },
  );

  server.registerTool(
    "qrs_search",
    {
      description: "Generic QRS entity search: any entity type (app, user, stream, reloadtask, dataconnection, extension, tag, customproperty, systemrule, ...) with an optional QRS filter expression. The governance power tool. Credential-bearing fields are redacted on every entity type. Paged.",
      inputSchema: {
        entity: z.string().describe("QRS entity type, e.g. 'app', 'systemrule', 'tag'"),
        filter: z.string().optional().describe("QRS filter, e.g. \"name sw 'Finance'\""),
        full: z.boolean().optional().describe("Return full entities instead of condensed (default false)"),
        ...pageParams,
      },
      annotations: READ,
    },
    async ({ entity, filter, full, offset, limit }) => {
      const suffix = full ? "/full" : "";
      const path = `/qrs/${entity}${suffix}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
      const res = await qrs.get(path);
      // Redact every entity type: the generic path must never egress secrets.
      const clean = redactSecrets(res);
      return text(Array.isArray(clean) ? paginate(clean, offset, limit, full ? 25 : 100) : clean);
    },
  );
}
