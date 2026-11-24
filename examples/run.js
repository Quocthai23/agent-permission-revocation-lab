import { trial } from "./study.js";
const rows = [];
for (const scenario of ["pause","queue","approval"])
  for (const revoked of [false,true])
    for (const mode of ["snapshot","live"])
      rows.push({scenario, revoked, mode, writes:await trial(mode,scenario,revoked)});
console.table(rows);
