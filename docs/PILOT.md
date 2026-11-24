# Authenticated receiver pilot

## Scope

The 0.3.0 pilot runs the receiver and dispatcher in separate processes. Authority, outbox entries, receipts, and simulated report writes share one local SQLite file. The receiver binds only to `127.0.0.1`; bearer tokens authenticate preconfigured agent identities. This is a controlled local integration, not a production identity service or a distributed transaction across independent databases.

Pilot modules are TypeScript under `pilot/` and compile to the ignored `.pilot/` directory. They are not added to the library's public exports or packaged as a supported HTTP server.

## Run the self-contained demonstration

```sh
npm ci
npm run demo:pilot
```

The demo generates an ephemeral credential, starts a receiver, launches competing dispatcher processes, processes an authorized job and a revoked job, prints their persisted statuses, and shuts down. Expected results are one report write, an authorized job marked `done`, and a revoked job marked `denied`. Temporary credentials and the database are removed with the temporary directory.

## Operate a persistent local pilot

Build with `npm run build`. Configure the following variables in your local environment or an ignored `.env` file, using the same database and credentials for all processes:

- `PILOT_DATABASE`: absolute path to the local SQLite file.
- `PILOT_IDENTITIES`: JSON mapping strong tokens to agent IDs, for example a locally generated 64-character hexadecimal token mapped to `reporter`. Each token must contain at least 32 characters. Generate one with `node -p "require('node:crypto').randomBytes(32).toString('hex')"` and keep it local.
- `PILOT_TOKEN`: one of those tokens, used by the dispatcher.
- `PILOT_URL`: the loopback URL printed by the receiver after it starts.

Use a dedicated queue/database for the dispatcher's configured identity. A receiver can authenticate several owners, but a worker is not a tenant-routing service. The SQLite file, environment and local shell are trusted administrative boundaries.

In a terminal with that configuration:

```sh
node --env-file=.env .pilot/control-cli.js enqueue report-1 reporter "Monthly draft"
node --env-file=.env .pilot/receiver-cli.js
```

The receiver prints its dynamically allocated URL. Set `PILOT_URL` to that URL in the worker's environment or `.env`, then use a second terminal:

```sh
node --env-file=.env .pilot/worker-cli.js
node --env-file=.env .pilot/control-cli.js status report-1
```

The worker processes at most one eligible job per invocation. A trusted local scheduler may invoke it repeatedly; it is not a permanently installed service. To revoke before dispatch:

```sh
node --env-file=.env .pilot/control-cli.js revoke report-1
```

The control CLI is an administrative interface. It can issue and revoke grants because access to the database and shell is already trusted. These operations are intentionally absent from the HTTP API. The default grant lifetime for newly enqueued jobs is 60 seconds. Re-enqueueing the same operation does not refresh or replace its authority.

## HTTP contract

All requests require `Authorization: Bearer <token>`. Responses are JSON with `Cache-Control: no-store`.

- `POST /operations/<id>` accepts exactly `{ "body": "..." }` with `Content-Type: application/json`. IDs contain 1-100 letters, digits, hyphens or underscores. The body must equal the trusted scheduled payload. Task, action and resource come from the route and stored operation; agent identity comes from the token. Extra identity/scope fields are rejected.
- `GET /operations/<id>` returns the owner's receipt status and commit timestamp when available, without returning the payload. Other agents receive 404; invalid credentials receive 401. Only the authenticated original owner may read this historical status, including after grant revocation or expiry.

A revoked POST returns 403 even if the same operation committed earlier. Therefore use GET to reconcile a lost response. `committed` is persistent evidence of the effect. `not_committed` describes the observation at lookup time; it is not a guarantee that an in-flight request cannot commit later.

## Persistence and recovery

An operation ID permanently binds agent, grant, scope and body. Reusing it with different content is rejected; an SQLite trigger also prevents updating those identity fields. The destination writes its receipt and report in one protected transaction, with a unique operation ID.

Dispatchers claim jobs using `BEGIN IMMEDIATE`. A claim increments a persisted attempt counter and assigns an expiring lease with a random fencing token. An expired lease can be reclaimed. A stale worker cannot complete a newer worker's claim; duplicate HTTP sends are still controlled by destination deduplication.

Each attempt reads destination status before sending. Defaults are a 1-second request timeout, a 10-second lease, and four attempts. Retry scheduling uses bounded exponential backoff. If a response is ambiguous, a job becomes `queued` for reconciliation, or `uncertain` after its retry budget is exhausted. A known current-authority rejection with no committed receipt becomes `denied`. A reconciled receipt or successful POST becomes `done`.

Do not interpret `uncertain` as a failed effect or create a new operation ID merely to bypass the retry budget. Inspect receipt status and process health first. No automated dead-letter replay or external service manager is included. Local process restarts retain authority and receipts; deleting the database discards them.

## Fault tests

`test/pilot.test.js` verifies authentication, ownership, scope derivation, expiry, immutable payloads, revocation after receipt, concurrent duplicates, competing dispatcher processes, stale lease fencing, bounded retries, and receiver death after commit followed by restart and reconciliation after revocation.

Crash and request-gate hooks are enabled only in IPC test processes. There is no HTTP endpoint or request header for activating them. All effects in these tests are simulated report writes; no provider is contacted.
