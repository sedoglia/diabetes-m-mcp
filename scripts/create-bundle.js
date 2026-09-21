/**
 * Creates an MCPB (MCP Bundle) file for distribution
 *
 * An MCPB bundle is a ZIP archive (magic bytes "PK") that Claude Desktop
 * unzips and runs directly with `node dist/index.js` — it does NOT run
 * `npm install`, so the bundle must be self-contained. It therefore ships:
 * - manifest.json   MCP manifest (must be at the archive root)
 * - dist/           Compiled JavaScript
 * - node_modules/   Runtime dependencies only (installed with `npm ci --omit=dev`
 *                   in a temporary directory), including the native keytar build
 * - package.json    Package metadata
 * - sbom.cdx.json   CycloneDX SBOM of those runtime dependencies (npm run sbom)
 * - README.md / README_EN.md / LICENSE
 * - Diabetes-M.png  Icon referenced by manifest.json
 *
 * A gzip tarball with a .mcpb extension is rejected by Claude Desktop as a
 * corrupted extension, which is why this uses ZIP via archiver rather than
 * `tar -czf`.
 */

import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { ZipArchive } from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Ensure releases directory exists
const releasesDir = join(rootDir, 'releases');
if (!existsSync(releasesDir)) {
  mkdirSync(releasesDir, { recursive: true });
}

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;
const bundleName = `diabetes-m-mcp-v${version}`;

console.log(`Creating MCPB bundle: ${bundleName}`);

// Files and directories to include, relative to rootDir. manifest.json and the
// icon must be at the archive root for Claude Desktop to find them.
// node_modules is not taken from rootDir: see stageRuntimeDependencies().
const dirsToInclude = ['dist'];
const filesToInclude = [
  'package.json',
  'manifest.json',
  'sbom.cdx.json',
  'README.md',
  'README_EN.md',
  'LICENSE',
  'Diabetes-M.png'
];

// Verify everything exists before we start streaming. A missing dist (e.g.
// bundling before `npm run build`) would silently produce a broken bundle.
for (const entry of [...dirsToInclude, ...filesToInclude]) {
  if (!existsSync(join(rootDir, entry))) {
    console.error(`Missing required entry: ${entry}`);
    if (entry === 'dist') console.error('Run "npm run build" first.');
    process.exit(1);
  }
}

// The SBOM embeds the version it was generated for. `npm run bundle` regenerates
// it right before this script, but a stale copy (e.g. running this script
// directly after a version bump) would misdescribe the bundle.
const sbomFile = join(rootDir, 'sbom.cdx.json');
const sbom = JSON.parse(readFileSync(sbomFile, 'utf-8'));
const sbomVersion = sbom?.metadata?.component?.version;
if (sbomVersion !== version) {
  console.error(`sbom.cdx.json describes version ${sbomVersion}, package.json is ${version}`);
  console.error('Run "npm run sbom" first.');
  process.exit(1);
}

console.log('All required files present');

// Publish the SBOM next to the bundle, under a versioned name, so it can be
// attached to the GitHub release as a separate asset.
const sbomAsset = join(releasesDir, `${bundleName}.cdx.json`);
copyFileSync(sbomFile, sbomAsset);
console.log(`SBOM: ${sbomAsset}`);

/**
 * Installs the runtime dependency tree (dependencies + optionalDependencies,
 * no devDependencies) from the lockfile into a temporary directory and returns
 * the path of its node_modules. The root node_modules cannot be used: it holds
 * typescript, archiver and the SBOM generator, which the server never loads,
 * and pruning it in place would break this very script.
 *
 * The staged package.json drops "scripts": the root `prepare` hook would run
 * `tsc`, which is a devDependency and therefore absent from the staged tree.
 * Dependency scripts still run, so keytar fetches its prebuilt native binary.
 */
