# Resend test-address integration

## Status and guarantee

Live test-address submission and status retrieval were verified on 2026-11-24. Resend accepted the request and reported last_event=delivered for delivered@resend.dev. Local contract tests remain separate from this live verification. Live duplicate-send, cancellation and failure-injection scenarios have not been verified.

`pilot/resend.ts` uses built-in fetch, a persisted local submission record and a stable provider idempotency key. It accepts only `delivered@resend.dev` or a labeled `delivered+label@resend.dev` test address. The CLI fixes the recipient to `delivered@resend.dev`; arbitrary recipient delivery is outside this experiment.

The permission check and recording of send intent share a local SQLite transaction. The actual HTTP request occurs afterward. Revocation after that check can still precede provider acceptance without stopping it. A local contract test deliberately demonstrates this limitation. This adapter does not provide atomic downstream revocation.

## Configure and run when an account is available

1. Create a Resend account and API key through the provider's dashboard. Configure an allowed sender address according to that account's domain/sender requirements.
2. Copy `.env.example` to `.env` locally. Set `RESEND_API_KEY`, `RESEND_FROM` and a stable `RESEND_OPERATION_ID`. Do not commit or paste the key into chat. The file is ignored by Git. Set `PILOT_DATABASE` to a persistent local database path.
3. Run the test submission:

```sh
npm run demo:resend
```

4. Reuse the same operation ID and database when querying or reconciling:

```sh
npm run demo:resend -- --status
npm run demo:resend -- --revoke
```

The first submission issues a 60-second local grant when one is not supplied. Later invocations reuse the persisted grant rather than silently reauthorizing. `--status` reads provider status by its stored email ID where available. `--revoke` removes existing local authority; it does not cancel or unsend an accepted email. Test messages count against the provider's account quota.

## Identity, retries and uncertain results

An operation binds its grant, trusted agent and exact canonical payload. The stable `Idempotency-Key` is `permission-lab/<operation-id>`. Different payload or identity reuse is rejected before transport. Concurrent claims use a persisted send lease; attempt generations prevent a stale completion from overwriting newer status.

Resend documents a 24-hour idempotency retention window. This adapter stops retries after 23 hours from its first local attempt and after three claims. Each request has a 5-second timeout. Local lease timing assumes a trustworthy local clock; suspension and clock changes remain operational concerns. Do not replace an old operation ID to work around an exhausted window.

`accepted` means a provider ID was recorded, not that a recipient read or received the message. `uncertain` includes lost responses and ambiguous errors; the provider may already have accepted the request. A missing provider ID prevents direct lookup by email ID. Resubmitting an unchanged request may reconcile within the key window while authority remains valid. If authority has been revoked, do not resend to discover the result; leave the operation uncertain for manual/provider reconciliation. `rejected` records a definitive non-retryable 4xx response from that attempt.

Historical accepted results can be read by the trusted local owner after revocation without resending. The CLI is a local administrative experiment, not a remotely authenticated multi-user email service.

## Verified locally versus pending remotely

Local injected-transport contract tests cover test-recipient restriction, revocation before transport, stable key/payload on retry, payload conflicts, uncertainty after revocation, key-window exhaustion, stale-attempt fencing, status retrieval, and the post-check revocation gap. These are not live provider tests.

After credentials are available, record actual test-address acceptance, repeated submission with the same key, status retrieval and supported failure cases. Provider acceptance, webhook delivery events and final effects must be reported separately. Cancellation is a separate provider feature for scheduled emails; it is not implemented or claimed here. No guarantee is made for revocation after acceptance or delivery.

## Provider references

- [Test email addresses](https://resend.com/docs/dashboard/emails/send-test-emails).
- [Idempotency keys and their retention window](https://resend.com/docs/dashboard/emails/idempotency-keys).
- [Retrieve a sent email](https://resend.com/docs/api-reference/emails/retrieve-email).
- [Cancel a scheduled email](https://resend.com/docs/api-reference/emails/cancel-email).

These references informed the adapter design. They do not substitute for running and recording a live integration test with the selected account.
