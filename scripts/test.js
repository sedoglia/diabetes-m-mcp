#!/usr/bin/env node
/**
 * Test Script - Diabetes:M MCP Server
 *
 * Tests all MCP tools with real API data.
 * Requires credentials to be configured (npm run setup-encryption).
 *
 * Usage: npm test
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const PASS = `${colors.green}✓${colors.reset}`;
const FAIL = `${colors.red}✗${colors.reset}`;
const SKIP = `${colors.yellow}○${colors.reset}`;

/**
 * Gets the config directory
 */
function getConfigDir() {
  const home = homedir();
  switch (process.platform) {
    case 'win32':
      return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'diabetes-m-mcp');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'diabetes-m-mcp');
    default:
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'diabetes-m-mcp');
  }
}

/**
 * Test result tracking
 */
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

/**
 * Logs a test result
 */
function logResult(name, status, message = '', duration = 0) {
  const durationStr = duration > 0 ? `${colors.dim}(${duration}ms)${colors.reset}` : '';

  switch (status) {
    case 'pass':
      console.log(`  ${PASS} ${name} ${durationStr}`);
      if (message) console.log(`    ${colors.dim}${message}${colors.reset}`);
      results.passed++;
      break;
    case 'fail':
      console.log(`  ${FAIL} ${name} ${durationStr}`);
      if (message) console.log(`    ${colors.red}${message}${colors.reset}`);
      results.failed++;
      results.errors.push({ name, message });
      break;
    case 'skip':
      console.log(`  ${SKIP} ${name} ${colors.dim}(skipped)${colors.reset}`);
      if (message) console.log(`    ${colors.yellow}${message}${colors.reset}`);
      results.skipped++;
      break;
  }
}

/**
 * Runs a test with timing
 */
