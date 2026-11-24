# Changelog

## 0.4.0-alpha.1 - 2026-11-24

- Open the public experimental preview series under MIT, with unchanged core API declarations.
- Add package metadata, a GitHub-installable tarball, release notes, issue guidance and launch drafts.
- Prepare npm publication under the next tag; actual registry publication requires publisher login.


## 0.3.0 - 2026-11-24 (local integration pilot)

### Added

- A separate TypeScript pilot with authenticated loopback HTTP, server-derived scopes, immutable operation IDs, persistent receipts and owner-only status lookup after revocation.
- SQLite outbox claims, bounded retries, expiring leases and fencing against stale worker completion. Ambiguous exhausted outcomes remain `uncertain`.
- Multi-process tests for concurrent delivery, competing workers, in-flight revocation and receiver crash/restart after commit.
- A Resend test-address-only adapter with persistent intent, stable idempotency keys, a bounded retry window, attempt fencing and local injected-transport contract tests. Live test-address submission and delivered status retrieval were subsequently verified; live retry/failure cases remain pending.
- A real-browser Edge/Chromium check covering grant, execution, revocation and expiry, plus Chromium setup in the CI matrix.
- Strict checking for all JavaScript examples and a reproducible Ubuntu/WSL verification script.

### Validation

- 67/67 behavioral tests and the complete backend/package/documentation/audit pipeline passed locally on Windows and Ubuntu/WSL with Node.js 22.19.0 and 24.22.2.
- Real Edge grant/execute/revoke/expiry checks passed on Windows with both Node versions.
- Real Chromium 159.0.8154.6 checks passed on Ubuntu 24.04.2/WSL with Node 24.22.2.
- Live Resend test-address submission and delivered status retrieval passed. The owner-provided screenshot confirms all four remote GitHub Actions jobs passed for f4492ca (Verify #1). No public npm release or production deployment was performed.

The library entry points and public declarations are unchanged. Pilot modules remain outside package exports. This local version has not been published or deployed.

### Documentation

- Standardize project documentation and browser demo text in English.
- Separate onboarding, contributor guidance, research evidence, and delivery milestones.
- Include the linked Markdown guides and reference HTTP results in local package tarballs.

## 0.2.1 - 2026-11-24

### Fixed

- Reject direct async callbacks before starting a protected SQLite operation; retain Promise-like return validation. Callbacks must still be trusted and synchronous.
- Identify mismatched scope fields and provide corrective guidance without exposing identity or resource values.
- Reject nested transactions before executing the callback, preserving the caller's transaction.
- Update TypeDoc and override its minimatch dependency to 11.0.1 for GHSA-g3hv-75wg-m249. Apply a version-checked compatibility patch replacing the internal `matchOne()` call with `match(path, true)` during documentation generation.

### Added

- HTTP/outbox experiments covering in-flight revocation, lost responses, retries, and client cancellation. These do not extend guarantees to external email or API providers.
- Strict JSDoc/checkJs checking for the HTTP experiments.
- Independent tarball installation, runtime, type contract, exports isolation, and esbuild tree-shaking checks.
- A public declaration baseline requiring review when the API changes.
- A GitHub Actions verification matrix for Windows/Linux and Node.js 22.19.0/24.x.

### Validation

- All 49 behavioral tests and the complete verification pipeline passed locally on Windows x64 with Node.js 22.19.0 and 24.22.2.
- Dependency audit reported zero known vulnerabilities at verification time.
- Remote CI, Linux execution, and real-browser UI automation were not verified.

No public entry points or methods were added or removed. Scope mismatch messages now include details; applications should not depend on exact error text. Async SQLite callbacks were already unsupported; rejecting them before invocation is a bug fix.

## 0.2.0 - Imported baseline

- Add a SQLite adapter and experiments resuming persisted jobs in another process.
- The original release date has not been verified.

## Versioning policy

Use patch releases for compatible fixes, minor releases for compatible features, and major releases for breaking public API changes. Mark APIs scheduled for removal with `@deprecated` in a preceding minor release and provide migration instructions. Review declaration baseline changes before accepting them; a baseline difference alone does not establish whether a change is breaking.

This remains a private research package (`private: true`) and has not been published to npm. Unreleased changes are not represented as a published release.
