/**
 * Creates an MCPB (MCP Bundle) file for distribution
 *
 * MCPB format is a tar.gz archive containing:
 * - dist/           Compiled JavaScript files
 * - package.json    Package metadata
 * - manifest.json   MCP manifest
 * - README.md       Documentation
 * - LICENSE         License file
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createGzip } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createHash } from 'crypto';

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

// Files to include in bundle
const filesToInclude = [
  'dist',
  'package.json',
  'manifest.json',
  'README.md',
  'README_EN.md',
  'LICENSE'
];

// Verify all files exist
for (const file of filesToInclude) {
  const filePath = join(rootDir, file);
  if (!existsSync(filePath)) {
    console.error(`Missing required file: ${file}`);
    process.exit(1);
  }
}

console.log('All required files present');

// Create tar.gz using system tar command
const tarFileName = `${bundleName}.mcpb`;
const tarFile = join(releasesDir, tarFileName);
const fileList = filesToInclude.join(' ');

try {
  // Use tar to create the archive (use relative path for Windows compatibility)
  execSync(`tar -czf releases/${tarFileName} ${fileList}`, {
    cwd: rootDir,
    stdio: 'inherit'
  });

  console.log(`Bundle created: ${tarFile}`);

  // Calculate SHA256 hash
  const fileBuffer = readFileSync(tarFile);
  const hashSum = createHash('sha256');
  hashSum.update(fileBuffer);
  const hash = hashSum.digest('hex');

  // Write hash file
  const hashFile = `${tarFile}.sha256`;
  writeFileSync(hashFile, `${hash}  ${bundleName}.mcpb\n`);
  console.log(`SHA256 hash: ${hash}`);
  console.log(`Hash file: ${hashFile}`);

  // Print bundle info
  const stats = readFileSync(tarFile);
  console.log(`\nBundle size: ${(stats.length / 1024).toFixed(2)} KB`);
  console.log(`\nBundle ready for release!`);

} catch (error) {
  console.error('Error creating bundle:', error.message);
  process.exit(1);
}
