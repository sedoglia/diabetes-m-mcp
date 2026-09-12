/**
 * Creates a GitHub release with the MCPB bundle
 *
 * Prerequisites:
 * - GitHub CLI (gh) must be installed and authenticated
 * - MCPB bundle must be created first (npm run bundle)
 *
 * Usage:
 *   npm run release
 */

import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read package.json for version
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const version = packageJson.version;
const tag = `v${version}`;
const bundleName = `diabetes-m-mcp-v${version}`;

const releasesDir = join(rootDir, 'releases');
const bundleFile = join(releasesDir, `${bundleName}.mcpb`);
const hashFile = `${bundleFile}.sha256`;

console.log(`Preparing GitHub release: ${tag}`);

// Verify bundle exists
if (!existsSync(bundleFile)) {
  console.error(`Bundle not found: ${bundleFile}`);
  console.error('Run "npm run bundle" first');
  process.exit(1);
}

if (!existsSync(hashFile)) {
  console.error(`Hash file not found: ${hashFile}`);
  process.exit(1);
}

// Read hash for release notes
const hashContent = readFileSync(hashFile, 'utf-8').trim();
const hash = hashContent.split(' ')[0];

// Release notes
const releaseNotes = `# Diabetes:M MCP Server ${tag}

## Installation

### Option 1: Download MCPB Bundle
1. Download \`${bundleName}.mcpb\` from this release
2. Verify SHA256: \`${hash}\`
3. Extract and follow README instructions

### Option 2: Clone repository
\`\`\`bash
git clone https://github.com/sedoglia/diabetes-m-mcp.git
cd diabetes-m-mcp
npm install
npm run build
\`\`\`

## What's New in ${tag}

### Fixed
- The MCPB bundle is now a real ZIP archive (previously a gzip tarball with a \`.mcpb\` extension, which Claude Desktop rejected as corrupted) and ships everything it needs to run: \`manifest.json\`, \`dist/\`, the full \`node_modules\` (including keytar's native build), and the icon. Local \`.claude/\` settings are no longer included in the bundle.

### Security
- Raised the \`hono\` override floor to \`>=4.13.5\` (resolves 4.13.7), closing seven advisories: memo() SSR output retained across requests, Proxy Helper leaking hop-by-hop response headers, ReDoS in the CORS middleware, algorithmic complexity DoS in the Language middleware, incomplete fix for the \`toSSG()\` path traversal (CVE-2026-39408), memory exhaustion via unbounded dot-notation nesting in \`parseBody()\`, and the query parser reading parameters after the URL fragment
- Raised the \`fast-uri\` override floor to \`>=4.1.2\`, closing host confusion via a backslash authority introducer
- Bumped transitive \`ip-address\` 10.2.0 → 10.4.0, \`qs\` 6.15.2 → 6.16.0 and \`brace-expansion\` 5.0.8 → 5.0.9 (Dependabot)
- \`npm audit\` is clean with and without dev dependencies

## SHA256 Checksums
\`\`\`
${hashContent}
\`\`\`

## Requirements
- Node.js >= 18.0.0
- Claude Desktop
- Diabetes:M account

## Documentation
- [README (Italian)](https://github.com/sedoglia/diabetes-m-mcp/blob/main/README.md)
- [README (English)](https://github.com/sedoglia/diabetes-m-mcp/blob/main/README_EN.md)
`;

// Check if gh CLI is available
try {
  execSync('gh --version', { stdio: 'pipe' });
} catch {
  console.error('GitHub CLI (gh) not found. Please install it from https://cli.github.com/');
  console.log('\nAlternatively, create the release manually on GitHub:');
  console.log(`1. Go to https://github.com/sedoglia/diabetes-m-mcp/releases/new`);
  console.log(`2. Tag: ${tag}`);
  console.log(`3. Upload: ${bundleFile}`);
  console.log(`4. Upload: ${hashFile}`);
  process.exit(0);
}

// Check if tag already exists
try {
  execSync(`git tag -l "${tag}"`, { cwd: rootDir, stdio: 'pipe' });
  const existingTag = execSync(`git tag -l "${tag}"`, { cwd: rootDir, encoding: 'utf-8' }).trim();
  if (existingTag === tag) {
    console.log(`Tag ${tag} already exists. Deleting...`);
    execSync(`git tag -d "${tag}"`, { cwd: rootDir, stdio: 'inherit' });
    try {
      execSync(`git push origin :refs/tags/${tag}`, { cwd: rootDir, stdio: 'pipe' });
    } catch {
      // Remote tag might not exist
    }
  }
} catch {
  // Tag doesn't exist, that's fine
}

// Create release
console.log(`\nCreating GitHub release ${tag}...`);
try {
  // Write release notes to temp file
  const notesFile = join(releasesDir, 'release-notes.md');
  const { writeFileSync } = await import('fs');
  writeFileSync(notesFile, releaseNotes);

  // Create release with gh CLI
  execSync(
    `gh release create "${tag}" "${bundleFile}" "${hashFile}" --title "Diabetes:M MCP Server ${tag}" --notes-file "${notesFile}"`,
    { cwd: rootDir, stdio: 'inherit' }
  );

  console.log(`\nRelease ${tag} created successfully!`);
  console.log(`View at: https://github.com/sedoglia/diabetes-m-mcp/releases/tag/${tag}`);

} catch (error) {
  console.error('Error creating release:', error.message);
  console.log('\nYou can create the release manually on GitHub.');
  process.exit(1);
}
