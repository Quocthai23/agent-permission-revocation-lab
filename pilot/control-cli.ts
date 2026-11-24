import { PilotStore } from "./store.js";

const path = process.env.PILOT_DATABASE;
if (!path) throw new Error("set PILOT_DATABASE to a local SQLite path");
const [command, id, agent, body] = process.argv.slice(2);
if (!id || !["enqueue", "status", "revoke"].includes(command))
  throw new Error("usage: control-cli.js enqueue <id> <agent> <body> | status <id> | revoke <id>");
const store = new PilotStore(path);
try {
  if (command === "enqueue") {
    if (!agent || !body) throw new Error("enqueue requires agent and body");
    const job = store.enqueue(id, agent, body);
    console.log(JSON.stringify({ id: job.id, state: job.state }));
  } else {
    const job = store.job(id);
    if (!job) throw new Error("operation not found");
    if (command === "revoke") console.log(JSON.stringify({ revoked: store.guard.revoke(job.grant_id) }));
    else console.log(JSON.stringify({ id, delivery: job.state, attempts: job.attempts, receipt: store.status(id, job.agent) }));
  }
} finally { store.close(); }
