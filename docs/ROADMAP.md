# Roadmap and release gates

## Current position

Version 0.3.0 implements the authenticated first-party integration pilot and a Resend test-address adapter. The core API is unchanged. This is a private local research project, not a production deployment or a public npm release.

## Completed implementation

- Separate receiver and dispatcher processes, loopback bearer authentication and server-derived scopes.
- Immutable operation identity and payload, transactional destination receipts and owner-only historical status after revocation.
- Persistent outbox claims, bounded retries, lease expiry, stale-worker fencing, and explicit uncertain outcomes.
- Tests for ownership, expiry, scope injection, in-flight revocation, concurrent delivery and crash/restart after commit.
- Resend test-address restriction, stable provider keys, persistent send state, retry budget/window and stale-attempt fencing, verified using local injected transports.
- Automated real-browser grant/revoke/expiry checks, verified on Windows Edge and Linux Chromium, and strict checking for all JavaScript examples.
- A reproducible local Ubuntu/WSL verification path and an updated remote Windows/Linux CI matrix with browser setup.

The guarantee remains scoped to authority and protected destination effects sharing one local SQLite transaction. The pilot does not establish atomic revocation across independent provider databases. See [Pilot operation](PILOT.md), [Resend integration](RESEND.md), and [Research and evidence](research/README.md).

## Pending external verification

1. **Resend account and sender:** live test-address submission and status retrieval passed on 2026-11-24. Configure the ignored local .env file as described in the Resend guide, then record actual test-address acceptance, repeated submissions and status retrieval. Provider acceptance and delivery events must be distinguished. Resend reported delivered for the test address; live retry/failure cases remain pending.
2. **Remote CI repository:** Completed for commit f4492ca: the owner-provided screenshot shows Verify #1 succeeded across ubuntu-latest/windows-latest and Node 22.19.0/24.x. Total duration was 5m 36s, with four artifacts. This evidence confirms that run, not future commits.
3. **TypeDoc upstream compatibility:** retain the scoped, checked compatibility patch until a compatible upstream dependency upgrade is available; review rather than automatically replacing it.

Local browser coverage is complete for Edge 159.0.4402.13 on Windows (Node 22.19.0 and 24.22.2) and Chromium 159.0.8154.6 on Ubuntu 24.04.2/WSL (Node 24.22.2). Remote CI also passed the configured four-job matrix for f4492ca; this does not imply coverage of every browser or future commit.

## Provider boundaries and follow-up

A pre-send authorization check and provider acceptance are not one transaction. Revocation in between can still permit email acceptance, as the local contract tests demonstrate. Provider idempotency prevents certain duplicates within its retention window; it does not revoke permission or undo delivery.

The current adapter does not implement scheduled-send cancellation or delivery webhooks. Add either only when the selected experiment requires it, using the provider's documented semantics and live sandbox evidence. Unknown acceptance without a provider ID requires explicit reconciliation; do not bypass exhausted retry budgets with a new operation ID.

## Distribution gate

Before a supported public release:

1. Complete the relevant external verification above and document supported environments and remaining limitations.
2. Review the unchanged/changed public API baseline, SemVer choice, migration notes and changelog.
3. Select a distribution license and repository ownership. Neither has been assumed from the local Windows account name.
4. Make an explicit publication decision, review package contents and installation instructions, then publish through the selected channel.

Until that decision, keep private: true. A passing local pipeline and tarball do not make the pilot a production service or a published release.
