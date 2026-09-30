#!/usr/bin/env node
/**
 * Fixes npm audit findings without human input, within safe limits.
 *
 * 1. `npm audit fix` (never --force): in-range lockfile updates.
 * 2. For what is still vulnerable, raises (or adds) the floor in `overrides`
 *    to the lowest non-vulnerable version *in the same major* as the one
 *    installed. Most advisories here are transitive via @modelcontextprotocol/sdk,
 *    where only an override can move the version (see the hono / fast-uri /
 *    ip-address entries). A fix that needs a new major is never applied: it is
 *    reported instead, because it needs a human (like @hono/node-server 1.x -> 2.x).
 * 3. `npm install` to apply the overrides, then audits again with and without
 *    --omit=dev.
 *
 * Writes a Markdown summary to $AUTOFIX_SUMMARY (default: autofix-summary.md).
 * Exit code: 0 = no vulnerabilities left (files may have changed),
 *            3 = vulnerabilities left that need a human, 1 = error.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import semver from 'semver';

const summaryPath = process.env.AUTOFIX_SUMMARY || 'autofix-summary.md';
const log = (msg) => console.error(msg);

function run(cmd) {
  log(`$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}

// npm audit exits non-zero when it finds something; the JSON is still on stdout.
function audit(omitDev = false) {
  let out;
  try {
    out = run(`npm audit --json${omitDev ? ' --omit=dev' : ''}`);
  } catch (err) {
    out = err.stdout;
  }
  return JSON.parse(out).vulnerabilities || {};
}

// Advisory ranges per vulnerable package. Entries in `via` that are strings
// only point at another vulnerable package and carry no range of their own.
function advisoryRanges(vulns) {
  const ranges = new Map();
  for (const [name, v] of Object.entries(vulns)) {
    const own = v.via.filter((x) => typeof x === 'object' && x.range);
    if (own.length) ranges.set(name, own.map((x) => ({ range: x.range, url: x.url, title: x.title })));
  }
  return ranges;
}

// Advisories for the override floors themselves. The lockfile can be clean while
// a floor like `>=4.1.2` still admits a vulnerable version, and npm audit only
// looks at what is installed, so ask the registry's bulk endpoint (the one npm
// audit uses) about the floor versions directly.
async function floorAdvisories(overrides) {
  const floors = {};
  for (const [name, spec] of Object.entries(overrides)) {
    const v = typeof spec === 'string' && spec.startsWith('>=') ? semver.valid(spec.slice(2)) : null;
    if (v) floors[name] = [v];
  }
  if (!Object.keys(floors).length) return new Map();
  const res = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(floors),
  });
  if (!res.ok) throw new Error(`advisories/bulk: HTTP ${res.status}`);
  const ranges = new Map();
  for (const [name, advisories] of Object.entries(await res.json())) {
    const own = advisories.map((a) => ({ range: a.vulnerable_versions, url: a.url, title: a.title }));
    if (own.some((r) => semver.satisfies(floors[name][0], r.range))) ranges.set(name, own);
  }
  return ranges;
}

function installedVersions(name) {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const versions = new Set();
  for (const [path, pkg] of Object.entries(lock.packages || {})) {
    if (!pkg.link && pkg.version && path.split('node_modules/').pop() === name) versions.add(pkg.version);
  }
  return [...versions];
}

// Major for compatibility purposes: 0.x minors are breaking under semver.
const compatMajor = (v) => (semver.major(v) === 0 ? `0.${semver.minor(v)}` : `${semver.major(v)}`);

function lowestSafeVersion(name, installed, ranges) {
  const published = JSON.parse(run(`npm view ${name} versions --json`));
  const target = installed.map((v) => semver.parse(v)).sort(semver.rcompare)[0];
  return (Array.isArray(published) ? published : [published])
    .filter((v) => semver.valid(v) && !semver.prerelease(v))
    .filter((v) => compatMajor(v) === compatMajor(target.version) && semver.gt(v, target))
    .filter((v) => !ranges.some((r) => semver.satisfies(v, r.range)))
    .sort(semver.compare)[0];
}

const changes = [];
const pkgBefore = readFileSync('package.json', 'utf8');
const lockBefore = readFileSync('package-lock.json', 'utf8');

run('npm audit fix --no-fund');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.overrides ||= {};
const needsHuman = [];

const vulnerable = advisoryRanges(audit());
for (const [name, ranges] of await floorAdvisories(pkg.overrides)) {
  vulnerable.set(name, [...(vulnerable.get(name) || []), ...ranges]);
}

for (const [name, ranges] of vulnerable) {
  // For a stale floor, the base is the floor itself: raising it is what matters,
  // even when the lockfile already resolves to a fixed version.
  const floor = typeof pkg.overrides[name] === 'string' && pkg.overrides[name].startsWith('>=') ? semver.valid(pkg.overrides[name].slice(2)) : null;
  const staleFloor = Boolean(floor && ranges.some((r) => semver.satisfies(floor, r.range)));
  const installed = staleFloor ? [floor] : installedVersions(name);
  if (!installed.length) continue;
  const majors = new Set(installed.map(compatMajor));
  if (majors.size > 1 && !(name in pkg.overrides)) {
    // A global override would drag every copy onto one major.
    needsHuman.push({ name, installed, ranges, staleFloor, reason: `installed in several majors (${installed.join(', ')}); a global override would force a major bump` });
    continue;
  }
  const safe = lowestSafeVersion(name, installed, ranges);
  if (!safe) {
    needsHuman.push({ name, installed, ranges, staleFloor, reason: `no fixed version within the installed major (${installed.join(', ')})` });
    continue;
  }
  const before = pkg.overrides[name];
  if (typeof before === 'string' && before.startsWith('>=') && semver.valid(before.slice(2)) && semver.gte(before.slice(2), safe)) continue;
  if (before !== undefined && (typeof before !== 'string' || !before.startsWith('>='))) {
    needsHuman.push({ name, installed, ranges, staleFloor, reason: `existing override \`${JSON.stringify(before)}\` is not a plain \`>=\` floor` });
    continue;
  }
  pkg.overrides[name] = `>=${safe}`;
  changes.push(`\`${name}\`: override ${before ? `\`${before}\` → ` : 'added, '}\`>=${safe}\` (was ${installed.join(', ')}; ${ranges.map((r) => r.url).join(', ')})`);
}

if (changes.length) {
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  run('npm install --no-audit --no-fund');
  run('npm audit fix --no-fund');
}

// Final state, as CLAUDE.md requires it: clean with and without --omit=dev.
const left = new Map([...advisoryRanges(audit()), ...advisoryRanges(audit(true))]);
const lockAfter = readFileSync('package-lock.json', 'utf8');
if (lockAfter !== lockBefore) {
  const oldLock = JSON.parse(lockBefore).packages || {};
  for (const [path, p] of Object.entries(JSON.parse(lockAfter).packages || {})) {
    const prev = oldLock[path]?.version;
    if (path && prev && p.version && prev !== p.version) changes.push(`\`${path.replace(/^.*node_modules\//, '')}\` ${prev} → ${p.version} (lockfile)`);
  }
}

const lines = [];
if (changes.length) lines.push('### Applied', '', ...[...new Set(changes)].map((c) => `- ${c}`), '');
// A stale floor that cannot be raised is reported even if the lockfile is clean.
const remaining = [...new Set([...left.keys(), ...needsHuman.filter((h) => h.staleFloor).map((h) => h.name)])].map((name) => needsHuman.find((h) => h.name === name) || { name, installed: installedVersions(name), ranges: left.get(name) || [], reason: 'still vulnerable after the automatic fixes' });
if (remaining.length) {
  lines.push('### Needs a human', '');
  for (const r of remaining) lines.push(`- \`${r.name}\` ${r.installed.join(', ')}: ${r.reason}`, ...r.ranges.map((x) => `  - ${x.title} (\`${x.range}\`) ${x.url}`));
  lines.push('');
}
if (!lines.length) lines.push('npm audit is clean; nothing to do.');
writeFileSync(summaryPath, lines.join('\n'));
log(lines.join('\n'));
log(`package.json ${readFileSync('package.json', 'utf8') === pkgBefore ? 'unchanged' : 'changed'}, lockfile ${lockAfter === lockBefore ? 'unchanged' : 'changed'}`);
process.exit(remaining.length ? 3 : 0);
