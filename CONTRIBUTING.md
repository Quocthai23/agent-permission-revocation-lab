# Contributing

## Development setup

Use Node.js 22.19.0 or later. From the repository root:

```sh
npm ci
npm run verify
```

Use English for documentation, comments, error messages, and demo labels. Use ISO 8601 dates (`YYYY-MM-DD`) and distinguish observed results from design expectations. Do not claim a platform, provider, or hosted demo has been verified without a corresponding run.

## Verification commands

- `npm run build`: compile the strict TypeScript core and emit JavaScript and declarations to `dist/`.
- `npm run check:types`: run public type contracts and strict JSDoc/checkJs checking for all JavaScript examples. The TypeScript pilot is checked during build.
- `npm run check:api`: compare generated public declarations against `test/public-api.json`.
- `npm test`: build, check types and the API baseline, then run behavioral tests.
- `npm run test:package`: build, pack, install into an independent temporary consumer, and check runtime behavior, declarations, exports isolation, and browser ESM tree-shaking.
- `npm run docs`: generate API documentation and verify both public classes and their `grant`, `revoke`, and `run` methods.
- `npm run verify`: run tests, package checks, documentation generation, and `npm audit --audit-level=moderate`.
- `npm run test:browser`: run the real-browser demo checks using installed Edge on local Windows or Playwright Chromium elsewhere.
- `npm run verify:all`: include the real-browser check after full verification.
- `npm run demo:pilot`: run the authenticated multi-process demonstration with temporary credentials and storage.

Build before using `check:types` or `check:api` directly. Full verification handles this ordering. Generated `dist/` and `docs/api/` content is ignored by Git.

## API and architecture

Keep the core API small. Shared validation belongs in internal modules; storage-specific behavior belongs in its adapter. Do not expose experiment helpers through package exports. Avoid barrel modules and runtime dependencies unless there is a demonstrated need. Introduce workspaces only when multiple independently useful packages exist.

For an intentional public declaration change:

1. Review existing callers and choose the appropriate version change.
2. Add migration guidance and a preceding `@deprecated` notice for scheduled removals.
3. Update behavioral and type tests as appropriate.
4. Build, then run `npm run check:api -- --update`.
5. Review the baseline diff and update [CHANGELOG.md](CHANGELOG.md).

Never regenerate the baseline automatically in CI. It excludes comments and detects declaration changes; it is not a semantic compatibility analyzer.

## Package and bundler verification

The package check consumes an actual `npm pack` tarball rather than relying exclusively on repository self-imports. It checks that runtime dependencies remain empty, internal imports remain blocked, installed type contracts compile, and both public runtime entry points work.

The esbuild check bundles the core for the browser without SQLite and confirms unused imports contribute no library bytes. The browser-targeted bundle is executed in Node as a smoke test; `test:browser` separately exercises the demo UI in a headless browser. This does not establish compatibility with every browser or bundler. Byte counts are minified, not gzipped, and are not performance benchmarks.

Markdown guides linked by the package README and the reference HTTP results are included in the tarball. Source files, tests, scripts, and generated HTML documentation are excluded. Development commands and source paths apply to the repository checkout; the tarball contains the library and its reading material.

## Temporary TypeDoc compatibility patch

TypeDoc 0.28.20 depends on minimatch 10. The [dependency advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) lists 11.0.1 as a patched version. The override is scoped to TypeDoc and pinned to minimatch 11.0.1.

[minimatch 11 removed the internal matchOne method](https://github.com/isaacs/minimatch/blob/main/changelog.md), which TypeDoc still calls. `scripts/generate-docs.js` replaces the known directory-prefix check with the supported `match(path, true)` API. It requires the exact TypeDoc version and source fragment, accepts an already patched installation, and reapplies after `npm ci`. It stops on unexpected source/version changes.

Documentation generation exercises glob traversal and exclusions, treats warnings as errors, and checks the generated API pages. The script modifies the local installed dependency during `npm run docs`; it is not an install hook or an upstream-supported combination. Review or remove the patch when upgrading TypeDoc. Do not force an unrelated major downgrade solely to silence an audit report.

## CI and release preparation

`.github/workflows/verify.yml` defines Windows/Linux jobs for Node.js 22.19.0 and 24.x, installs Playwright Chromium and runs `verify:all`. They run only after the repository is hosted on GitHub with Actions enabled. A configured workflow is not evidence that remote jobs passed.

For local Ubuntu/WSL verification, run `sh /mnt/c/Research/scripts/verify-wsl.sh 22.19.0` from WSL, substituting your checkout path. The script downloads Node from its official distribution endpoint, checks SHA-256, and verifies a temporary Linux checkout without Windows node_modules, build output, artifacts or local credentials. It copies the verification log into `artifacts/` before exit. The temporary checkout path is also recorded, but WSL or the OS may clear it on shutdown. This does not run GitHub Actions.

To include the Linux browser check in the same invocation, use `sh /mnt/c/Research/scripts/verify-wsl.sh 24.22.2 --browser`. It downloads Chromium into the temporary workspace, runs the real-browser test, and copies the screenshot before exit. The helper `test-wsl-browser.sh` may also be run against a still-existing verification checkout. Chromium testing passed locally on Ubuntu 24.04.2 with existing system libraries; other environments may require the dependencies described by Playwright.

Before release, follow [Roadmap and release gates](docs/ROADMAP.md), verify from a clean install, and record actual environments and results. MIT is selected for the authorized public experimental preview. npm publication uses the next tag and requires publisher authentication; do not advertise registry availability until it is confirmed.
