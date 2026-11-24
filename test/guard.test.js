import test from "node:test";
import assert from "node:assert/strict";
import { TaskGuard } from "agent-permission-revocation-lab";
const scope = {agent:"a",task:"t",action:"read",resource:"one"};
test("scope binding, validation and repeat revocation", () => {
  const guard = new TaskGuard();
  const original = {...scope};
  const id = guard.grant(original, Date.now()+60000);
  original.resource = "two";
  for (const field of Object.keys(scope))
    assert.throws(() => guard.run(id,{...scope,[field]:"different"},assert.fail), /Scope mismatch/);
  assert.equal(guard.run(id,scope,()=>42),42);
  assert.throws(()=>guard.grant({...scope,task:""},Infinity),/task/);
  assert.throws(()=>guard.grant(scope,NaN),/expiresAt/);
  assert.equal(guard.revoke(id),true);
  assert.equal(guard.revoke(id),false);
});
test("expiry boundary", t => {
  t.mock.timers.enable({apis:["Date"],now:1000});
  const guard = new TaskGuard();
  const id = guard.grant(scope,1010);
  t.mock.timers.tick(10);
  assert.throws(()=>guard.run(id,scope,assert.fail),/expired/);
});

test("scope errors identify mismatched fields without disclosing their values", () => {
  const guard = new TaskGuard();
  const id = guard.grant(scope, Date.now() + 60000);
  assert.throws(() => guard.run(id, {
    ...scope, agent: "private-agent-identity", resource: "private-resource-name",
  }, assert.fail), error => {
    assert.match(error.message, /Scope mismatch: scope.agent, scope.resource/);
    assert.match(error.message, /authenticated operation scope/);
    assert.ok(!error.message.includes("private-agent-identity"));
    assert.ok(!error.message.includes("private-resource-name"));
    return true;
  });
  // A denied attempt must not invalidate an otherwise valid grant.
  assert.equal(guard.run(id, scope, () => 42), 42);
});
