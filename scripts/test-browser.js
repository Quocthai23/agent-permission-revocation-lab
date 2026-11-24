import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const server = createServer(async (request, response) => {
  const path = request.url ?? "";
  if (path !== "/examples/browser.html" && !/^\/dist\/(?:internal\/)?[a-z]+\.js$/.test(path)) {
    response.writeHead(404).end(); return;
  }
  try {
    const content = await readFile(new URL(path.slice(1), root));
    response.writeHead(200, { "Content-Type": path.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript" }).end(content);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const channel = process.env.PILOT_BROWSER_CHANNEL ?? (process.platform === "win32" && !process.env.CI ? "msedge" : undefined);
  browser = await chromium.launch({ headless: true, channel });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/examples/browser.html`);
  await page.clock.install();
  const text = () => page.locator("output").textContent();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page.getByRole("button", { name: "Grant permission" }).click();
  await page.getByRole("button", { name: "Resume task" }).click();
  assert.equal(await text(), "Draft written");
  await page.getByRole("button", { name: "Revoke permission" }).click();
  await page.getByRole("button", { name: "Resume task" }).click();
  assert.equal(await text(), "Grant unavailable");
  await page.getByRole("button", { name: "Grant permission" }).click();
  await page.clock.fastForward(60_000);
  await page.getByRole("button", { name: "Resume task" }).click();
  assert.equal(await text(), "Grant expired");
  assert.deepEqual(errors, []);
  await mkdir(new URL("artifacts/", root), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("artifacts/browser-demo.png", root)), fullPage: true });
  console.log(`Real browser passed: ${channel ?? "chromium"} ${browser.version()} / ${process.platform}; grant, execute, revoke, expiry; no page errors`);
} finally {
  await browser?.close();
  if (server.listening) {
    const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed;
  }
}
