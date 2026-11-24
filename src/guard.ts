import { identifier, snapshot, validateExpiry, validateGrant } from "./internal/policy.js";

/** Trusted server-side identity and exact operation for one task. */
export interface Scope {
  agent: string;
  task: string;
  action: string;
  resource: string;
}

/** In-process authority. Only trusted application code may issue grants or supply callbacks. */
export class TaskGuard {
  #active = new Map<string, Scope & { expiresAt: number }>();

  /** Issue a new independent grant. expiresAt uses epoch milliseconds. */
  grant(scope: Scope, expiresAt: number): string {
    const copy = snapshot(scope);
    validateExpiry(expiresAt);
    const id = crypto.randomUUID();
    this.#active.set(id, { ...copy, expiresAt });
    return id;
  }

  /** Remove a grant. Returns false when already absent. */
  revoke(id: string): boolean {
    identifier(id, "id");
    return this.#active.delete(id);
  }

  /** Check current authority and immediately invoke the trusted operation on success. */
  run<T>(id: string, scope: Scope, operation: () => T): T {
    identifier(id, "id");
    const current = snapshot(scope);
    if (typeof operation !== "function") throw new TypeError("operation must be a function");
    const grant = this.#active.get(id);
    if (grant && Date.now() >= grant.expiresAt) {
      this.#active.delete(id);
      throw new Error("Grant expired");
    }
    validateGrant(grant, current);
    return operation();
  }
}
