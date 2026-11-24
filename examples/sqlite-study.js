import { sqliteTrial } from "./sqlite-trial.js";

const rows = [];
for (const waitState of ["paused", "queued", "awaiting_approval"]) {
  for (const revoked of [false, true]) {
    for (const strategy of ["schedule", "execution"]) {
      const { writes, decisions } = await sqliteTrial(waitState, strategy, revoked);
      rows.push({ waitState, revoked, strategy, decision: decisions[0], writes });
    }
  }
}
console.table(rows);