function stageRuntimeDependencies() {
  const stageDir = mkdtempSync(join(tmpdir(), `${bundleName}-`));
  const { scripts: _scripts, ...stagedPackageJson } = packageJson;
  writeFileSync(join(stageDir, 'package.json'), JSON.stringify(stagedPackageJson, null, 2) + '\n');
  copyFileSync(join(rootDir, 'package-lock.json'), join(stageDir, 'package-lock.json'));

  console.log(`\nInstalling runtime dependencies in ${stageDir}`);
  execSync('npm ci --omit=dev', { cwd: stageDir, stdio: 'inherit' });

  const stagedModules = join(stageDir, 'node_modules');
  for (const pkg of [...Object.keys(packageJson.dependencies ?? {}), ...Object.keys(packageJson.optionalDependencies ?? {})]) {
    if (!existsSync(join(stagedModules, pkg))) {
      console.error(`Staged node_modules is missing ${pkg}`);
      rmSync(stageDir, { recursive: true, force: true });
      process.exit(1);
    }
  }
  return { stageDir, stagedModules };
}

const { stageDir, stagedModules } = stageRuntimeDependencies();

// The SBOM must describe exactly the tree that ships: every package installed
// in the staged node_modules and nothing else. This catches an SBOM generated
// without `--omit dev` (extra packages) or from a stale install (missing ones).
{
  const installed = new Set(
    execSync('npm ls --all --parseable --omit=dev', { cwd: stageDir, encoding: 'utf-8' })
      .split(/\r?\n/)
      .filter((line) => line && line !== stageDir)
      .map((abs) => relative(stageDir, abs).split(sep).join('/'))
  );
  // Nested installs (node_modules/a/node_modules/b) are nested components in
  // CycloneDX unless the SBOM was flattened, so walk the whole tree.
  const listed = new Set();
  (function collect(components) {
    for (const c of components ?? []) {
      const path = (c.properties ?? []).find((p) => p.name === 'cdx:npm:package:path')?.value;
      if (path) listed.add(path);
      collect(c.components);
    }
  })(sbom.components);
  const extra = [...listed].filter((p) => !installed.has(p));
  const missing = [...installed].filter((p) => !listed.has(p));
  if (extra.length > 0 || missing.length > 0) {
    if (extra.length > 0) console.error(`sbom.cdx.json lists packages the bundle does not ship: ${extra.join(', ')}`);
    if (missing.length > 0) console.error(`sbom.cdx.json misses packages the bundle ships: ${missing.join(', ')}`);
    console.error('Run "npm run sbom" first.');
    rmSync(stageDir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`SBOM matches the staged tree (${installed.size} packages)`);
}

const tarFileName = `${bundleName}.mcpb`;
const tarFile = join(releasesDir, tarFileName);

const output = createWriteStream(tarFile);
const archive = new ZipArchive({ zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('warning', (err) => {
    // ENOENT on a symlink target (e.g. node_modules/.bin) is non-fatal.
    if (err.code === 'ENOENT') console.warn(`Warning: ${err.message}`);
    else reject(err);
  });
  archive.on('error', reject);
});

archive.pipe(output);

for (const dir of dirsToInclude) {
  archive.directory(join(rootDir, dir), dir);
}
archive.directory(stagedModules, 'node_modules');
for (const file of filesToInclude) {
  archive.file(join(rootDir, file), { name: file });
}

await archive.finalize();
await done;
rmSync(stageDir, { recursive: true, force: true });

console.log(`Bundle created: ${tarFile}`);

// Calculate SHA256 hash
const fileBuffer = readFileSync(tarFile);
const hash = createHash('sha256').update(fileBuffer).digest('hex');

// Write hash file
const hashFile = `${tarFile}.sha256`;
writeFileSync(hashFile, `${hash}  ${bundleName}.mcpb\n`);
console.log(`SHA256 hash: ${hash}`);
console.log(`Hash file: ${hashFile}`);

// Sanity check: reject a bundle that is not a ZIP (first two bytes "PK").
if (fileBuffer[0] !== 0x50 || fileBuffer[1] !== 0x4b) {
  console.error('Bundle is not a valid ZIP archive (missing PK signature)');
  process.exit(1);
}

const sizeKB = (statSync(tarFile).size / 1024).toFixed(2);
console.log(`\nBundle size: ${sizeKB} KB`);
console.log(`\nBundle ready for release!`);
