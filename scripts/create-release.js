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

### Option 2: Install from npm (coming soon)
\`\`\`bash
npx diabetes-m-mcp
\`\`\`

### Option 3: Clone repository
\`\`\`bash
git clone https://github.com/sedoglia/diabetes-m-mcp.git
cd diabetes-m-mcp
npm install
npm run build
\`\`\`

## What's New in ${tag}

- Fixed API mappings for glucose statistics, insulin analysis, and personal metrics
- Improved food search to include user-created foods from diary
- Added date parameter to get_logbook_entries for specific date queries
- Simplified logbook output for better LLM processing
- All glucose values now correctly displayed in mg/dL
- ICR and ISF now read from user profile settings

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