async function runTest(name, testFn) {
  const start = Date.now();
  try {
    const result = await testFn();
    const duration = Date.now() - start;
    logResult(name, 'pass', result, duration);
    return true;
  } catch (error) {
    const duration = Date.now() - start;
    logResult(name, 'fail', error.message, duration);
    return false;
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('');
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}  Diabetes:M MCP Server - Test Suite${colors.reset}`);
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');

  // Check prerequisites
  console.log(`${colors.cyan}▸ Prerequisites${colors.reset}`);

  const configDir = getConfigDir();
  const credentialsPath = join(configDir, 'diabetesm-credentials.enc');

  if (!existsSync(credentialsPath)) {
    logResult('Credentials configured', 'fail', 'Run "npm run setup-encryption" first');
    console.log('');
    console.log(`${colors.red}Cannot run tests without credentials.${colors.reset}`);
    process.exit(1);
  }
  logResult('Credentials configured', 'pass');

  // Import tools (dynamic import after checking prerequisites)
  console.log('');
  console.log(`${colors.cyan}▸ Loading modules...${colors.reset}`);

  let tools;
  try {
    tools = await import('../dist/tools/index.js');
    logResult('Modules loaded', 'pass');
  } catch (error) {
    logResult('Modules loaded', 'fail', `Build required: ${error.message}`);
    console.log('');
    console.log(`${colors.yellow}Run "npm run build" first.${colors.reset}`);
    process.exit(1);
  }

  // Test 1: check_credentials
  console.log('');
  console.log(`${colors.cyan}▸ Credential Tools${colors.reset}`);

  await runTest('check_credentials', async () => {
    const result = await tools.executeCheckCredentials({});
    if (!result.configured) throw new Error('Credentials not configured');
    return `Configured: ${result.configured}, Config dir: ${result.configDir ? 'OK' : 'N/A'}`;
  });

  // Test 2: get_logbook_entries (today)
  console.log('');
  console.log(`${colors.cyan}▸ Data Tools${colors.reset}`);

  await runTest('get_logbook_entries (today)', async () => {
    const result = await tools.executeGetLogbookEntries({ dateRange: 'today' });
    return `${result.summary.totalEntries} entries, ${result.summary.daysWithData} days`;
  });

  // Test 3: get_logbook_entries (7 days)
  await runTest('get_logbook_entries (7days)', async () => {
    const result = await tools.executeGetLogbookEntries({ dateRange: '7days' });
    return `${result.summary.totalEntries} entries, avg glucose: ${result.summary.avgGlucose || 'N/A'}`;
  });

  // Test 4: get_logbook_entries (specific date)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  await runTest(`get_logbook_entries (date: ${yesterdayStr})`, async () => {
    const result = await tools.executeGetLogbookEntries({ date: yesterdayStr });
    return `${result.summary.totalEntries} entries`;
  });

  // Test 5: get_glucose_statistics (7 days)
  await runTest('get_glucose_statistics (7 days)', async () => {
    const result = await tools.executeGetGlucoseStatistics({ period: '7' });
    return `Avg: ${result.average} mg/dL, HbA1c: ${result.estimatedHbA1c}%, TIR: ${result.timeInRange}%`;
  });

  // Test 6: get_glucose_statistics (30 days)
  await runTest('get_glucose_statistics (30 days)', async () => {
    const result = await tools.executeGetGlucoseStatistics({ period: '30' });
    return `Readings: ${result.readingsCount}, CV: ${result.coefficientOfVariation}%`;
  });

  // Test 7: get_insulin_analysis (7 days)
  await runTest('get_insulin_analysis (7 days)', async () => {
    const result = await tools.executeGetInsulinAnalysis({ period: '7' });
    const icr = result.insulinCarbRatio || result.icrByTimeOfDay?.['00:00-11:00'] || 'N/A';
    const isf = result.insulinSensitivity || result.isfByTimeOfDay?.['00:00-11:00'] || 'N/A';
    return `ICR: ${icr}, ISF: ${isf}, Total insulin: ${result.totalInsulin || 'N/A'}u`;
  });

  // Test 8: get_iob (Insulin on Board)
  await runTest('get_iob (DIA=4h)', async () => {
    const result = await tools.executeGetIOB({ dia: 4 });
    return `IOB: ${result.iobFormatted}, Active doses: ${result.activeDoses.length}`;
  });

  // Test 9: get_ic_ratios
  await runTest('get_ic_ratios', async () => {
    const result = await tools.executeGetICRatios({});
    const icDefault = result.icRatios.default || 'N/A';
    const isfDefault = result.isf.default || 'N/A';
    return `IC default: 1u/${icDefault}g, ISF default: ${isfDefault} mg/dL`;
  });

  // Test 10: get_personal_metrics
  await runTest('get_personal_metrics', async () => {
    const result = await tools.executeGetPersonalMetrics({});
    const fields = [];
    if (result.diabetesType) fields.push(`Type: ${result.diabetesType}`);
    if (result.targetGlucoseMin) fields.push(`Target: ${result.targetGlucoseMin}-${result.targetGlucoseMax}`);
    return fields.join(', ') || 'Profile loaded';
  });

  // Test 11: search_foods
  await runTest('search_foods ("pasta")', async () => {
    const result = await tools.executeSearchFoods({ query: 'pasta', limit: 5 });
    return `Found ${result.count} results`;
  });

  // Test 12: search_foods (user foods)
  await runTest('search_foods (user foods)', async () => {
    const result = await tools.executeSearchFoods({ query: 'a', limit: 10 });
    const userFoods = result.foods.filter(f => f.source === 'user');
    return `Found ${userFoods.length} user-created foods`;
  });

  // Test 13: generate_health_report
  await runTest('generate_health_report (7 days)', async () => {
    const result = await tools.executeGenerateHealthReport({ period: '7', format: 'summary' });
    return `Report generated: ${result.summary?.recommendations?.length || 0} recommendations`;
  });

  // Print summary
  console.log('');
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}  Test Summary${colors.reset}`);
  console.log(`${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log('');
  console.log(`  ${colors.green}Passed:${colors.reset}  ${results.passed}`);
  console.log(`  ${colors.red}Failed:${colors.reset}  ${results.failed}`);
  console.log(`  ${colors.yellow}Skipped:${colors.reset} ${results.skipped}`);
  console.log('');

  if (results.errors.length > 0) {
    console.log(`${colors.red}Errors:${colors.reset}`);
    for (const err of results.errors) {
      console.log(`  • ${err.name}: ${err.message}`);
    }
    console.log('');
  }

  const total = results.passed + results.failed;
  const percentage = total > 0 ? Math.round((results.passed / total) * 100) : 0;

  if (results.failed === 0) {
    console.log(`${colors.green}All tests passed! ✓${colors.reset}`);
  } else {
    console.log(`${colors.yellow}${percentage}% tests passed (${results.passed}/${total})${colors.reset}`);
  }
  console.log('');

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`${colors.red}Test suite failed:${colors.reset}`, error.message);
  process.exit(1);
});
