# Agent Permission Revocation Lab

A TypeScript research prototype for checking an AI agent's current authority when a deferred operation resumes. It compares authorization at scheduling time with authorization at execution time, including SQLite transactions and a local HTTP destination.

**Status:** version 0.3.0, private research and integration pilot. Not published to npm and not ready for production deployment. The core has no runtime dependencies.

## Requirements

- Node.js 22.19.0 or later and npm.
- A local filesystem for the SQLite experiments.
- Python 3 only for the optional browser demo server below.

## Quick start

Run these commands from the project directory:

```sh
npm ci
npm run verify
npm run demo
npm run demo:sqlite
npm run demo:http
npm run demo:pilot
```

`npm run verify` builds the library, checks types and the public API baseline, runs tests, validates an installed package tarball and browser bundling, generates API documentation, and audits dependencies.

The demonstrations compare allowed operations with operations revoked before execution. The SQLite demonstration should record zero protected writes after revocation has committed. The HTTP demonstration also shows why a dispatcher-only check cannot prevent every operation already received by a destination.

`demo:pilot` runs authenticated receiver and dispatcher processes with persistent operation status, competing workers, and one allowed and one revoked operation. See [Pilot operation](docs/PILOT.md) for persistent operation and recovery. [Resend test-address integration](docs/RESEND.md) describes the separate provider adapter; live test-address submission and status retrieval have been verified with locally configured credentials.

## Usage

These imports work within this repository after building, or from a separately installed local tarball. This package is not available as a published npm release.

### In-memory authority

```ts
import { TaskGuard, type Scope } from "agent-permission-revocation-lab";

const guard = new TaskGuard();
const scope: Scope = {
  agent: "reporter",
  task: "monthly-report",
  action: "write",
  resource: "draft",
};
const grantId = guard.grant(scope, Date.now() + 60_000);
const result = guard.run(grantId, scope, () => "Draft created");
guard.revoke(grantId);
```

Trusted server code must derive the agent identity and scope from an authenticated session and the actual operation. Store the grant ID with a deferred job, then call `run()` at the execution boundary. Keep grant issuance, revocation, and callbacks under trusted application control.

`TaskGuard` stores grants in memory. Restarting the process discards them. Its decision applies when the callback starts; it does not cancel work already running. If preparation includes an `await`, place guarded execution after that preparation and immediately before the effect.

### Shared SQLite authority

```ts
import { DatabaseSync } from "node:sqlite";
import { SqliteTaskGuard } from "agent-permission-revocation-lab/sqlite";

const database = new DatabaseSync("study.sqlite", { timeout: 5000 });
try {
  database.exec("CREATE TABLE IF NOT EXISTS reports (body TEXT NOT NULL)");
  const guard = new SqliteTaskGuard(database);
  const scope = {
    agent: "reporter",
    task: "monthly-report",
    action: "write",
    resource: "draft",
  };
  const grantId = guard.grant(scope, Date.now() + 60_000);
  guard.run(grantId, scope, () => {
    database.prepare("INSERT INTO reports (body) VALUES (?)").run("Draft");
  });
} finally {
  database.close();
}
```

`SqliteTaskGuard.run()` uses `BEGIN IMMEDIATE` to check authority and perform synchronous writes on the same caller-owned connection in one transaction. Call it outside an existing transaction. Configure the connection timeout to bound lock waiting.

If revocation commits first, the protected operation is denied. If the operation obtains the write lock and passes its check first, it may commit before revocation can complete. The transaction covers only that SQLite connection's writes.

## Public API

The root entry point exports `TaskGuard` and the `Scope` type. The `/sqlite` entry point exports `SqliteTaskGuard`. Internal modules are excluded from the package exports map.

Both guards expose:

- `grant(scope, expiresAt): string`: issue an independent grant. Scope contains nonempty `agent`, `task`, `action`, and `resource` strings. The deadline must be a safe integer representing a future Unix timestamp in milliseconds.
- `revoke(id): boolean`: remove a grant; return `false` if it is already absent.
- `run(id, scope, operation): T`: verify current authority and return the callback result. Missing, expired, or mismatched grants are rejected before the callback runs.

The SQLite callback must return synchronously. Generate full TSDoc API documentation with `npm run docs`, then open `docs/api/index.html` locally.

## Guarantees and limitations

- Scope matching is exact. A grant authorizes only its specified agent, task, action, and resource.
- Expiry is checked at the authorization boundary, not continuously while a callback runs. Expired in-memory grants are removed when accessed; SQLite has no background expiry cleanup.
- SQLite checks and effects are atomic only when trusted callbacks write synchronously through the same connection and leave transaction control to the guard.
- Direct async SQLite callbacks are rejected before invocation, and Promise-like return values trigger rollback. Bound async functions, wrappers, timers, and microtasks can still schedule work outside the transaction. This is not a sandbox for agent-generated code.
- Grants do not replace authentication. HTTP cancellation, revocation, and rollback do not undo effects that have already committed.
- The HTTP experiment uses real loopback requests, but its destination effect is a simulated SQLite write. It does not establish revocation guarantees for email, third-party APIs, or independent distributed databases.

See [Research and evidence](docs/research/README.md) for experiment ordering, measured results, failure cases, and references.

## Browser demo

```sh
npm run build
python -m http.server 8000 --bind 127.0.0.1
```

Open <http://localhost:8000/examples/browser.html>. Issue a grant, revoke it, then resume the task to see the denial. The demo illustrates in-memory grant lifetime; it is not a server-side authorization boundary. Stop the server with Ctrl+C. On Windows, `py` can be used instead of `python` if available.

Run `npm run test:browser` to automate grant, execution, revocation and expiry in a real browser. On local Windows it uses installed Microsoft Edge; elsewhere install Playwright Chromium with `npx playwright install --with-deps --only-shell chromium`. `npm run verify:all` includes this check. No hosted StackBlitz or CodeSandbox project has been published or verified.

## Development and project status

Version 0.2.1 passed 49 behavioral tests on Windows; 0.3.0 adds multi-process pilot and Resend contract coverage. Ubuntu/WSL verification and a real Edge browser test have also been run locally. See [Research and evidence](docs/research/README.md) for the recorded environments, current results, and boundaries. GitHub Actions is configured for Windows/Linux and Node 22.19.0/24.x, including Chromium; remote Actions runs have not been verified.

- [Contributing and verification](CONTRIBUTING.md): commands, API compatibility checks, packaging checks, and the temporary TypeDoc compatibility patch.
- [Changelog](CHANGELOG.md): version history and compatibility policy.
- [Roadmap and release gates](docs/ROADMAP.md): the next implementation milestone and evidence required before deployment.

The first-party pilot and Resend test-address adapter are implemented. Live Resend test-address submission and delivered status retrieval are verified; additional provider failure cases remain pending; the remote CI workflow runs on pushes to the selected GitHub repository. Distribution remains private, and a license has not yet been selected. Completing the local pilot is not a production deployment or a publication decision.
