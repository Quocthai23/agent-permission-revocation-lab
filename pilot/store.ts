import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
import type { Scope } from "agent-permission-revocation-lab";

export class PilotError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface Job extends Scope {
  id: string; grant_id: string; body: string;
  state: "queued" | "leased" | "done" | "denied" | "uncertain";
  attempts: number; next_at: number; lease_until: number; lease_token: string;
}

export function operationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new PilotError(400, "id must contain 1-100 letters, digits, underscores or hyphens");
}

/** Trusted local scheduler/storage adapter; never expose grant issuance over HTTP. */
export class PilotStore {
  readonly db: DatabaseSync;
  readonly guard: SqliteTaskGuard;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("PRAGMA foreign_keys = ON");
    this.guard = new SqliteTaskGuard(this.db);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pilot_jobs (
        id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, agent TEXT NOT NULL,
        task TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, body TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','done','denied','uncertain')),
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT ''
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS pilot_immutable BEFORE UPDATE OF
        id, grant_id, agent, task, action, resource, body ON pilot_jobs
      BEGIN SELECT RAISE(ABORT, 'operation identity and payload are immutable'); END;
      CREATE TABLE IF NOT EXISTS pilot_receipts (
        operation_id TEXT PRIMARY KEY REFERENCES pilot_jobs(id), committed_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS pilot_reports (
        operation_id TEXT PRIMARY KEY REFERENCES pilot_receipts(operation_id), body TEXT NOT NULL
      ) STRICT;
    `);
  }
  close(): void { this.db.close(); }
  job(id: string): Job | undefined {
    return this.db.prepare("SELECT * FROM pilot_jobs WHERE id = ?").get(id) as unknown as Job | undefined;
  }
  enqueue(id: string, agent: string, body: string, expiresAt = Date.now() + 60_000): Job {
    operationId(id);
    if (typeof body !== "string" || !body.trim() || Buffer.byteLength(body) > 8192)
      throw new PilotError(400, "body must be nonempty text up to 8192 UTF-8 bytes");
    const scope = { agent, task: id, action: "write", resource: `reports/${id}` };
    const existing = this.job(id);
    if (existing) {
      if (existing.agent !== agent || existing.body !== body)
        throw new PilotError(409, "operation ID already binds different content or identity");
      return existing;
    }
    const grant = this.guard.grant(scope, expiresAt);
    try {
      this.guard.run(grant, scope, () => this.db.prepare(
        "INSERT INTO pilot_jobs(id,grant_id,agent,task,action,resource,body) VALUES(?,?,?,?,?,?,?)"
      ).run(id, grant, agent, id, scope.action, scope.resource, body));
    } catch (error) { this.guard.revoke(grant); throw error; }
    return this.job(id)!;
  }
  owned(id: string, agent: string): Job {
    const job = this.job(id);
    if (!job || job.agent !== agent) throw new PilotError(404, "operation not found");
    return job;
  }
  status(id: string, agent: string): { id: string; state: "committed" | "not_committed"; committedAt?: number } {
    this.owned(id, agent);
    const receipt = this.db.prepare("SELECT committed_at FROM pilot_receipts WHERE operation_id = ?").get(id);
    return receipt ? { id, state: "committed", committedAt: Number(receipt.committed_at) }
      : { id, state: "not_committed" };
  }
  execute(id: string, agent: string, body: string): ReturnType<PilotStore["status"]> {
    const job = this.owned(id, agent);
    if (body !== job.body) throw new PilotError(409, "operation ID already binds a different payload");
    // The route fixes action/resource; identity comes from authentication, not JSON.
    const scope = { agent, task: id, action: "write", resource: `reports/${id}` };
    try {
      this.guard.run(job.grant_id, scope, () => {
        const inserted = this.db.prepare(
          "INSERT INTO pilot_receipts VALUES(?,?) ON CONFLICT(operation_id) DO NOTHING"
        ).run(id, Date.now()).changes;
        if (inserted) this.db.prepare("INSERT INTO pilot_reports VALUES(?,?)").run(id, body);
      });
    } catch (error) {
      if (error instanceof Error && /^(Grant unavailable|Grant expired|Scope mismatch)/.test(error.message))
        throw new PilotError(403, "current grant does not authorize this operation");
      throw error;
    }
    return this.status(id, agent);
  }
  claim(now = Date.now(), leaseMs = 10_000, maxAttempts = 4): Job | undefined {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`UPDATE pilot_jobs SET state='uncertain', lease_token='', last_error='retry budget exhausted'
        WHERE attempts >= ? AND (state='queued' OR (state='leased' AND lease_until <= ?))`)
        .run(maxAttempts, now);
      const row = this.db.prepare(`SELECT id FROM pilot_jobs WHERE attempts < ? AND
        ((state='queued' AND next_at <= ?) OR (state='leased' AND lease_until <= ?)) ORDER BY id LIMIT 1`)
        .get(maxAttempts, now, now);
      if (!row) { this.db.exec("COMMIT"); return; }
      const token = randomUUID();
      this.db.prepare(`UPDATE pilot_jobs SET state='leased', attempts=attempts+1,
        lease_until=?, lease_token=? WHERE id=?`).run(now + leaseMs, token, row.id);
      const job = this.job(String(row.id));
      this.db.exec("COMMIT");
      return job;
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); throw error; }
  }
  finish(job: Job, state: "done" | "denied" | "uncertain" | "queued", reason = "", now = Date.now()): boolean {
    // Fence stale workers; destination operation IDs still protect against old sends.
    return this.db.prepare(`UPDATE pilot_jobs SET state=?, last_error=?, next_at=?,
      lease_token='', lease_until=0 WHERE id=? AND state='leased' AND lease_token=?`)
      .run(state, reason, now + Math.min(2000, 25 * 2 ** job.attempts), job.id, job.lease_token).changes === 1;
  }
}
