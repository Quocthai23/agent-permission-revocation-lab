import test from "node:test";
import assert from "node:assert/strict";
import { trial } from "../examples/study.js";
for (const scenario of ["pause","queue","approval"])
  for (const revoked of [false,true])
    for (const mode of ["snapshot","live"])
      test([scenario,mode,revoked].join("/"), async () =>
        assert.equal(await trial(mode,scenario,revoked), Number(!revoked || mode === "snapshot")));
