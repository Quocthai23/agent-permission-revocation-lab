import type { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
import { operationId, PilotError } from "./store.js";

export interface TestEmail { from: string; to: string; subject: string; text: string }
interface Attempt {
  id: string; grant_id: string; agent: string; payload: string;
  state: "sending" | "accepted" | "uncertain" | "rejected";
  first_at: number; lease_until: number; attempts: number; provider_id: string;
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Test-address-only adapter. Local authority and provider acceptance are NOT atomic. */
export class ResendStudy {
  readonly #guard: SqliteTaskGuard;
  readonly #apiKey: string;
  constructor(readonly database: DatabaseSync, apiKey: string, readonly transport: Transport = fetch) {
    if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("configure RESEND_API_KEY locally");
    this.#apiKey = apiKey;
    this.#guard = new SqliteTaskGuard(database);
    database.exec(`CREATE TABLE IF NOT EXISTS pilot_resend (
      id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, agent TEXT NOT NULL, payload TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('sending','accepted','uncertain','rejected')),
      first_at INTEGER NOT NULL, lease_until INTEGER NOT NULL, attempts INTEGER NOT NULL,
      provider_id TEXT NOT NULL DEFAULT ''
    ) STRICT`);
  }
  row(id: string): Attempt | undefined {
    return this.database.prepare("SELECT * FROM pilot_resend WHERE id=?").get(id) as unknown as Attempt | undefined;
  }
  async submit(id: string, grantId: string, agent: string, email: TestEmail): Promise<{ state: string; providerId?: string }> {
    operationId(id);
    if (!email || !/^delivered(?:\+[a-zA-Z0-9_-]{1,64})?@resend\.dev$/.test(email.to))
      throw new PilotError(400, "only delivered[+label]@resend.dev test addresses are allowed");
    if (typeof email.from !== "string" || !email.from.includes("@") || /[\r\n]/.test(email.from) || email.from.length > 256 ||
        typeof email.subject !== "string" || !email.subject.trim() || email.subject.length > 200 ||
        typeof email.text !== "string" || !email.text.trim() || Buffer.byteLength(email.text) > 8192)
      throw new PilotError(400, "set a valid from address, subject (1-200 characters), and text (1-8192 bytes)");
    const payload = JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text });
    const now = Date.now();
    const existing = this.row(id);
    if (existing && (existing.payload !== payload || existing.agent !== agent || existing.grant_id !== grantId))
      throw new PilotError(409, "operation ID already binds another email, grant or identity");
    // Historical success is returned to the trusted owner without resending.
    if (existing?.state === "accepted") return { state: "accepted", providerId: existing.provider_id };
    const scope = { agent, task: id, action: "send", resource: `email/${email.to}` };
    const generation = this.#guard.run(grantId, scope, () => {
      // Re-read under the write lock: multiple processes must not both claim send.
      const current = this.row(id);
      if (current && (current.payload !== payload || current.agent !== agent || current.grant_id !== grantId))
        throw new PilotError(409, "operation ID already binds another email, grant or identity");
      if (current && (current.state === "accepted" || current.lease_until > now))
        throw new PilotError(409, "operation is already accepted or being submitted; inspect status");
      // Resend retains keys for 24h. Stop before that window; never infer failure.
      if (current && (now - current.first_at >= 23 * 60 * 60 * 1000 || current.attempts >= 3))
        throw new PilotError(409, "retry window or budget exhausted; reconcile manually without a new send");
      if (!current) this.database.prepare("INSERT INTO pilot_resend VALUES(?,?,?,?,?,?,?,?,?)")
        .run(id, grantId, agent, payload, "sending", now, now + 15000, 1, "");
      else this.database.prepare("UPDATE pilot_resend SET state='sending', lease_until=?, attempts=attempts+1 WHERE id=?")
        .run(now + 15000, id);
      return (current?.attempts ?? 0) + 1;
    });
    // Revocation can win AFTER the local check and BEFORE remote acceptance.
    // This unavoidable gap is an explicit limitation of this provider adapter.
    try {
      const response = await this.transport("https://api.resend.com/emails", {
        method: "POST", headers: {
          Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json",
          "Idempotency-Key": `permission-lab/${id}`,
        }, body: payload, signal: AbortSignal.timeout(5000), redirect: "error",
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const state = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status)
          ? "rejected" : "uncertain";
        this.database.prepare("UPDATE pilot_resend SET state=?, lease_until=0 WHERE id=? AND attempts=? AND state='sending'")
          .run(state, id, generation);
        return this.result(id);
      }
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id)
        throw new Error("provider success did not contain an email ID");
      this.database.prepare("UPDATE pilot_resend SET state='accepted', provider_id=?, lease_until=0 WHERE id=? AND attempts=? AND state='sending'")
        .run(result.id, id, generation);
      return this.result(id);
    } catch {
      this.database.prepare("UPDATE pilot_resend SET state='uncertain', lease_until=0 WHERE id=? AND attempts=? AND state='sending'")
        .run(id, generation);
      return this.result(id);
    }
  }
  private result(id: string): { state: string; providerId?: string } {
    const row = this.row(id)!;
    return row.provider_id ? { state: row.state, providerId: row.provider_id } : { state: row.state };
  }
  async retrieve(id: string, agent: string): Promise<unknown> {
    const row = this.row(id);
    if (!row || row.agent !== agent) throw new PilotError(404, "operation not found");
    if (!row.provider_id) return { state: row.state, note: "no provider ID recorded; acceptance may be unknown" };
    const response = await this.transport(`https://api.resend.com/emails/${encodeURIComponent(row.provider_id)}`, {
      headers: { Authorization: `Bearer ${this.#apiKey}` }, signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok) throw new Error(`provider status HTTP ${response.status}`);
    return response.json();
  }
}
