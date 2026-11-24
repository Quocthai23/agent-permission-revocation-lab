# Research and evidence

## Research question

Can a grant revoked while an AI agent's task is paused, queued, or awaiting approval prevent a later effect?

These controlled correctness experiments compare scheduling-time authorization with a fresh decision at execution. `writes` counts effects recorded at the simulated destination. They are not performance benchmarks or a general proof of distributed revocation.

## In-memory experiments

`examples/study.js` models a paused generator, an in-memory queue, and a Promise awaiting approval. Each runs with an active grant and with revocation before resumption.

With active grants, both strategies write successfully. After revocation, scheduling-time authorization still produces one write per scenario; execution-time checks produce zero. These examples use one process and simulated effects. Run `npm run demo` after building.

## SQLite across processes

`npm run demo:sqlite` persists a waiting job, closes the scheduler connection, preserves or revokes authority through a coordinator, and launches a separate worker process. All connections use the same local SQLite file. The three waiting states use the same persistence and transition mechanism.

With active grants, both strategies commit in all three scenarios. After revocation, scheduling-time authorization still permits writes in all three; checks inside the destination write transaction permit none.

`SqliteTaskGuard.run()` uses `BEGIN IMMEDIATE` to serialize the check and protected write. If revocation commits first, the worker is denied. If the worker obtains the lock and passes its check first, its operation may finish before revocation completes. A blocked revocation is not evidence that revocation has taken effect.

The duplicate-worker test uses a unique job ID at the destination. Applications must define operation identity; a grant does not itself provide deduplication.

## Async callback regression

A JavaScript caller could previously pass an async SQLite callback. The guard detected its Promise and rolled back, but the continuation after `await` could still insert a record after rollback.

The fix rejects directly recognizable async functions before invocation and retains Promise-like result checking. Tests verify that a rejected direct async callback never starts, no continuation escapes, and the connection remains usable. Expiry-at-deadline and caller-owned transaction tests cover other boundaries.

This is not a sandbox. Bound async functions, wrappers returning Promises, timers, and microtasks can schedule effects outside the transaction. Callbacks must be trusted, synchronous, and limited to writes through the protected connection.

## HTTP and outbox experiments

Run `npm run demo:http`. After building, export structured results with:

```sh
node examples/http-study.js --json
```

[http-results.json](http-results.json) contains the reference output with environment metadata, strategies, revocation timing, request counts, receiver decisions, client responses, and write counts.

### Setup and ordering

The scheduler issues a grant, inserts an outbox record inside a protected transaction, and closes its connection. The dispatcher reads the persisted job and sends a real HTTP POST to `127.0.0.1`.

The scheduler, dispatcher, revocation coordinator, and receiver use separate connections to one local SQLite file. HTTP roles run in one process. A fixed operation ID maps to a trusted stored scope and payload; client-supplied identity and arbitrary scope are not accepted.

Explicit request-received, release, and completion gates establish order. The in-flight case revokes after receipt but before the destination write. No sleep or inferred network delay establishes this ordering. HTTP calls never run inside SQLite guard callbacks.

### Strategies and observed results

- **Outbox only:** checks at outbox insertion. Revocation before dispatch or after receipt still allows one destination write.
- **Dispatcher check:** checks before POST. Revocation before dispatch produces zero requests and writes. Revocation after receipt still allows one write because the check and remote effect do not share a transaction.
- **Receiver atomic check:** checks authority and records the effect in one SQLite transaction. Revocation before dispatch or after receipt but before that transaction produces HTTP 403 and zero writes. Revocation after commit leaves the completed record intact.

All three succeed while authority remains valid. These account for 12 combinations: three strategies and four revocation timings, including no revocation.

### Delivery failure controls

- **Lost response and retry:** the receiver commits, then closes its socket before responding. Two later attempts with the same operation ID leave one record through a unique destination key. An accepted duplicate does not mean another record was inserted.
- **Lost response, revoke, then retry:** the first attempt committed. After revocation, the receiver checks authority before deduplication and denies replay with 403. The original record remains. A denied retry does not prove the operation never occurred.
- **Client abort after receipt:** the client cancels before the receiver is released to write. The client observes cancellation while the receiver still commits. Client cancellation is not a rollback or revocation protocol.

These cases run in `test/http.test.js`, alongside input validation coverage.

## Interpretation and boundaries

The [AWS transactional outbox guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html) describes atomic local intent recording and the need for idempotent consumers. An outbox entry does not establish continuing authority or eliminate duplicate delivery.

The POST experiments use stable operation IDs and destination deduplication. Arbitrary POST requests cannot be assumed safe to retry. [RFC 9110 section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) describes retry conditions for non-idempotent requests.

