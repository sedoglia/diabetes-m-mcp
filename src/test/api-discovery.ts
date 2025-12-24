/**
 * API Discovery and Test Tool
 *
 * This script discovers and tests the Diabetes:M Analytics API endpoints.
 * Run with: npx ts-node src/test/api-discovery.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = 'https://analytics.diabetes-m.com';
const TEST_OUTPUT_DIR = join(homedir(), '.diabetesm', 'test-output');

interface TestResult {
  endpoint: string;
  method: string;
  status: number;
  success: boolean;
  responseType?: string;
  responsePreview?: string;
  headers?: Record<string, string>;
  error?: string;
}

interface SessionState {
  cookies: string[];
  csrfToken?: string;
  sessionId?: string;
  authToken?: string;
}

const session: SessionState = {
  cookies: []
};

/**
 * Ensures test output directory exists
 */
function ensureOutputDir(): void {
  if (!existsSync(TEST_OUTPUT_DIR)) {
    mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Saves test results to file
 */
function saveResults(filename: string, data: unknown): void {
  ensureOutputDir();
  const filepath = join(TEST_OUTPUT_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`Results saved to: ${filepath}`);
}

/**
 * Makes an HTTP request with session handling
 */
async function makeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<{ response: Response; data: unknown }> {
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'en-US,en;q=0.9,it;q=0.8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...extraHeaders
  };

  if (session.cookies.length > 0) {
    headers['Cookie'] = session.cookies.join('; ');
  }

  if (session.csrfToken) {
    headers['X-CSRF-Token'] = session.csrfToken;
  }

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });

  // Capture cookies
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length > 0) {
    session.cookies = [...session.cookies, ...setCookies.map(c => c.split(';')[0] || '')];
    console.log('  Cookies captured:', setCookies.length);
  }

  // Try to parse response
  let data: unknown;
  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = await response.text();
    }
  } else {
    data = await response.text();
  }

  return { response, data };
}

/**
 * Test: Fetch main page to get initial session/CSRF
 */
