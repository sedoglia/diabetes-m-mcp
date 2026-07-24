/**
 * Creates an MCPB (MCP Bundle) file for distribution
 *
 * An MCPB bundle is a ZIP archive (magic bytes "PK") that Claude Desktop
 * unzips and runs directly with `node dist/index.js` — it does NOT run
 * `npm install`, so the bundle must be self-contained. It therefore ships:
 * - manifest.json   MCP manifest (must be at the archive root)
 * - dist/           Compiled JavaScript
 * - node_modules/   Runtime dependencies, including the native keytar build
 * - package.json    Package metadata
 * - README.md / README_EN.md / LICENSE
 * - Diabetes-M.png  Icon referenced by manifest.json
 *
 * A gzip tarball with a .mcpb extension is rejected by Claude Desktop as a
 * corrupted extension, which is why this uses ZIP via archiver rather than
 * `tar -czf`.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
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
const dirsToInclude = ['dist', 'node_modules'];
const filesToInclude = [
  'package.json',
  'manifest.json',
  'README.md',
  'README_EN.md',
  'LICENSE',
  'Diabetes-M.png'
];

// Verify everything exists before we start streaming. A missing node_modules
// (e.g. bundling before `npm install`) would silently produce a broken bundle.
for (const entry of [...dirsToInclude, ...filesToInclude]) {
  if (!existsSync(join(rootDir, entry))) {
    console.error(`Missing required entry: ${entry}`);
    if (entry === 'node_modules') console.error('Run "npm install" first.');
    process.exit(1);
  }
}

console.log('All required files present');

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
for (const file of filesToInclude) {
  archive.file(join(rootDir, file), { name: file });
}

await archive.finalize();
await done;

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