The receiver depends on [SQLite write transaction ordering](https://www.sqlite.org/lang_transaction.html). `BEGIN IMMEDIATE` opens a write transaction and may fail with `SQLITE_BUSY` if another writer is active. The demonstrated guarantee is that committed revocation preceding the protected receiver transaction prevents the write. This is an inference within the tested model, not a distributed transaction across independent services.

HTTP transport is real, but effects are simulated SQLite records. These experiments do not test email, providers, multiple hosts, clock skew, machine failure, competing dispatchers, or independent destination databases. There is no production authentication/TLS layer, claim/lease protocol, retry backoff, dead-letter queue, or operation status API.

For external providers, distinguish outbox insertion, provider acceptance, and the final effect. A pre-send check cannot enforce authority atomically with a later independent effect. Stronger guarantees require a provider-supported atomic authorization boundary or documented cancellation protocol. Idempotency support applies within its stated scope and retention window; it does not revoke authority or undo delivered email.

## Recorded quality verification

On 2026-11-24, full verification passed locally on Windows x64 with Node.js 22.19.0 and 24.22.2:

- 49 of 49 behavioral tests passed on each version.
- Public type contracts, HTTP static checks, and the declaration baseline passed.
- Independently installed tarballs passed runtime, types, exports, and esbuild checks.
- Documentation generation passed, including the temporary TypeDoc compatibility patch.
- Audit reported zero known dependency vulnerabilities at that time.

The Node 22.19.0 run followed a clean `npm ci`, exercising patch reapplication. The minified core measured 1,203 bytes. The unused-import consumer measured 23 bytes from its console statement, with zero library bytes contributed. These are not gzipped sizes or performance measurements.

Those statements describe version 0.2.1. The 0.3.0 extension implements the [authenticated multi-process pilot](../PILOT.md), [Resend test-address adapter](../RESEND.md), and real-browser checks. See [Contributing](../../CONTRIBUTING.md) for reproduction and [Roadmap](../ROADMAP.md) for remaining release gates.

## Version 0.3.0 verification - 2026-11-24

The complete `npm run verify` pipeline passed on Windows x64 and Ubuntu 24.04.2/WSL Linux x64 with both Node.js 22.19.0 and 24.22.2. Each environment passed 67 behavioral tests: 49 earlier tests, 11 authenticated pilot tests, and 7 Resend injected-transport contract tests. All example JavaScript files passed strict checkJs checking; the pilot passed strict TypeScript compilation. The original library declaration baseline remained unchanged.

Each run also passed tarball installation, runtime/type/exports isolation and esbuild checks, documentation generation, and dependency audit with zero known vulnerabilities at run time. Linux runs installed Node and dependencies independently in temporary Linux checkouts after SHA-256 verification of the official Node archive. They did not reuse Windows node_modules. Their logs are retained locally as `artifacts/verify-linux-node22.log` and `artifacts/verify-linux-node24.log`; these generated artifacts are not included in the npm package.

On Windows, `npm run verify:all` additionally passed real Microsoft Edge 159.0.4402.13 headless testing on both Node versions. The browser test exercised actual page loading, grant issuance, permitted execution, revocation denial and exact-deadline expiry, with no page errors. A screenshot is retained locally at `artifacts/browser-demo.png`.

The same browser test also passed on Ubuntu/WSL with real Chromium Headless Shell 159.0.8154.6 and Node.js 24.22.2, with no page errors. The browser was installed under the temporary Linux workspace; no system packages were installed or replaced. The Linux temporary screenshot was not retained after that WSL instance exited. The reproduction scripts now copy future screenshots into the checkout before exit. Run `sh scripts/verify-wsl.sh 24.22.2 --browser` from WSL to keep verification and browser execution in one invocation.

The local pipeline results above do not represent live provider or remote Actions execution. Subsequent live Resend and remote CI evidence is recorded separately below. Provider tests use injected transports; they deliberately demonstrate the post-check revocation gap rather than claiming atomic remote enforcement.


## Live Resend test - 2026-11-24

An authorized live request sent the fixed sandbox payload from onboarding@resend.dev to delivered@resend.dev. Resend returned accepted with email ID 01a20e29-b27d-74c0-9217-11a2f9a22664. A subsequent GET returned last_event=delivered. This is a provider test-address event, not delivery to a real user. No live duplicate submission, cancellation, or provider failure injection was performed. Credentials remain only in the ignored local .env file and are excluded from this evidence. This result supersedes the earlier missing-credentials status.


## Remote GitHub Actions evidence - 2026-11-24

The owner supplied a GitHub screenshot showing Verify #1, triggered via pull_request, at commit f4492ca. Overall status is Success, duration 5m 36s, with four artifacts. All four jobs succeeded: ubuntu-latest with Node 24.x (1m 10s) and 22.19.0 (1m 7s), and windows-latest with Node 22.19.0 (5m 32s) and 24.x (3m 21s). This records screenshot evidence supplied by the owner; individual remote logs were not independently retrieved. It applies to f4492ca, not subsequent documentation commits or every possible environment.
