# 0.4.0-alpha.1 - Public experimental preview

## What this release provides

- A small TypeScript-first, ESM library for execution-time authorization.
- In-memory grants and a SQLite adapter with atomic permission checks and local writes.
- Reproducible pause, queue, approval, HTTP and authenticated multi-process demonstrations.
- Recovery experiments for lost responses, duplicate requests and stale worker leases.
- MIT licensing and no runtime dependencies.

The core public declarations are unchanged from 0.3.0. The version opens the public alpha series; it does not add stronger distributed security guarantees.

## Try without any account or API key

```sh
git clone https://github.com/Quocthai23/agent-permission-revocation-lab.git
cd agent-permission-revocation-lab
git checkout v0.4.0-alpha.1
npm ci
npm run demo:http
npm run demo:pilot
```

The pilot should write one allowed report and deny the revoked report. The HTTP study contrasts outbox-only, dispatcher-only and receiver-atomic checks. Resend is optional and requires local credentials; it is not needed to evaluate the main experiment.

## Install the release tarball

The GitHub release includes an npm-installable tarball and SHA-256 checksums. Install its downloaded `.tgz` with `npm install ./agent-permission-revocation-lab-0.4.0-alpha.1.tgz` in a separate project. It contains the library, license and guides; experiments run from the source checkout.

The npm registry release is pending publisher login. No registry installation command is advertised as working until publication is confirmed. Once authenticated, run `npm run verify:all` and `npm publish --tag next --access public` from the reviewed checkout. The package defaults to the `next` tag to avoid advertising an alpha as `latest`.

## Evidence and limitations

The 0.3.0 baseline passed 67 tests on Windows and Ubuntu/WSL with Node 22.19.0 and 24.22.2. The owner supplied evidence that the four-job remote matrix passed for f4492ca. Edge and Chromium checks and a live Resend test-address send/status lookup also passed. See the research guide for exact evidence provenance. The preview's own CI must be checked on its release commit; earlier successes are not evidence for a later commit.

This is an experimental library and local pilot. Callbacks must be trusted, SQLite guarantees require one local transactional authority/effect boundary, and provider acceptance cannot be atomically revoked through a separate local check. No production deployment or compatibility with every agent framework is claimed.

## Feedback requested

Please open an issue with your Node version, operating system, queue/tool integration, expected authorization boundary and a minimal reproduction. Do not include credentials or real user data. Especially useful feedback concerns where authorization belongs in an existing deferred agent workflow.
