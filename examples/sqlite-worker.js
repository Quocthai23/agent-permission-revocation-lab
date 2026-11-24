import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";

const [path, id] = process.argv.slice(2);
if (!path || !id) throw new Error("Pass a SQLite path and job ID");
const database = new DatabaseSync(path, { timeout: 5000 });
try {
  const guard = new SqliteTaskGuard(database);
  const job = database.prepare(
    "SELECT * FROM demo_jobs WHERE id = ? AND state = 'ready'"
  ).get(id);
  if (!job) throw new Error("Job is not ready");
  if (typeof job.grant_id !== "string" || typeof job.agent !== "string" || typeof job.task !== "string" ||
      typeof job.action !== "string" || typeof job.resource !== "string") throw new Error("Invalid persisted scope");
  const grantId = job.grant_id;
  const scope = { agent: job.agent, task: job.task, action: job.action, resource: job.resource };
  const write = () => database.prepare(
    "INSERT INTO demo_writes (job_id, resource) VALUES (?, ?) ON CONFLICT(job_id) DO NOTHING"
  ).run(job.id, job.resource);
  try {
    if (job.strategy === "schedule") write();
    else guard.run(grantId, scope, write);
    console.log("allowed");
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Grant unavailable") throw error;
    console.log("denied");
  }
} finally {
  database.close();
}
