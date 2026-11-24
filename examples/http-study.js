import { httpTrial } from "./http-trial.js";

/** @type {(Awaited<ReturnType<typeof httpTrial>> & {strategy: string, revokeAt?: string, scenario?: string})[]} */
const rows = [];
/** @type {NonNullable<import("./http-trial.js").HttpTrialOptions["strategy"]>[]} */
const strategies = ["outbox-only", "dispatch-check", "receiver-atomic"];
/** @type {NonNullable<import("./http-trial.js").HttpTrialOptions["revokeAt"]>[]} */
const timings = ["never", "before-dispatch", "in-flight", "after-commit"];
for (const strategy of strategies) {
  for (const revokeAt of timings) {
    rows.push({ strategy, revokeAt, ...await httpTrial({ strategy, revokeAt }) });
  }
}
/** @type {[string, import("./http-trial.js").HttpTrialOptions][]} */
const scenarios = [
  ["response lost then retry", { loseFirstResponse: true, attempts: 3 }],
  ["response lost then revoke", { loseFirstResponse: true, attempts: 2, revokeAt: "after-commit" }],
  ["client abort after receipt", { abortInFlight: true }],
];
for (const [scenario, options] of scenarios)
  rows.push({ strategy: "receiver-atomic", scenario, ...await httpTrial(options) });
if (process.argv.includes("--json")) console.log(JSON.stringify({
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  transport: "HTTP on 127.0.0.1; separate SQLite connections sharing one local file",
  ordering: "Explicit request-received/release/commit gates; no timing sleeps",
  rows,
}, null, 2));
else console.table(rows.map(row => ({ ...row, decisions: row.decisions.join(","), responses: row.responses.join(",") })));
