import test from "node:test";
import assert from "node:assert/strict";
import { fork, execFile } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PilotStore } from "../.pilot/store.js";
import { dispatchOnce } from "../.pilot/dispatcher.js";

const receiverPath = fileURLToPath(new URL("../.pilot/receiver-cli.js", import.meta.url));
const workerPath = fileURLToPath(new URL("../.pilot/worker-cli.js", import.meta.url));
const exec = promisify(execFile);

async function startReceiver(path, tokens, fault) {
  const child = fork(receiverPath, [], {
    env: { ...process.env, PILOT_DATABASE: path, PILOT_IDENTITIES: JSON.stringify(tokens), PILOT_TEST_FAULT: fault ?? "" },
    stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true,
  });
  const backlog = [];
  child.on("message", message => backlog.push(message));
  async function event(name) {
    const known = backlog.find(message => message.event === name);
    if (known) return known;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`receiver did not emit ${name}`)), 10000);
      const message = value => { if (value.event === name) finish(null, value); };
      const exit = () => finish(new Error(`receiver exited before ${name}`));
      function finish(error, value) {
        clearTimeout(timer); child.off("message", message); child.off("exit", exit);
        if (error) reject(error); else resolve(value);
      }
      child.on("message", message); child.once("exit", exit);
    });
  }
  const ready = await event("ready");
  return { child, url: ready.url, event, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill(); await exited;
  } };
}

async function fixture(t, fault) {
  const directory = await mkdtemp(join(tmpdir(), "permission-pilot-"));
  const path = join(directory, "pilot.sqlite");
  const token = randomBytes(32).toString("hex");
  const other = randomBytes(32).toString("hex");
  const tokens = { [token]: "reporter", [other]: "other-agent" };
  const store = new PilotStore(path);
  const job = store.enqueue("report-1", "reporter", "Monthly draft");
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.stop();
    store.close(); await rm(directory, { recursive: true, force: true });
  });
  const start = async mode => {
    const server = await startReceiver(path, tokens, mode); servers.push(server); return server;
  };
  const server = await start(fault);
  const request = (credential = token, payload = { body: job.body }, target = server) => fetch(`${target.url}/operations/${job.id}`, {
    method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
  });
  const status = async (credential = token, target = server) => {
    const response = await fetch(`${target.url}/operations/${job.id}`, {
      headers: { Authorization: `Bearer ${credential}` }, signal: AbortSignal.timeout(5000),
    });
    return { code: response.status, body: await response.json() };
  };
  const writes = () => store.db.prepare("SELECT COUNT(*) AS count FROM pilot_reports").get().count;
  const worker = target => exec(process.execPath, [workerPath], {
    env: { ...process.env, PILOT_DATABASE: path, PILOT_TOKEN: token, PILOT_URL: target.url },
    timeout: 15000, windowsHide: true,
  });
  return { path, store, job, token, other, server, request, status, writes, start, worker };
}

test("pilot rejects unauthenticated, cross-agent and injected identity requests", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.request("invalid")).status, 401);
  assert.equal((await f.request(f.other)).status, 404);
  assert.equal((await f.request(f.token, { body: f.job.body, agent: "reporter" })).status, 400);
  assert.equal((await f.status(f.other)).code, 404);
  assert.equal(f.writes(), 0);
});

test("pilot route derives action/resource instead of trusting a mismatched grant", async t => {
  const f = await fixture(t);
  f.store.db.prepare("UPDATE agent_permission_grants SET resource='different' WHERE id=?").run(f.job.grant_id);
  assert.equal((await f.request()).status, 403);
  assert.equal(f.writes(), 0);
});

test("pilot refuses expired authority at destination", async t => {
  const f = await fixture(t);
  f.store.db.prepare("UPDATE agent_permission_grants SET expiresAt=0 WHERE id=?").run(f.job.grant_id);
  assert.equal((await f.request()).status, 403);
  assert.equal(f.writes(), 0);
});

