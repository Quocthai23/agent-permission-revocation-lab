import { fork, execFile, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PilotStore } from "./store.js";

const directory = await mkdtemp(join(tmpdir(), "permission-pilot-demo-"));
const path = join(directory, "pilot.sqlite");
const token = randomBytes(32).toString("hex");
const store = new PilotStore(path);
let child: ChildProcess | undefined;
try {
  const active = store.enqueue("allowed", "reporter", "Authorized draft");
  const revoked = store.enqueue("revoked", "reporter", "Revoked draft");
  store.guard.revoke(revoked.grant_id);
  child = fork(fileURLToPath(new URL("./receiver-cli.js", import.meta.url)), [], {
    env: { ...process.env, PILOT_DATABASE: path, PILOT_IDENTITIES: JSON.stringify({ [token]: "reporter" }) },
    stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true,
  });
  const message = await new Promise<{ url: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("receiver startup timeout")), 10000);
    child!.once("message", value => { clearTimeout(timer); resolve(value as { url: string }); });
    child!.once("exit", () => { clearTimeout(timer); reject(new Error("receiver exited during startup")); });
  });
  const exec = promisify(execFile);
  const worker = () => exec(process.execPath, [fileURLToPath(new URL("./worker-cli.js", import.meta.url))], {
    env: { ...process.env, PILOT_DATABASE: path, PILOT_URL: message.url, PILOT_TOKEN: token },
    timeout: 15000, windowsHide: true,
  });
  const dispatch = await Promise.all([worker(), worker()]);
  // A claim race may leave one worker idle; drain again until both jobs are terminal.
  for (let remaining = 0; remaining < 2; remaining++) await worker();
  console.log(JSON.stringify({
    transport: "authenticated HTTP; separate receiver and dispatcher processes; shared local SQLite",
    decisions: dispatch.map(result => result.stdout.trim()),
    jobs: [active.id, revoked.id].map(id => ({ id, delivery: store.job(id)!.state, receipt: store.status(id, "reporter") })),
    writes: Number(store.db.prepare("SELECT COUNT(*) AS count FROM pilot_reports").get()!.count),
  }, null, 2));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, "exit"); child.kill(); await stopped;
  }
  store.close(); await rm(directory, { recursive: true, force: true });
}
