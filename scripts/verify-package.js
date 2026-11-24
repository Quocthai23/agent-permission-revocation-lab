import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check via npm run test:package");
const scratch = await mkdtemp(join(tmpdir(), "agent-permission-package-"));
const npm = (args, cwd) => exec(process.execPath, [npmCli, ...args], { cwd, timeout: 60000 });
try {
  const { stdout } = await npm(["pack", "--json", "--pack-destination", scratch], root);
  const [pack] = JSON.parse(stdout);
  const files = pack.files.map(file => file.path);
  assert.ok(files.includes("dist/guard.js") && files.includes("dist/sqlite.d.ts"));
  assert.ok(files.includes("CHANGELOG.md"));
  const guides = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "docs/ROADMAP.md", "docs/PILOT.md", "docs/RESEND.md", "docs/RELEASE.md", "docs/ANNOUNCEMENT.md", "docs/research/README.md"];
  assert.ok(files.includes("LICENSE"));
  for (const guide of guides) assert.ok(files.includes(guide), `Missing package guide: ${guide}`);
  assert.ok(files.includes("docs/research/http-results.json"));
  assert.ok(files.every(path => path.startsWith("dist/") ||
    ["package.json", "LICENSE", ...guides, "docs/research/http-results.json"].includes(path)), "Unexpected packed files");
  const consumer = join(scratch, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await npm(["install", join(scratch, pack.filename), "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], consumer);
  const manifest = JSON.parse(await readFile(join(consumer, "node_modules/agent-permission-revocation-lab/package.json"), "utf8"));
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "Runtime dependencies must remain empty");
  assert.deepEqual(Object.keys(manifest.exports), [".", "./sqlite"]);

  await writeFile(join(consumer, "smoke.mjs"), `
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import * as core from 'agent-permission-revocation-lab';
    import * as sqlite from 'agent-permission-revocation-lab/sqlite';
    assert.deepEqual(Object.keys(core), ['TaskGuard']);
    assert.deepEqual(Object.keys(sqlite), ['SqliteTaskGuard']);
    const scope = {agent:'a',task:'t',action:'write',resource:'r'};
    const db = new DatabaseSync(':memory:');
    try {
      for (const guard of [new core.TaskGuard(), new sqlite.SqliteTaskGuard(db)]) {
        const id = guard.grant(scope, Date.now()+60000);
        assert.equal(guard.run(id, scope, () => 42), 42);
        assert.equal(guard.revoke(id), true);
        assert.throws(() => guard.run(id, scope, assert.fail), /Grant unavailable/);
      }
      for (const path of ['dist/guard.js', 'dist/internal/policy.js', 'package.json']) {
        await assert.rejects(import('agent-permission-revocation-lab/' + path),
          {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
      }
    } finally { db.close(); }
  `);
  await exec(process.execPath, ["smoke.mjs"], { cwd: consumer, timeout: 10000 });
  // Compile the same positive and negative type contracts against the installed
  // tarball, rather than relying only on package self-resolution in this repo.
  await writeFile(join(consumer, "types.mts"), await readFile(join(root, "test/types.ts")));
  await exec(process.execPath, [join(root, "node_modules/typescript/bin/tsc"),
    "--strict", "--noEmit", "--target", "ES2022", "--module", "NodeNext",
    "--typeRoots", join(root, "node_modules/@types"), "types.mts"], { cwd: consumer, timeout: 30000 });

  const bundle = source => build({
    absWorkingDir: consumer,
    stdin: { contents: source, resolveDir: consumer, sourcefile: "consumer.js" },
    platform: "browser", format: "esm", target: "es2022", bundle: true,
    treeShaking: true, minify: true, metafile: true, write: false,
  });
  const used = await bundle("export { TaskGuard } from 'agent-permission-revocation-lab'");
  assert.ok(Object.keys(used.metafile.inputs).some(path => path.endsWith("dist/guard.js")));
  assert.ok(!Object.keys(used.metafile.inputs).some(path => path.endsWith("sqlite.js")), "Browser core must not include the SQLite adapter");
  const unused = await bundle("import { TaskGuard } from 'agent-permission-revocation-lab'; console.log('unused');");
  for (const output of Object.values(unused.metafile.outputs)) {
    for (const [path, input] of Object.entries(output.inputs)) {
      if (path.includes("agent-permission-revocation-lab/")) assert.equal(input.bytesInOutput, 0);
    }
  }
  const bundled = join(consumer, "bundled.mjs");
  await writeFile(bundled, used.outputFiles[0].text);
  await writeFile(join(consumer, "bundle-smoke.mjs"), `
    import assert from 'node:assert/strict';
    import {TaskGuard} from './bundled.mjs';
    const guard = new TaskGuard();
    const scope = {agent:'a',task:'t',action:'read',resource:'r'};
    const id = guard.grant(scope, Date.now()+60000);
    assert.equal(guard.run(id,scope,()=>42),42);
  `);
  await exec(process.execPath, ["bundle-smoke.mjs"], { cwd: consumer, timeout: 10000 });
  console.log(`Package ${pack.version}: installed tarball, exports isolation, runtime, types and browser ESM tree-shaking passed`);
  console.log(`esbuild: used core ${used.outputFiles[0].contents.length} bytes; unused import ${unused.outputFiles[0].contents.length} bytes (minified, not gzip)`);
} finally {
  // scratch is allocated by mkdtemp under the OS temporary directory.
  await rm(scratch, { recursive: true, force: true });
}
