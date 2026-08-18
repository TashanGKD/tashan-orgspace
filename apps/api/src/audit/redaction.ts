export type AuditJsonValue =
  null | boolean | number | string | AuditJsonValue[] | { [key: string]: AuditJsonValue };

const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "accesskeysecret",
  "accesstoken",
  "authorization",
  "code",
  "cookie",
  "password",
  "passphrase",
  "refreshtoken",
  "secret",
  "setcookie",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function maskPhone(phone: string): string {
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) return REDACTED;
  const visiblePrefix = phone.slice(0, Math.min(6, phone.length - 4));
  const visibleSuffix = phone.slice(-4);
  const hiddenLength = Math.max(3, phone.length - visiblePrefix.length - visibleSuffix.length);
  return `${visiblePrefix}${"*".repeat(hiddenLength)}${visibleSuffix}`;
}

export function redact(input: unknown): AuditJsonValue {
  const ancestors = new WeakSet<object>();

  function visit(value: unknown, key?: string): AuditJsonValue {
    const normalized = key === undefined ? undefined : normalizedKey(key);
    if (normalized !== undefined && normalized.includes("phone")) {
      return typeof value === "string" ? maskPhone(value) : REDACTED;
    }
    if (normalized !== undefined && SENSITIVE_KEYS.has(normalized)) return REDACTED;

    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new TypeError("audit payload requires a finite JSON number");
      return value;
    }
    if (typeof value !== "object") {
      throw new TypeError("audit payload must be JSON-compatible");
    }
    if (ancestors.has(value)) throw new TypeError("audit payload contains a cycle");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => visit(item));
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        throw new TypeError("audit payload must contain only plain JSON objects");
      }
      return Object.fromEntries(
        Object.entries(value).map(([childKey, childValue]) => [
          childKey,
          visit(childValue, childKey),
        ]),
      );
    } finally {
      ancestors.delete(value);
    }
  }

  return visit(input);
}
