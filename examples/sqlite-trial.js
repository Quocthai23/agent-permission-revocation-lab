import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";

const worker = fileURLToPath(new URL("./sqlite-worker.js", import.meta.url));
const exec = promisify(execFile);

/** @param {string} state @param {string} strategy @param {boolean} revoked @param {number} [attempts] */
export async function sqliteTrial(state, strategy, revoked, attempts = 1) {
  const directory = await mkdtemp(join(tmpdir(), "agent-permission-"));
  const path = join(directory, "study.sqlite");
  const open = () => new DatabaseSync(path, { timeout: 5000 });
  try {
    const scheduler = open();
    try {
      const guard = new SqliteTaskGuard(scheduler);
      scheduler.exec(`
        CREATE TABLE demo_jobs (
          id TEXT PRIMARY KEY, state TEXT, strategy TEXT, grant_id TEXT,
          agent TEXT, task TEXT, action TEXT, resource TEXT
        );
        CREATE TABLE demo_writes (job_id TEXT PRIMARY KEY, resource TEXT NOT NULL);
      `);
      const scope = { agent: "reporter", task: "monthly-report", action: "write", resource: "draft" };
      const grant = guard.grant(scope, Date.now() + 60000);
      scheduler.prepare("INSERT INTO demo_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("job-1", state, strategy, grant, scope.agent, scope.task, scope.action, scope.resource);
      // Baseline records authorization at scheduling time.
      if (strategy === "schedule") guard.run(grant, scope, () => true);
    } finally {
      scheduler.close();
    }

    // The original scheduler connection is closed before intervening decisions.
    const coordinator = open();
    try {
      const guard = new SqliteTaskGuard(coordinator);
      if (revoked) {
        const row = coordinator.prepare("SELECT grant_id FROM demo_jobs WHERE id = ?").get("job-1");
        if (!row || typeof row.grant_id !== "string") throw new Error("Expected a persisted grant ID");
        const { grant_id } = row;
        guard.revoke(grant_id);
      }
      coordinator.prepare("UPDATE demo_jobs SET state = 'ready' WHERE id = ? AND state = ?")
        .run("job-1", state);
    } finally {
      coordinator.close();
    }

    const workers = await Promise.allSettled(Array.from({ length: attempts }, () =>
      exec(process.execPath, [worker, path, "job-1"], { timeout: 10000 })));
    const decisions = workers.map(result => {
      if (result.status === "rejected") throw result.reason;
      return result.value.stdout.trim();
    });
    const observer = open();
    try {
      const row = observer.prepare("SELECT COUNT(*) AS writes FROM demo_writes").get();
      if (!row || typeof row.writes !== "number") throw new Error("Expected a numeric write count");
      const { writes } = row;
      return { decisions, writes };
    } finally {
      observer.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
