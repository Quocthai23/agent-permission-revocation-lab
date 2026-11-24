import { PilotStore } from "./store.js";

export async function dispatchOnce(store: PilotStore, base: string, token: string, options: {
  timeoutMs?: number; leaseMs?: number; maxAttempts?: number;
} = {}): Promise<string> {
  const url = new URL(base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/")
    throw new Error("pilot receiver must be an http://127.0.0.1:port origin");
  if (token.length < 32) throw new Error("dispatcher token must have at least 32 characters");
  const timeoutMs = options.timeoutMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 4;
  const leaseMs = options.leaseMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 ||
      !Number.isSafeInteger(leaseMs) || leaseMs < timeoutMs * 3)
    throw new Error("use timeoutMs 1-10000, maxAttempts 1-10 and leaseMs >= 3 * timeoutMs");
  const job = store.claim(Date.now(), leaseMs, maxAttempts);
  if (!job) return "idle";
  const endpoint = new URL(`/operations/${job.id}`, url);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const status = async () => {
    const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
    if (response.status !== 200) throw new Error(`status HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("state" in value) ||
        !["committed", "not_committed"].includes(String(value.state))) throw new Error("invalid receiver status");
    return value.state;
  };
  try {
    // Historical status remains readable by the authenticated owner after revoke.
    if (await status() === "committed") { store.finish(job, "done"); return "done"; }
    const response = await fetch(endpoint, {
      method: "POST", headers, body: JSON.stringify({ body: job.body }),
      signal: AbortSignal.timeout(timeoutMs), redirect: "error",
    });
    await response.text();
    if (response.status === 200) { store.finish(job, "done"); return "done"; }
    if ([400, 401, 403, 404, 409, 413, 415].includes(response.status)) {
      if (await status() === "committed") { store.finish(job, "done"); return "done"; }
      store.finish(job, "denied", `receiver HTTP ${response.status}`); return "denied";
    }
    throw new Error(`receiver HTTP ${response.status}`);
  } catch {
    // Never call an ambiguous timeout a failed effect. A later attempt reconciles
    // status before sending; exhausted jobs require explicit operator review.
    const state = job.attempts >= maxAttempts ? "uncertain" : "queued";
    store.finish(job, state, "transport or status uncertainty");
    return state;
  }
}
