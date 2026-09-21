# diabetes-m-mcp

MCP server (TypeScript, ESM, Node >= 18) that exposes Diabetes:M data to Claude Desktop over stdio. Source in `src/`, compiled to `dist/` by `tsc`. Distributed as a GitHub release with an MCPB bundle — the package is **not** published on npm.

## Commands

- `npm run build` — `tsc` (`src/` → `dist/`)
- `npm run sbom` — `@cyclonedx/cyclonedx-npm --omit dev` → `sbom.cdx.json` (CycloneDX 1.6 JSON, runtime deps only, reproducible output: no timestamp/serial, so it only changes with the runtime dependency tree, the version or the npm version in `metadata.tools`). Nested installs are nested `components`, so walk the tree when counting. The file is committed and describes the version in `package.json`; it is **not** refreshed on Dependabot merges, only at release time.
- `npm run bundle` — build + sbom + `scripts/create-bundle.js` → `releases/diabetes-m-mcp-v<version>.mcpb` (+ `.sha256`) and `releases/diabetes-m-mcp-v<version>.cdx.json` (copy of the SBOM). The bundle is a ZIP with `manifest.json` at the root, `dist/`, `package.json`, `sbom.cdx.json`, READMEs, LICENSE, the icon and a `node_modules` that is **not** the root one: the script runs `npm ci --omit=dev` from the lockfile in a temp dir (with `scripts` stripped from the staged `package.json`, otherwise `prepare` would run the missing `tsc`) and ships that runtime-only tree (~5 MB instead of ~20 MB). It refuses an `sbom.cdx.json` whose `metadata.component.version` differs from `package.json`, or whose package paths do not match `npm ls --all --parseable --omit=dev` of the staged tree one-to-one.
- `npm run release` — bundle + `scripts/create-release.js` (creates the `v<version>` tag and the GitHub release via `gh`, uploading the bundle, its hash and the SBOM)
- `npm test` — `scripts/test.js`

Smoke test of the built server (expects `serverInfo.version` = `package.json` version and 11 tools):

```bash
printf '%s\n%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js 2>/dev/null
```

## Branch rules

`main` has a required status check (`build`). Admin pushes bypass it silently ("Bypassed rule violations"), so **never push directly to `main`** — every change, including release bumps, goes through a PR and is squash-merged once CI is green. Dependabot PRs are squash-merged too (`gh pr merge N --squash --delete-branch`).

## Release flow

The version lives in three places that must match: `package.json`, `package-lock.json`, `manifest.json`. The server reads it from `package.json` at runtime (`src/server.ts`), so there is nothing to change in `src/`.

1. Start from an up-to-date `main`; `gh pr list` must be empty (merge or close what is pending first).
2. `git checkout -b release/X.Y.Z`
3. `npm version X.Y.Z --no-git-tag-version` (updates `package.json` + lockfile), then set `"version": "X.Y.Z"` in `manifest.json`.
4. Replace the `## What's New in ${tag}` section in `scripts/create-release.js` with the actual changes since the previous tag (`git log vPREV..HEAD`). The notes are a JS template literal: escape backticks as `` \` ``. Stale notes from the previous release ship verbatim otherwise.
5. `npm ci && npm audit` — audit must be clean with and without `--omit=dev`. Transitive advisories are fixed by raising the floor in `overrides` in `package.json` (see the existing `hono` / `fast-uri` / `body-parser` entries), not by editing the lockfile by hand.
6. `npm run bundle`, check the output starts with the ZIP signature (`head -c 2 releases/diabetes-m-mcp-vX.Y.Z.mcpb` → `PK`), and run the smoke test above. This also regenerates `sbom.cdx.json` for the new version and the current lockfile: it must be part of the release commit.
7. Commit as `chore(release): X.Y.Z` (body: what the release cuts; include `sbom.cdx.json`), push, open a PR, squash-merge when green.
8. `git checkout main && git pull`, then `npm ci && npm run bundle && node scripts/create-release.js`. The script creates tag `vX.Y.Z` on `main` and the GitHub release "Diabetes:M MCP Server vX.Y.Z" with the `.mcpb`, `.sha256` and `.cdx.json` assets. Verify with `gh release view vX.Y.Z`.
9. Clean up `releases/`: keep only the files just published (`diabetes-m-mcp-vX.Y.Z.mcpb` + `.sha256` + `.cdx.json`) and delete everything else — older bundles, and the `release-notes.md` the script writes as a temp file. The GitHub release is the archive; local copies of previous versions are not needed.

`releases/` is gitignored; never commit bundles. Versioning is semver: dependency/security-only changes are a patch, new tools or tool parameters a minor.
