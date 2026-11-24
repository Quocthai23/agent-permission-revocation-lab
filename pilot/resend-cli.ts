import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
import { ResendStudy } from "./resend.js";

const { RESEND_API_KEY, RESEND_FROM, RESEND_OPERATION_ID, RESEND_GRANT_ID } = process.env;
if (!RESEND_API_KEY || !RESEND_FROM || !RESEND_OPERATION_ID)
  throw new Error("set RESEND_API_KEY, RESEND_FROM and a stable RESEND_OPERATION_ID in your local environment");
const database = new DatabaseSync(process.env.PILOT_DATABASE ?? "resend-study.sqlite", { timeout: 5000 });
try {
  const adapter = new ResendStudy(database, RESEND_API_KEY);
  const agent = "resend-study";
  const id = RESEND_OPERATION_ID;
  const email = { from: RESEND_FROM, to: "delivered@resend.dev", subject: "Permission revocation lab", text: "Sandbox test only." };
  if (process.argv.includes("--status")) console.log(JSON.stringify(await adapter.retrieve(id, agent)));
  else {
    // Reuse the persisted grant rather than issuing new authority on every retry.
    const guard = new SqliteTaskGuard(database);
    const previous = adapter.row(id);
    if (process.argv.includes("--revoke") && !previous && !RESEND_GRANT_ID)
      throw new Error("no existing grant to revoke; do not create a new operation ID");
    const grantId = previous?.grant_id ?? RESEND_GRANT_ID ?? guard.grant({
      agent, task: id, action: "send", resource: `email/${email.to}`,
    }, Date.now() + 60_000);
    if (process.argv.includes("--revoke")) {
      console.log(JSON.stringify({ revoked: guard.revoke(grantId) }));
    } else console.log(JSON.stringify(await adapter.submit(id, grantId, agent, email)));
  }
} finally { database.close(); }
