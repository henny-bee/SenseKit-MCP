// Substring, not anchored: must catch oidcClientSecret etc. Over-redaction is OK.
const SECRET_KEY =
  /(password|passwd|passphrase|secret|privatekey|private_key|apikey|api_key|accesstoken|access_token|refreshtoken|refresh_token)/i;
// Keys may be prefixed/suffixed; values bare, single- or double-quoted.
const SECRET_KV =
  /\b([\w.]*(?:pwd|password|passwd|passphrase|secret|api_?key|access_token|refresh_token|client_secret)[\w.]*)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s"']+)/gi;

export const REDACTED = "***REDACTED***";

export function scrubString(s: string): string {
  return s.replace(SECRET_KV, (_m, key: string, eq: string) => `${key}${eq}${REDACTED}`);
}

// Pairs like {name: "Password", value: "..."} (LDAP connector) hide it under "value".
const NAME_KEYS = new Set(["name", "key", "settingname", "property", "propertyname"]);
const VALUE_KEYS = new Set(["value", "val", "settingvalue"]);

function pairNamesASecret(obj: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(obj)) {
    if (NAME_KEYS.has(k.toLowerCase()) && typeof v === "string" && SECRET_KEY.test(v)) return true;
  }
  return false;
}

export function redactSecrets<T>(v: T): T {
  if (typeof v === "string") return scrubString(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redactSecrets(x)) as unknown as T;
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    const pairSecret = pairNamesASecret(v as Record<string, unknown>);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) || (pairSecret && VALUE_KEYS.has(k.toLowerCase()))) {
        // Keep null/empty: "no credential set" is a useful, non-sensitive signal.
        out[k] = val === null || val === undefined || val === "" ? val : "***REDACTED***";
      } else {
        out[k] = redactSecrets(val);
      }
    }
    return out as unknown as T;
  }
  return v;
}
