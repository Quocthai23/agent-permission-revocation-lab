import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
import { sqliteTrial } from "../examples/sqlite-trial.js";

for (const waitState of ["paused", "queued", "awaiting_approval"]) {
  for (const revoked of [false, true]) {
    for (const strategy of ["schedule", "execution"]) {
      test(`SQLite / ${waitState} / ${strategy} / revoked=${revoked}`, async () => {
        const allowed = !revoked || strategy === "schedule";
        assert.deepEqual(await sqliteTrial(waitState, strategy, revoked), {
          decisions: [allowed ? "allowed" : "denied"],
          writes: Number(allowed),
        });
      });
    }
  }
}

test("two worker attempts commit a single record for the same job", async () => {
  assert.deepEqual(await sqliteTrial("queued", "execution", false, 2), {
    decisions: ["allowed", "allowed"],
    writes: 1,
  });
});

test("scope mismatch and failed writes leave no SQLite record", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const guard = new SqliteTaskGuard(db);
    db.exec("CREATE TABLE side_effects (value TEXT)");
    const scope = { agent: "agent-1", task: "task-1", action: "write", resource: "report" };
    const grant = guard.grant(scope, Date.now() + 60000);
    assert.throws(() => guard.run(grant, { ...scope, resource: "other" }, assert.fail), /Scope mismatch/);
    assert.throws(() => guard.run(grant, scope, () => {
      db.exec("INSERT INTO side_effects VALUES ('partial')");
      throw new Error("Effect failed");
    }), /Effect failed/);
    assert.deepEqual(db.prepare("SELECT value FROM side_effects").all(), []);
    assert.throws(() => guard.run(grant, scope, () => Promise.resolve()), /synchronous result/);
    assert.equal(guard.run(grant, scope, () => 42), 42);
    assert.equal(guard.revoke(grant), true);
    assert.equal(guard.revoke(grant), false);
    assert.throws(() => guard.run(grant, scope, assert.fail), /Grant unavailable/);
  } finally {
    db.close();
  }
});

test("a held write lock blocks concurrent revocation until commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-permission-lock-"));
  try {
    const path = join(directory, "test.sqlite");
    const first = new DatabaseSync(path);
    try {
      const second = new DatabaseSync(path, { timeout: 0 });
      try {
        const worker = new SqliteTaskGuard(first);
        const coordinator = new SqliteTaskGuard(second);
        const scope = { agent: "agent-1", task: "task-1", action: "write", resource: "report" };
        const grant = worker.grant(scope, Date.now() + 60000);
        first.exec("CREATE TABLE effects (value TEXT)");
        worker.run(grant, scope, () => {
          assert.throws(() => coordinator.revoke(grant), /database is locked/);
          first.exec("INSERT INTO effects VALUES ('committed before revocation')");
        });
        assert.equal(coordinator.revoke(grant), true);
        assert.throws(() => worker.run(grant, scope, assert.fail), /Grant unavailable/);
        assert.equal(second.prepare("SELECT COUNT(*) AS count FROM effects").get().count, 1);
      } finally {
        second.close();
      }
    } finally {
      first.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("async callbacks are rejected before their continuation can escape rollback", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const guard = new SqliteTaskGuard(db);
    const scope = { agent: "a", task: "t", action: "write", resource: "r" };
    const id = guard.grant(scope, Date.now() + 60000);
    db.exec("CREATE TABLE effects (value TEXT)");
    let entered = false;
    const operation = async () => {
      entered = true;
      await Promise.resolve();
      db.exec("INSERT INTO effects VALUES ('escaped')");
    };
    for (const callback of [operation]) {
      assert.throws(() => guard.run(id, scope, callback), /synchronous function/);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(entered, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM effects").get().count, 0);
    assert.equal(db.isTransaction, false);
    assert.equal(guard.run(id, scope, () => 42), 42);
  } finally {
    db.close();
  }
});

test("SQLite rejects expired grants at the exact deadline", t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const db = new DatabaseSync(":memory:");
  try {
    const guard = new SqliteTaskGuard(db);
    const scope = { agent: "a", task: "t", action: "write", resource: "r" };
    const id = guard.grant(scope, 1010);
    t.mock.timers.tick(10);
    assert.throws(() => guard.run(id, scope, assert.fail), /Grant expired/);
    assert.equal(db.isTransaction, false);
  } finally {
    db.close();
  }
});

test("nested run leaves the caller transaction under caller control", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const guard = new SqliteTaskGuard(db);
    const scope = { agent: "a", task: "t", action: "write", resource: "r" };
    const id = guard.grant(scope, Date.now() + 60000);
    db.exec("CREATE TABLE effects (value TEXT); BEGIN; INSERT INTO effects VALUES ('outer')");
    assert.throws(() => guard.run(id, scope, assert.fail), /transaction/i);
    assert.equal(db.isTransaction, true);
    db.exec("COMMIT");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM effects").get().count, 1);
  } finally {
    db.close();
  }
});
