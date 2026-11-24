import { once } from "node:events";
import { PilotStore } from "./store.js";
import { identities, receiver } from "./receiver.js";

const path = process.env.PILOT_DATABASE;
if (!path) throw new Error("set PILOT_DATABASE to a local SQLite path");
const tokens = identities(process.env.PILOT_IDENTITIES ?? "{}");
const store = new PilotStore(path);
const release = Promise.withResolvers<void>();
process.on("message", message => { if (message === "release") release.resolve(); });
const server = receiver(store, tokens, {
  beforeCommit: process.env.PILOT_TEST_FAULT === "gate" && process.send ? async () => {
    process.send?.({ event: "received" }); await release.promise;
  } : undefined,
  afterCommit: process.env.PILOT_TEST_FAULT === "crash-after-commit" && process.send ? () => process.exit(86) : undefined,
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("TCP listener unavailable");
const ready = { event: "ready", url: `http://127.0.0.1:${address.port}` };
if (process.send) process.send(ready);
else console.log(JSON.stringify(ready));
function stop() {
  release.resolve();
  server.close(() => { store.close(); process.exit(0); });
  server.closeAllConnections();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", stop);
