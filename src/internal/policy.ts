import type { Scope } from "../guard.js";

export function identifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(field + " must be a non-empty string");
}

const fields = ["agent", "task", "action", "resource"] as const;

export function snapshot(scope: Scope): Scope {
  if (!scope || typeof scope !== "object") throw new TypeError("scope must be an object");
  const { agent, task, action, resource } = scope;
  const copy = { agent, task, action, resource };
  for (const field of fields) identifier(copy[field], `scope.${field}`);
  return copy;
}

export function validateExpiry(expiresAt: number): void {
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())
    throw new RangeError("expiresAt must be a future timestamp in milliseconds");
}

export function validateGrant(grant: (Scope & { expiresAt: number }) | undefined, current: Scope): void {
  if (!grant) throw new Error("Grant unavailable");
  if (Date.now() >= grant.expiresAt) throw new Error("Grant expired");
  const mismatches = fields.filter(field => grant[field] !== current[field]);
  if (mismatches.length)
    throw new Error(`Scope mismatch: ${mismatches.map(field => `scope.${field}`).join(", ")}; use the authenticated operation scope matching this grant`);
}
