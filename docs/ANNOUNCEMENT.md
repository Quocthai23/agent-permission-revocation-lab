# Launch copy

These are prepared drafts, not claims that posts have been published. Link the public release once it exists. Do not claim npm availability until registry publication is confirmed.

## Short announcement

I am sharing Agent Permission Revocation Lab, an MIT-licensed TypeScript experiment for a practical agent workflow problem: what happens when permission is revoked while a task is queued, paused or waiting for approval?

It compares scheduling-time checks, dispatcher checks and checks at the destination's transactional write boundary. The examples include SQLite, authenticated HTTP workers, duplicate delivery and recovery after a lost response.

You can run the main demonstrations locally without an API key. The library has no runtime dependencies. It is an experimental preview: a local SQLite transaction does not make a third-party email provider's acceptance atomically revocable.

Source and runnable examples: https://github.com/Quocthai23/agent-permission-revocation-lab

I would especially value feedback from developers building queued tool calls or approval-based agent workflows. Where would this boundary fit in your system?

## Technical article outline

Suggested title: **Why checking AI-agent permissions before queueing is not enough**

1. Show a queued action that was authorized, then revoked before execution.
2. Compare scheduling-time and execution-time checks with the runnable SQLite experiment.
3. Show the HTTP race that survives a dispatcher-only check.
4. Explain the transactional destination check and its shared-database assumption.
5. Demonstrate lost-response recovery and why a denied retry does not prove no earlier effect.
6. Explain why provider idempotency and cancellation are distinct from authority.
7. Link the release, evidence and issue template; ask for a concrete integration case.

## Sharing plan

Start with one technical post on a channel you already use and a small number of relevant agent/backend communities. Follow each community's promotion rules and answer technical questions. A Show HN submission is appropriate only when readers can run the actual project easily and the author is available to discuss its implementation and limitations. Avoid duplicate cross-posting or requests for votes.

Initial feedback target: five independent developers running the examples and one concrete integration report. These are planning targets, not reported usage metrics.