async function testMainPage(): Promise<TestResult> {
  console.log('\n[TEST] Fetching main page...');

  try {
    const { response, data } = await makeRequest('GET', '/');

    // Look for CSRF token in HTML
    const html = String(data);
    const csrfMatch = html.match(/name="csrf[_-]?token"[^>]*value="([^"]+)"/i) ||
      html.match(/csrf[_-]?token["']?\s*[:=]\s*["']([^"']+)/i);

    if (csrfMatch?.[1]) {
      session.csrfToken = csrfMatch[1];
      console.log('  CSRF token found:', session.csrfToken.substring(0, 20) + '...');
    }

    return {
      endpoint: '/',
      method: 'GET',
      status: response.status,
      success: response.ok,
      responseType: response.headers.get('Content-Type') || undefined,
      responsePreview: html.substring(0, 500)
    };
  } catch (error) {
    return {
      endpoint: '/',
      method: 'GET',
      status: 0,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Test: Try login endpoint
 */
async function testLogin(email: string, password: string): Promise<TestResult> {
  console.log('\n[TEST] Testing login...');

  // Try different login endpoint patterns
  const loginEndpoints = [
    '/api/login',
    '/api/v1/auth/login',
    '/api/auth/login',
    '/login',
    '/api/user/login',
    '/auth/login'
  ];

  for (const endpoint of loginEndpoints) {
    console.log(`  Trying ${endpoint}...`);

    try {
      const { response, data } = await makeRequest('POST', endpoint, {
        email,
        password,
        username: email, // Some APIs use username instead
        remember: true
      });

      console.log(`    Status: ${response.status}`);

      if (response.status !== 404) {
        // Found a valid endpoint
        const result: TestResult = {
          endpoint,
          method: 'POST',
          status: response.status,
          success: response.ok,
          responseType: response.headers.get('Content-Type') || undefined
        };

        if (typeof data === 'object' && data !== null) {
          result.responsePreview = JSON.stringify(data).substring(0, 500);

          // Check for token in response
          const dataObj = data as Record<string, unknown>;
          if (dataObj['token']) {
            session.authToken = String(dataObj['token']);
            console.log('    Auth token received!');
          }
          if (dataObj['sessionId']) {
            session.sessionId = String(dataObj['sessionId']);
            console.log('    Session ID received!');
          }
        }

        return result;
      }
    } catch (error) {
      console.log(`    Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Try form-based login
  console.log('  Trying form-based login...');
  try {
    const formData = new URLSearchParams();
    formData.append('email', email);
    formData.append('password', password);
    if (session.csrfToken) {
      formData.append('_token', session.csrfToken);
      formData.append('csrf_token', session.csrfToken);
    }

    const response = await fetch(`${BASE_URL}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookies.join('; '),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: formData.toString(),
      redirect: 'manual'
    });

    // Capture cookies
    const setCookies = response.headers.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      session.cookies = [...session.cookies, ...setCookies.map(c => c.split(';')[0] || '')];
    }

    console.log(`    Form login status: ${response.status}`);
    console.log(`    Location: ${response.headers.get('Location')}`);

    return {
      endpoint: '/login (form)',
      method: 'POST',
      status: response.status,
      success: response.status === 302 || response.status === 200,
      headers: {
        location: response.headers.get('Location') || '',
        setCookie: setCookies.join(', ')
      }
    };
  } catch (error) {
    return {
      endpoint: '/login (form)',
      method: 'POST',
      status: 0,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Test: Discover API endpoints after login
 */
async function testApiEndpoints(): Promise<TestResult[]> {
  console.log('\n[TEST] Discovering API endpoints...');

  const results: TestResult[] = [];
  const endpoints = [
    // Logbook
    { path: '/api/logbook', method: 'GET' },
    { path: '/api/v1/logbook', method: 'GET' },
    { path: '/api/entries', method: 'GET' },
    { path: '/api/v1/entries', method: 'GET' },
    { path: '/logbook/entries', method: 'GET' },

    // Statistics
    { path: '/api/statistics', method: 'GET' },
    { path: '/api/v1/statistics', method: 'GET' },
    { path: '/api/stats', method: 'GET' },
    { path: '/statistics', method: 'GET' },

    // Profile
    { path: '/api/profile', method: 'GET' },
    { path: '/api/v1/profile', method: 'GET' },
    { path: '/api/user', method: 'GET' },
    { path: '/api/v1/user', method: 'GET' },
    { path: '/profile', method: 'GET' },

    // Foods
    { path: '/api/foods', method: 'GET' },
    { path: '/api/v1/foods', method: 'GET' },
    { path: '/api/food/search?q=test', method: 'GET' },
    { path: '/foods', method: 'GET' },

    // Reports
    { path: '/api/reports', method: 'GET' },
    { path: '/api/v1/reports', method: 'GET' },
    { path: '/reports', method: 'GET' },

    // Dashboard/Overview
    { path: '/api/dashboard', method: 'GET' },
    { path: '/api/v1/dashboard', method: 'GET' },
    { path: '/dashboard', method: 'GET' },
    { path: '/api/overview', method: 'GET' },

    // Data export
    { path: '/api/export', method: 'GET' },
    { path: '/export/csv', method: 'GET' },
    { path: '/export/xls', method: 'GET' }
  ];

  const headers: Record<string, string> = {};
  if (session.authToken) {
    headers['Authorization'] = `Bearer ${session.authToken}`;
  }

  for (const { path, method } of endpoints) {
    try {
      const { response, data } = await makeRequest(method, path, undefined, headers);

      const result: TestResult = {
        endpoint: path,
        method,
        status: response.status,
        success: response.ok && response.status !== 401 && response.status !== 403,
        responseType: response.headers.get('Content-Type') || undefined
      };

      if (response.ok && typeof data === 'object') {
        result.responsePreview = JSON.stringify(data).substring(0, 300);
      }

      results.push(result);

      if (response.ok) {
        console.log(`  ✓ ${path} - ${response.status}`);
      } else if (response.status === 401 || response.status === 403) {
        console.log(`  ⚠ ${path} - ${response.status} (auth required)`);
      }
    } catch (error) {
      results.push({
        endpoint: path,
        method,
        status: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }

  return results;
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Diabetes:M API Discovery Tool');
  console.log('='.repeat(60));

  // Get credentials from command line or prompt
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.log('\nUsage: npx ts-node src/test/api-discovery.ts <email> <password>');
    console.log('\nExample: npx ts-node src/test/api-discovery.ts user@example.com mypassword');
    process.exit(1);
  }

  const allResults: {
    timestamp: string;
    session: SessionState;
    tests: {
      mainPage?: TestResult;
      login?: TestResult;
      endpoints: TestResult[];
    };
  } = {
    timestamp: new Date().toISOString(),
    session: { cookies: [] },
    tests: {
      endpoints: []
    }
  };

  // Test 1: Main page
  allResults.tests.mainPage = await testMainPage();

  // Test 2: Login
  allResults.tests.login = await testLogin(email, password);

  // Test 3: API endpoints
  allResults.tests.endpoints = await testApiEndpoints();

  // Save session state (without sensitive data)
  allResults.session = {
    cookies: session.cookies.map(c => c.split('=')[0] + '=***'),
    csrfToken: session.csrfToken ? '***' : undefined,
    sessionId: session.sessionId ? '***' : undefined,
    authToken: session.authToken ? '***' : undefined
  };

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const workingEndpoints = allResults.tests.endpoints.filter(r => r.success);
  const authRequiredEndpoints = allResults.tests.endpoints.filter(r => r.status === 401 || r.status === 403);

  console.log(`\nLogin: ${allResults.tests.login?.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Working endpoints: ${workingEndpoints.length}`);
  console.log(`Auth required endpoints: ${authRequiredEndpoints.length}`);

  if (workingEndpoints.length > 0) {
    console.log('\nWorking endpoints:');
    workingEndpoints.forEach(r => console.log(`  - ${r.endpoint}`));
  }

  // Save results
  saveResults('api-discovery-results.json', allResults);

  console.log('\n' + '='.repeat(60));
}

// Run tests
runTests().catch(console.error);
