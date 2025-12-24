/**
 * Diabetes:M API Endpoints
 *
 * NOTE: These endpoints are reverse-engineered from the analytics.diabetes-m.com
 * web portal. They may change without notice. The client includes fallback
 * mechanisms and clear error messages when endpoints change.
 */

export const API_BASE_URL = 'https://analytics.diabetes-m.com';

/**
 * API Endpoints (discovered via bundle.js reverse engineering)
 * Verified working with real API on 2025-01-XX
 */
export const ENDPOINTS = {
  // Authentication
  LOGIN: '/api/v1/user/authentication/login_v2',
  LOGOUT: '/api/v1/user/authentication/logout',
  REFRESH_TOKEN: '/api/v1/user/authentication/refresh',
  VERIFY_SESSION: '/api/v1/user/authentication/verify',

  // User Profile & Settings
  PROFILE: '/api/v1/user/profile/get_profile',
  UPDATE_PROFILE: '/api/v1/user/profile/update',
  SETTINGS: '/api/v1/user/settings/get',
  UPDATE_SETTINGS: '/api/v1/user/settings/update',
  PERSONAL_METRICS: '/api/v1/user/profile/get_profile', // Same as PROFILE - contains all metrics

  // Statistics
  GLUCOSE_STATISTICS: '/api/v1/stats/common_stats/get',
  INSULIN_STATISTICS: '/api/v1/stats/common_stats/get', // Same endpoint, different data
  OVERVIEW: '/api/v1/stats/common_stats/get',

  // Charts
  GLUCOSE_CHART: '/api/v1/charts/glucose_history',
  CHART_VIEW_INDEX: (viewIndex: number) => `/api/v1/charts/glucose_history?viewIndex=${viewIndex}`,

  // Diary/Logbook
  LOGBOOK: '/api/v1/diary/entries/list',
  LOGBOOK_ENTRIES: '/api/v1/diary/entries/list',
  DIARY_CALENDAR: '/api/v1/diary/entries/calendar',
  DIARY_ENTRY: (id: string) => `/api/v1/diary/entries/${id}`,
  CREATE_ENTRY: '/api/v1/diary/entries/create',
  UPDATE_ENTRY: '/api/v1/diary/entries/update',
  DELETE_ENTRY: '/api/v1/diary/entries/delete',

  // Foods
  FOODS_SEARCH: '/api/v1/food/search_with_servings',
  FOODS_FAVORITES: '/api/v1/food/favorites/list',
  FOODS_RECENT: '/api/v1/food/recent/list',
  FOODS_USER: '/api/v1/food/user/list',
  FOOD_DETAILS: (id: string) => `/api/v1/food/${id}`,

  // Reports
  REPORTS_LIST: '/api/v1/reports/manage/list',
  GENERATE_REPORT: '/api/v1/reports/manage/create',
  REPORT_DOWNLOAD: (token: string) => `/api/v1/reports/manage/download/${token}`,

  // Data export
  EXPORT_CSV: '/api/v1/export/csv',
  EXPORT_XLS: '/api/v1/export/xls'
} as const;

/**
 * HTTP Methods
 */
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE'
} as const;

/**
 * Default headers for API requests
 */
export const DEFAULT_HEADERS: Record<string, string> = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'DiabetesM-MCP/1.0'
};

/**
 * Request timeout in milliseconds
 */
export const REQUEST_TIMEOUT = 30000;

/**
 * Rate limit configuration
 */
export const RATE_LIMIT = {
  /** Minimum interval between requests in ms */
  INTERVAL_MS: 1000,
  /** Maximum requests per minute */
  MAX_PER_MINUTE: 30,
  /** Burst allowance */
  BURST: 5
};

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  /** Maximum number of retries */
  MAX_RETRIES: 3,
  /** Initial retry delay in ms */
  INITIAL_DELAY: 1000,
  /** Backoff multiplier */
  BACKOFF_FACTOR: 2,
  /** Maximum delay in ms */
  MAX_DELAY: 10000,
  /** HTTP status codes that trigger retry */
  RETRYABLE_STATUS_CODES: [408, 429, 500, 502, 503, 504]
};

/**
 * Date range to API parameter mapping
 */
export function dateRangeToParams(dateRange: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split('T')[0] as string;
  let from: string;

  switch (dateRange) {
    case 'today':
      from = to;
      break;
    case '7days':
    case '7':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    case '14':
      from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    case '30days':
    case '30':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    case '90days':
    case '90':
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    default:
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
  }

  return { from, to };
}

/**
 * Error codes
 */
export const ERROR_CODES = {
  AUTHENTICATION_FAILED: 'AUTH_FAILED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  API_CHANGED: 'API_CHANGED',
  NOT_FOUND: 'NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;
