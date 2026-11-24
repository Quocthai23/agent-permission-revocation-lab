import { randomUUID } from "node:crypto";
import { isAsyncFunction } from "node:util/types";
import type { DatabaseSync } from "node:sqlite";
import type { Scope } from "./guard.js";
import { identifier, snapshot, validateExpiry, validateGrant } from "./internal/policy.js";

/**
 * Shared grants for processes using the same local SQLite file.
 * Use a caller-owned connection. Protected writes must be synchronous and use
 * that same connection inside the callback.
 */
export class SqliteTaskGuard {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    if (typeof database?.exec !== "function" || typeof database.prepare !== "function")
      throw new TypeError("database must be an open node:sqlite DatabaseSync connection");
    this.#database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS agent_permission_grants (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        task TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        expiresAt INTEGER NOT NULL
      ) STRICT
    `);
  }

  /** Issue an independent grant with a deadline in epoch milliseconds. */
  grant(scope: Scope, expiresAt: number): string {
    const { agent, task, action, resource } = snapshot(scope);
    validateExpiry(expiresAt);
    const id = randomUUID();
    this.#database.prepare(`
      INSERT INTO agent_permission_grants (id, agent, task, action, resource, expiresAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, agent, task, action, resource, expiresAt);
    return id;
  }

  /** Remove the grant. Returns false when the grant was already absent. */
  revoke(id: string): boolean {
    identifier(id, "id");
    return this.#database.prepare("DELETE FROM agent_permission_grants WHERE id = ?")
      .run(id).changes === 1;
  }

  /**
   * Start a write transaction, check the current grant and commit the protected write.
   * Call from trusted code outside any existing transaction. The callback must not
   * manage transactions or perform effects outside this SQLite connection.
   */
  run<T>(id: string, scope: Scope, operation: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
    identifier(id, "id");
    const current = snapshot(scope);
    if (typeof operation !== "function" || isAsyncFunction(operation))
      throw new TypeError("operation must be a synchronous function");
    if (this.#database.isTransaction)
      throw new Error("database already has an active transaction; call run outside that transaction");

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const grant = this.#database.prepare(`
        SELECT agent, task, action, resource, expiresAt
        FROM agent_permission_grants WHERE id = ?
      `).get(id) as (Scope & { expiresAt: number }) | undefined;
      validateGrant(grant, current);
      const result = operation();
      if (typeof (result as { then?: unknown } | null | undefined)?.then === "function")
        throw new TypeError("operation must return a synchronous result");
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
