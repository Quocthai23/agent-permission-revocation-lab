import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";

const strategies = ["outbox-only", "dispatch-check", "receiver-atomic"];
const timings = ["never", "before-dispatch", "in-flight", "after-commit"];
/** @returns {PromiseWithResolvers<void>} */
const deferred = () => Promise.withResolvers();

/**
 * @typedef {object} HttpTrialOptions
 * @property {"outbox-only" | "dispatch-check" | "receiver-atomic"} [strategy]
 * @property {"never" | "before-dispatch" | "in-flight" | "after-commit"} [revokeAt]
 * @property {number} [attempts]
 * @property {boolean} [loseFirstResponse]
 * @property {boolean} [abortInFlight]
 */

/** @param {unknown} error */
function isDenied(error) {
  return error instanceof Error &&
    (error.message === "Grant unavailable" || error.message === "Grant expired");
}

/**
 * Loopback lab, NOT an authenticated HTTP adapter. All roles share a local file.
 * A fixed trusted outbox row supplies the identity, scope and payload at the sink.
 * Gates establish ordering without sleeps; no HTTP call runs inside guard.run().
 * @param {HttpTrialOptions} [options]
 */
export async function httpTrial(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("options must be an object; pass {} for the default trial");
  const {
  strategy = "receiver-atomic", revokeAt = "never", attempts = 1,
  loseFirstResponse = false, abortInFlight = false,
  } = options;
  if (!strategies.includes(strategy))
    throw new TypeError(`strategy must be one of: ${strategies.join(", ")}`);
  if (!timings.includes(revokeAt))
    throw new TypeError(`revokeAt must be one of: ${timings.join(", ")}`);
  for (const [name, value] of Object.entries({ loseFirstResponse, abortInFlight })) {
    if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean; use true or false`);
  }
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10)
    throw new RangeError("attempts must be an integer from 1 to 10");
  if (abortInFlight && (attempts !== 1 || revokeAt !== "never" || loseFirstResponse))
    throw new TypeError("abortInFlight is a separate single-attempt control");

  const directory = await mkdtemp(join(tmpdir(), "agent-permission-http-"));
  const path = join(directory, "lab.sqlite");
  /** @type {DatabaseSync[]} */
  const connections = [];
  const open = () => {
    const db = new DatabaseSync(path, { timeout: 5000 });
    connections.push(db);
    return db;
  };
  const received = deferred();
  const release = deferred();
  const completed = deferred();
  let server;
  let requests = 0;
  /** @type {string[]} */
  const decisions = [];
  try {
    const scheduler = open();
    const issuer = new SqliteTaskGuard(scheduler);
    scheduler.exec(`
      CREATE TABLE http_outbox (
        id TEXT PRIMARY KEY, grant_id TEXT NOT NULL,
        agent TEXT NOT NULL, task TEXT NOT NULL, action TEXT NOT NULL,
        resource TEXT NOT NULL, body TEXT NOT NULL
      ) STRICT;
      CREATE TABLE http_effects (
        operation_id TEXT PRIMARY KEY, body TEXT NOT NULL
      ) STRICT;
    `);
    const scope = { agent: "reporter", task: "monthly", action: "write", resource: "report" };
    const grant = issuer.grant(scope, Date.now() + 60_000);
    issuer.run(grant, scope, () => scheduler.prepare(
      "INSERT INTO http_outbox VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("operation-1", grant, scope.agent, scope.task, scope.action, scope.resource, "Draft"));
    // Demonstrate that dispatch uses persisted state, not the scheduler's connection.
    scheduler.close();
    connections.pop();

    const coordinator = new SqliteTaskGuard(open());
    const dispatcherDb = open();
    const dispatcher = new SqliteTaskGuard(dispatcherDb);
    const sinkDb = open();
    const sink = new SqliteTaskGuard(sinkDb);
    const job = dispatcherDb.prepare("SELECT * FROM http_outbox WHERE id = ?").get("operation-1");
    if (!job || typeof job.id !== "string" || typeof job.body !== "string" ||
        typeof job.grant_id !== "string" || typeof job.agent !== "string" ||
        typeof job.task !== "string" || typeof job.action !== "string" || typeof job.resource !== "string")
      throw new Error("outbox row must contain string id, grant_id, scope fields and body; recreate the trial database");
    // Copy narrowed values; asynchronous callbacks must not depend on mutable row types.
    const operationId = job.id;
    const body = job.body;
    const grantId = job.grant_id;
    const operationScope = { agent: job.agent, task: job.task, action: job.action, resource: job.resource };
    const write = () => sinkDb.prepare(
      "INSERT INTO http_effects VALUES (?, ?) ON CONFLICT(operation_id) DO NOTHING"
    ).run(operationId, body);

    server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/operations/operation-1") {
        response.writeHead(404).end();
        return;
      }
      const attempt = ++requests;
      try {
        if (attempt === 1) {
          received.resolve();
          await release.promise;
        }
        // Resolve the operation from trusted storage; never trust scope from HTTP.
        if (strategy === "receiver-atomic") sink.run(grantId, operationScope, write);
        else write();
        decisions.push("committed");
        if (attempt === 1 && loseFirstResponse) response.destroy();
        else response.writeHead(200).end("committed");
      } catch (error) {
        const denied = isDenied(error);
        decisions.push(denied ? "denied" : "error");
        response.writeHead(denied ? 403 : 500).end(denied ? "denied" : "error");
      } finally {
        if (attempt === 1) completed.resolve();
      }
    });
    server.requestTimeout = 5000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server must listen on a TCP port");
    const url = `http://127.0.0.1:${address.port}/operations/operation-1`;
    if (revokeAt === "before-dispatch") coordinator.revoke(grant);

    /** @type {(number | string)[]} */
    const responses = [];
    for (let index = 0; index < attempts; index++) {
      if (strategy === "dispatch-check") {
        try { dispatcher.run(grantId, operationScope, () => true); }
        catch (error) {
          if (!isDenied(error)) throw error;
          responses.push("dispatch-denied");
          continue;
        }
      }
      const abort = new AbortController();
      const timeout = AbortSignal.timeout(5000);
      const pending = fetch(url, {
        method: "POST", signal: AbortSignal.any([abort.signal, timeout]),
      }).then(async response => { await response.text(); return response.status; }, error => {
        if (timeout.aborted) throw error;
        if (abort.signal.aborted) return "aborted";
        if (loseFirstResponse && index === 0 && error.cause?.code === "UND_ERR_SOCKET")
          return "response-lost";
        throw error;
      });
      if (index === 0) {
        // Timeout this handshake too: failures must not leave an indefinitely hung lab.
        await Promise.race([received.promise, pending.then(() => {
          throw new Error("Request ended before reaching receiver");
        })]);
        if (revokeAt === "in-flight") coordinator.revoke(grant);
        if (abortInFlight) {
          abort.abort();
          await pending;
        }
        release.resolve();
      }
      responses.push(await pending);
      if (index === 0) {
        await completed.promise;
        if (revokeAt === "after-commit") coordinator.revoke(grant);
      }
    }
    const count = sinkDb.prepare("SELECT COUNT(*) AS writes FROM http_effects").get();
    if (!count || typeof count.writes !== "number") throw new Error("Expected a numeric effect count");
    const writes = count.writes;
    return { requests, decisions, responses, writes };
  } finally {
    release.resolve();
    if (server?.listening) {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }
    for (const db of connections.reverse()) db.close();
    await rm(directory, { recursive: true, force: true });
  }
}
