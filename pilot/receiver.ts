import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { PilotError, PilotStore, operationId } from "./store.js";

export function identities(raw: string): Map<string, string> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PILOT_IDENTITIES must map tokens to agent IDs");
  const result = new Map<string, string>();
  for (const [token, agent] of Object.entries(value)) {
    if (token.length < 32 || typeof agent !== "string" || !agent.trim())
      throw new Error("identity tokens must have at least 32 characters and map to nonempty agent IDs");
    result.set(token, agent);
  }
  if (!result.size) throw new Error("configure at least one authenticated identity");
  return result;
}

async function body(request: IncomingMessage): Promise<string> {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new PilotError(415, "use application/json");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new PilotError(413, "request body exceeds 16384 bytes");
    chunks.push(chunk);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PilotError(400, "request must contain valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 || !("body" in value) || typeof value.body !== "string")
    throw new PilotError(400, "request must contain only a string body field; scope is server-derived");
  return value.body;
}

export function receiver(store: PilotStore, tokens: Map<string, string>, hooks: {
  beforeCommit?: () => Promise<void>; afterCommit?: () => void;
} = {}) {
  if (!tokens.size) throw new Error("receiver requires authenticated identities");
  const entries = [...tokens].map(([token, agent]) => ({ hash: createHash("sha256").update(token).digest(), agent }));
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
      const hash = createHash("sha256").update(token).digest();
      const principal = entries.find(entry => timingSafeEqual(entry.hash, hash));
      if (!principal) { response.setHeader("WWW-Authenticate", "Bearer"); throw new PilotError(401, "authentication required"); }
      const match = /^\/operations\/([a-zA-Z0-9_-]{1,100})$/.exec(request.url ?? "");
      if (!match) throw new PilotError(404, "route not found");
      const id = match[1];
      operationId(id);
      let result;
      if (request.method === "GET") result = store.status(id, principal.agent);
      else if (request.method === "POST") {
        const payload = await body(request);
        await hooks.beforeCommit?.();
        result = store.execute(id, principal.agent, payload);
        hooks.afterCommit?.();
      } else throw new PilotError(405, "use GET or POST");
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof PilotError ? error.status : 503;
      response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
        error: error instanceof PilotError ? error.message : "receiver temporarily unavailable",
      }));
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  return server;
}
