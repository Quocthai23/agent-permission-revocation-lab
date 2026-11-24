import test from "node:test";
import assert from "node:assert/strict";
import { httpTrial } from "../examples/http-trial.js";

for (const strategy of ["outbox-only", "dispatch-check", "receiver-atomic"]) {
  for (const revokeAt of ["never", "before-dispatch", "in-flight", "after-commit"]) {
    test(`HTTP / ${strategy} / revoke=${revokeAt}`, { timeout: 10000 }, async () => {
      const result = await httpTrial({ strategy, revokeAt });
      const blockedAtDispatcher = strategy === "dispatch-check" && revokeAt === "before-dispatch";
      const blockedAtSink = strategy === "receiver-atomic" &&
        ["before-dispatch", "in-flight"].includes(revokeAt);
      assert.deepEqual(result, {
        requests: blockedAtDispatcher ? 0 : 1,
        decisions: blockedAtDispatcher ? [] : [blockedAtSink ? "denied" : "committed"],
        responses: [blockedAtDispatcher ? "dispatch-denied" : blockedAtSink ? 403 : 200],
        writes: blockedAtDispatcher || blockedAtSink ? 0 : 1,
      });
    });
  }
}

test("HTTP retry after lost response commits the operation only once", { timeout: 10000 }, async () => {
  assert.deepEqual(await httpTrial({ loseFirstResponse: true, attempts: 3 }), {
    requests: 3, decisions: ["committed", "committed", "committed"],
    responses: ["response-lost", 200, 200], writes: 1,
  });
});

test("HTTP replay after revocation checks authority before deduplication", { timeout: 10000 }, async () => {
  assert.deepEqual(await httpTrial({ loseFirstResponse: true, attempts: 2, revokeAt: "after-commit" }), {
    requests: 2, decisions: ["committed", "denied"], responses: ["response-lost", 403], writes: 1,
  });
});

test("aborting HTTP after receipt does not undo the receiver effect", { timeout: 10000 }, async () => {
  assert.deepEqual(await httpTrial({ abortInFlight: true }), {
    requests: 1, decisions: ["committed"], responses: ["aborted"], writes: 1,
  });
});

test("HTTP trial rejects ambiguous boolean input instead of enabling fault injection", async () => {
  for (const field of ["loseFirstResponse", "abortInFlight"]) {
    await assert.rejects(httpTrial({ [field]: "false" }), {
      name: "TypeError", message: `${field} must be a boolean; use true or false`,
    });
  }
  await assert.rejects(httpTrial(null), /options must be an object/);
});
