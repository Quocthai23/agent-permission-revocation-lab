import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = new URL("../", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("node_modules/typedoc/package.json", root), "utf8"));
assert.equal(metadata.version, "0.28.20", "Review/remove the minimatch compatibility patch before upgrading TypeDoc");
const dependency = new URL("node_modules/typedoc/dist/node-utils.js", root);
const original = `return mini.set.some((row) => mini.matchOne(
        childPath,
        row,
        /* partial */
        true
      ));`;
// minimatch 11 removes the internal matchOne method. Its supported match(path,
// partial) API performs this prefix check for all pattern alternatives.
const patched = "return mini.match(childPath.join(\"/\"), true); /* lab: minimatch-11 compatibility */";
const source = await readFile(dependency, "utf8");
if (!source.includes(patched)) {
  assert.equal(source.split(original).length, 2, "Unexpected TypeDoc source; review compatibility instead of silently patching");
  await writeFile(dependency, source.replace(original, patched));
}
const exec = promisify(execFile);
const { stdout, stderr } = await exec(process.execPath, [
  fileURLToPath(new URL("node_modules/typedoc/bin/typedoc", root)),
  // Exercise glob traversal and exclusions under minimatch 11 on every run.
  "src/*.ts", "--exclude", "**/internal/**", "--out", "docs/api",
  "--treatWarningsAsErrors",
], { cwd: fileURLToPath(root), timeout: 60000 });
process.stdout.write(stdout);
process.stderr.write(stderr);
for (const [module, name] of [["guard", "TaskGuard"], ["sqlite", "SqliteTaskGuard"]]) {
  const html = await readFile(new URL(`docs/api/classes/${module}.${name}.html`, root), "utf8");
  for (const member of ["grant", "revoke", "run"])
    assert.ok(html.includes(`id="${member}"`), `Missing ${name}.${member} documentation`);
}
console.log("API documentation includes both public classes and all grant/revoke/run methods");
