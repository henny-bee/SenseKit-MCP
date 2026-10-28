// The tools/list contract; session = selection state only, so not mutation-gated.
export const TOOLS = {
  qrs_about: { group: "admin" },
  service_status: { group: "admin" },
  license_summary: { group: "admin" },
  list_apps: { group: "admin" },
  list_streams: { group: "admin" },
  list_tasks: { group: "admin" },
  start_task: { group: "admin", mutating: true, destructive: true },
  list_users: { group: "admin" },
  list_extensions: { group: "admin" },
  list_data_connections: { group: "admin" },
  qrs_search: { group: "admin" },
  get_reload_log: { group: "admin" },
  engine_healthcheck: { group: "admin" },
  security_rule_audit: { group: "admin" },
  list_user_sessions: { group: "admin", cert: true },
  end_user_sessions: { group: "admin", cert: true, mutating: true, destructive: true },
  list_engine_apps: { group: "analyst" },
  get_app_data_model: { group: "analyst" },
  evaluate_expression: { group: "analyst" },
  create_hypercube: { group: "analyst" },
  get_field_values: { group: "analyst" },
  select_field_values: { group: "analyst", session: true },
  crosscheck_expression: { group: "analyst" },
  get_current_selections: { group: "analyst" },
  clear_selections: { group: "analyst", session: true },
  list_sheets: { group: "analyst" },
  get_sheet_objects: { group: "analyst" },
  get_object_properties: { group: "analyst" },
  search_expressions: { group: "analyst" },
  list_master_measures: { group: "analyst" },
  list_master_dimensions: { group: "analyst" },
  evaluate_master_measure: { group: "analyst" },
  get_app_lineage: { group: "analyst" },
  get_script: { group: "developer" },
  check_script: { group: "developer" },
  set_script: { group: "developer", mutating: true, destructive: true },
  reload_app: { group: "developer", mutating: true, destructive: true },
  create_app: { group: "developer", mutating: true, destructive: false },
  copy_app: { group: "developer", mutating: true, destructive: false },
  delete_app: { group: "developer", mutating: true, destructive: true },
  publish_app: { group: "developer", mutating: true, destructive: false },
  validate_sheet: { group: "developer" },
  create_sheet: { group: "developer", mutating: true, destructive: false },
  add_sheet_object: { group: "developer", mutating: true, destructive: false },
  update_sheet_object: { group: "developer", mutating: true, destructive: true },
  move_sheet_object: { group: "developer", mutating: true, destructive: false },
  delete_sheet_object: { group: "developer", mutating: true, destructive: true },
  create_master_measure: { group: "developer", mutating: true, destructive: false },
  create_master_dimension: { group: "developer", mutating: true, destructive: false },
  delete_master_item: { group: "developer", mutating: true, destructive: true },
};

// Changing this set breaks agents; server.gating checks src agrees.
export const ERROR_CODES = [
  "INVALID_INPUT", "NOT_FOUND", "VALIDATION_REFUSED", "REFERENCED", "CONFLICT",
  "ENGINE_ERROR", "QRS_ERROR", "PROXY_ERROR", "AUTH_ERROR", "INTERNAL",
];

export const GROUPS = ["analyst", "developer", "admin"];

export function expectedTools({ groups = GROUPS, allowMutations = true, cert = false } = {}) {
  return Object.entries(TOOLS)
    .filter(([, t]) => groups.includes(t.group))
    .filter(([, t]) => allowMutations || !t.mutating)
    .filter(([, t]) => cert || !t.cert)
    .map(([name]) => name)
    .sort();
}
