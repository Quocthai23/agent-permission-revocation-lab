import { TaskGuard } from "agent-permission-revocation-lab";

/** @param {string} mode @param {string} scenario @param {boolean} revoked */
export async function trial(mode, scenario, revoked) {
  const guard = new TaskGuard();
  const scope = { agent:"reporter", task:"november", action:"write", resource:"draft-1" };
  const id = guard.grant(scope, Date.now() + 60000);
  /** @type {string[]} */
  const destination = [];
  const commit = () => destination.push(scope.resource);
  // Baseline records authorization at scheduling time.
  if (mode === "snapshot") guard.run(id, scope, () => true);
  const execute = () => mode === "snapshot" ? commit() : guard.run(id, scope, commit);
  const wait = () => { if (revoked) guard.revoke(id); };
  try {
    if (scenario === "queue") {
      const queue = [execute];
      wait();
      queue.shift()?.();
    } else if (scenario === "approval") {
      /** @type {PromiseWithResolvers<boolean>} */
      const approval = Promise.withResolvers();
      const pending = approval.promise.then(accepted => { if (accepted) execute(); });
      wait();
      approval.resolve(true);
      await pending;
    } else {
      function* workflow() { yield; execute(); }
      const job = workflow();
      job.next();
      wait();
      job.next();
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Grant unavailable") throw error;
  }
  return destination.length;
}
