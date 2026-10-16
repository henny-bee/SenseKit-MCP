// ── Credential redaction ─────────────────────────────────────────────────────
// QRS entities can carry secrets two ways: dedicated fields (password,
// passphrase, ...) and key=value pairs embedded in connection strings
// (PWD=...;). Generic endpoints like qrs_search must never egress either —
// an MCP client transcript is not a secret store.

// Matched as a SUBSTRING of the field name, not as an exact token: Qlik names
// its identity-provider credential fields with camelCase prefixes
// (oidcClientSecret, samlClientSecret), which an anchored ^...$ pattern misses
// entirely — virtualproxyconfig egressed a live OIDC client secret that way.
// Over-redaction of a look-alike (passwordLastChanged) is acceptable here;
// under-redaction is not.
const SECRET_KEY =
  /(password|passwd|passphrase|secret|privatekey|private_key|apikey|api_key|accesstoken|access_token|refreshtoken|refresh_token)/i;
// Key names may be prefixed/suffixed (vPassword, DB_PASSWORD, apiKey2) and
// values may be bare, single- or double-quoted — load scripts quote them,
// connection strings usually don't. All three value forms must be masked.
const SECRET_KV =
  /\b([\w.]*(?:pwd|password|passwd|passphrase|secret|api_?key|access_token|refresh_token|client_secret)[\w.]*)(\s*=\s*)("[^"]*"|'[^']*'|[^;\s"']+)/gi;

export const REDACTED = "***REDACTED***";

/** Mask key=value secrets in free text: connection strings, load scripts,
 *  reload logs. Over-redaction of a look-alike (vPasswordPolicy=strict) is
 *  acceptable in an egress path; under-redaction is not. */
export function scrubString(s: string): string {
  return s.replace(SECRET_KV, (_m, key: string, eq: string) => `${key}${eq}${REDACTED}`);
}

// Some QRS entities carry credentials as name/value PAIRS rather than as a
// named field — userdirectoryconnector.settings holds the LDAP bind password
// as {name: "Password", value: "..."}. The secret then sits under a key called
// "value", which tells a name-based matcher nothing. Detect the sibling that
// names it. (Same bug family as the camelCase miss: the matcher was looking in
// the wrong place, not matching too narrowly.)
const NAME_KEYS = new Set(["name", "key", "settingname", "property", "propertyname"]);
const VALUE_KEYS = new Set(["value", "val", "settingvalue"]);

function pairNamesASecret(obj: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(obj)) {
    if (NAME_KEYS.has(k.toLowerCase()) && typeof v === "string" && SECRET_KEY.test(v)) return true;
  }
  return false;
}

/** Recursively redact credential-bearing fields and embedded key=value
 *  secrets from an arbitrary QRS response. */
export function redactSecrets<T>(v: T): T {
  if (typeof v === "string") return scrubString(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redactSecrets(x)) as unknown as T;
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    const pairSecret = pairNamesASecret(v as Record<string, unknown>);
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) || (pairSecret && VALUE_KEYS.has(k.toLowerCase()))) {
        // Keep null/empty as-is — "no credential present" is a legitimate,
        // non-sensitive signal. Everything else is masked.
        out[k] = val === null || val === undefined || val === "" ? val : "***REDACTED***";
      } else {
        out[k] = redactSecrets(val);
      }
    }
    return out as unknown as T;
  }
  return v;
}
