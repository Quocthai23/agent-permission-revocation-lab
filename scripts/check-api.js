import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const actual = {};
for (const [entry, target] of Object.entries(manifest.exports)) {
  const content = await readFile(new URL(target.types, root), "utf8");
  const source = ts.createSourceFile(target.types, content, ts.ScriptTarget.Latest, true);
  actual[entry] = printer.printFile(source).trim();
}
const baseline = new URL("test/public-api.json", root);
if (process.argv.includes("--update")) {
  await writeFile(baseline, JSON.stringify(actual, null, 2) + "\n");
  console.log("Updated public API baseline; review the diff and SemVer before accepting it");
} else {
  assert.deepEqual(actual, JSON.parse(await readFile(baseline, "utf8")),
    "Public declarations changed: review compatibility, versioning and deprecation before updating test/public-api.json");
  console.log("Public declarations match the reviewed API baseline (comments excluded)");
}
