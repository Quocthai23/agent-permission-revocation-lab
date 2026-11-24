import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";
import { ResendStudy } from "../.pilot/resend.js";

const email = { from: "Lab <test@example.com>", to: "delivered@resend.dev", subject: "Test", text: "Sandbox only" };
function fixture(t, transport) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const guard = new SqliteTaskGuard(db);
  const grant = guard.grant({ agent: "reporter", task: "email-1", action: "send", resource: `email/${email.to}` }, Date.now() + 60000);
  const study = new ResendStudy(db, "fake-contract-test-key", transport);
  return { db, guard, grant, study, send: (message = email) => study.submit("email-1", grant, "reporter", message) };
}

test("Resend contract blocks non-test addresses and revoked authority before transport", async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return Response.json({ id: "email-id" }); });
  await assert.rejects(f.send({ ...email, to: "real@example.com" }), /test addresses/);
  f.guard.revoke(f.grant);
  await assert.rejects(f.send(), /Grant unavailable/);
  assert.equal(calls, 0);
});

test("Resend contract retries lost response with identical payload/key and binds ID", async t => {
  const sent = [];
  const f = fixture(t, async (url, init) => {
    sent.push({ url, key: init.headers["Idempotency-Key"], body: init.body });
    if (sent.length === 1) throw new Error("response lost after acceptance");
    return Response.json({ id: "provider-id" });
  });
  assert.deepEqual(await f.send(), { state: "uncertain" });
  assert.deepEqual(await f.send(), { state: "accepted", providerId: "provider-id" });
  assert.deepEqual(sent[0], sent[1]);
  await assert.rejects(f.send({ ...email, text: "changed" }), /already binds/);
  f.guard.revoke(f.grant);
  assert.equal((await f.send()).state, "accepted");
  assert.equal(sent.length, 2);
});

test("Resend contract preserves uncertainty after revoke, instead of retrying remote send", async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; throw new Error("lost response"); });
  assert.equal((await f.send()).state, "uncertain");
  f.guard.revoke(f.grant);
  await assert.rejects(f.send(), /Grant unavailable/);
  assert.equal(f.study.row("email-1").state, "uncertain");
  assert.equal(calls, 1);
});

test("Resend contract stops retries before provider key expiry", async t => {
  const f = fixture(t, async () => { throw new Error("lost"); });
  await f.send();
  f.db.prepare("UPDATE pilot_resend SET first_at=? WHERE id='email-1'").run(Date.now() - 23 * 60 * 60 * 1000);
  await assert.rejects(f.send(), /retry window/);
});

test("Resend contract demonstrates post-check revocation cannot stop provider acceptance", async t => {
  let f;
  f = fixture(t, async () => {
    f.guard.revoke(f.grant);
    return Response.json({ id: "accepted-after-revocation" });
  });
  assert.equal((await f.send()).providerId, "accepted-after-revocation");
});

test("Resend contract retrieves accepted status by provider ID for the owner", async t => {
  const urls = [];
  const f = fixture(t, async url => {
    urls.push(url);
    return Response.json(url.endsWith("/emails") ? { id: "provider-id" } : { id: "provider-id", last_event: "delivered" });
  });
  await f.send();
  await assert.rejects(f.study.retrieve("email-1", "other-agent"), /not found/);
  assert.equal((await f.study.retrieve("email-1", "reporter")).last_event, "delivered");
  assert.equal(urls[1], "https://api.resend.com/emails/provider-id");
});

test("Resend contract fences a stale attempt from overwriting a later accepted result", async t => {
  const pending = Promise.withResolvers();
  let calls = 0;
  const f = fixture(t, async () => {
    calls++;
    if (calls === 1) return pending.promise;
    return Response.json({ id: "provider-id" });
  });
  const first = f.send();
  await assert.rejects(f.send(), /being submitted/);
  // Simulate lease expiry without waiting; destination idempotency uses the same key.
  f.db.prepare("UPDATE pilot_resend SET lease_until=0 WHERE id='email-1'").run();
  assert.equal((await f.send()).state, "accepted");
  pending.resolve(Response.json({ error: "stale error" }, { status: 500 }));
  assert.equal((await first).state, "accepted");
  assert.equal(f.study.row("email-1").provider_id, "provider-id");
});