test("pilot immutable operation IDs reject payload and identity reuse", async t => {
  const f = await fixture(t);
  assert.equal((await f.request(f.token, { body: "Changed draft" })).status, 409);
  assert.throws(() => f.store.enqueue(f.job.id, "reporter", "Changed draft"), /different content/);
  assert.throws(() => f.store.enqueue(f.job.id, "other-agent", f.job.body), /different content/);
  assert.throws(() => f.store.db.prepare("UPDATE pilot_jobs SET body='changed' WHERE id=?").run(f.job.id), /immutable/);
  assert.equal(f.writes(), 0);
});

test("pilot revocation after request receipt precedes and blocks destination commit", { timeout: 20000 }, async t => {
  const f = await fixture(t, "gate");
  const pending = f.request();
  await f.server.event("received");
  assert.equal(f.store.guard.revoke(f.job.grant_id), true);
  f.server.child.send("release");
  assert.equal((await pending).status, 403);
  assert.equal(f.writes(), 0);
});

test("pilot concurrent HTTP duplicates commit once and owner can reconcile after revoke", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.request()));
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(f.writes(), 1);
  f.store.guard.revoke(f.job.grant_id);
  assert.equal((await f.request()).status, 403);
  assert.equal((await f.status()).body.state, "committed");
  assert.equal((await f.status(f.other)).code, 404);
});

test("pilot competing dispatcher processes claim one job without duplicate effects", { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const results = await Promise.all([f.worker(f.server), f.worker(f.server)]);
  assert.deepEqual(results.map(result => result.stdout.trim()).sort(), ["done", "idle"]);
  assert.equal(f.writes(), 1);
  assert.equal(f.store.job(f.job.id).state, "done");
  assert.equal(f.store.job(f.job.id).attempts, 1);
});

test("pilot recovers crash after commit using persistent status, including after revocation", { timeout: 20000 }, async t => {
  const f = await fixture(t, "crash-after-commit");
  const exited = once(f.server.child, "exit");
  assert.equal((await f.worker(f.server)).stdout.trim(), "queued");
  assert.equal((await exited)[0], 86);
  assert.equal(f.writes(), 1);
  f.store.guard.revoke(f.job.grant_id);
  f.store.db.prepare("UPDATE pilot_jobs SET next_at=0 WHERE id=?").run(f.job.id);
  const restarted = await f.start();
  assert.equal((await f.status(f.token, restarted)).body.state, "committed");
  assert.equal((await f.worker(restarted)).stdout.trim(), "done");
  assert.equal(f.writes(), 1);
});

test("pilot expired lease can be reclaimed and stale completion is fenced", async t => {
  const f = await fixture(t);
  const claimed = f.store.claim(1000, 100);
  assert.ok(claimed);
  const restarted = new PilotStore(f.path);
  try {
    assert.equal(restarted.claim(1099, 100), undefined);
    const reclaimed = restarted.claim(1100, 100);
    assert.ok(reclaimed);
    assert.notEqual(reclaimed.lease_token, claimed.lease_token);
    assert.equal(f.store.finish(claimed, "done"), false);
    assert.equal(restarted.finish(reclaimed, "queued", "retry", 1100), true);
    assert.equal(f.store.job(f.job.id).attempts, 2);
  } finally { restarted.close(); }
});

test("pilot bounds retry budget and preserves uncertain outcome instead of assuming failure", async t => {
  const f = await fixture(t);
  await f.server.stop();
  assert.equal(await dispatchOnce(f.store, f.server.url, f.token, { timeoutMs: 100, maxAttempts: 1 }), "uncertain");
  assert.equal(f.store.job(f.job.id).state, "uncertain");
  assert.equal(f.store.claim(), undefined);
});

test("pilot dispatcher records a revoked uncommitted job as denied", async t => {
  const f = await fixture(t);
  f.store.guard.revoke(f.job.grant_id);
  assert.equal((await f.worker(f.server)).stdout.trim(), "denied");
  assert.equal(f.store.job(f.job.id).state, "denied");
  assert.equal(f.writes(), 0);
});
