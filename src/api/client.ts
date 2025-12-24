/**
 * HTTP Client for Diabetes:M Analytics API
 *
 * Features:
 * - Automatic authentication handling
 * - Rate limiting
 * - Retry with exponential backoff
 * - Request/response logging
 */

import {
  API_BASE_URL,
  ENDPOINTS,
  REQUEST_TIMEOUT,
  RATE_LIMIT,
  RETRY_CONFIG,
  ERROR_CODES,
  dateRangeToParams
} from './endpoints.js';
import { authManager } from './auth.js';
import { auditLogger } from '../security/audit.js';
import { encryptedCache } from '../cache/encrypted-cache.js';
import type {
  LogbookEntry,
  GlucoseStatistics,
  InsulinAnalysis,
  PersonalMetrics,
  FoodItem,
  HealthReport,
  ApiResponse,
  ApiError
} from '../types/api.js';

/**
 * Rate limiter state
 */
interface RateLimiterState {
  lastRequest: number;
  tokens: number;
  lastRefill: number;
}

/**
 * API Client
 */
class DiabetesMClient {
  private rateLimiter: RateLimiterState = {
    lastRequest: 0,
    tokens: RATE_LIMIT.BURST,
    lastRefill: Date.now()
  };

  /**
   * Waits for rate limit if needed
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Refill tokens based on time passed
    const timePassed = now - this.rateLimiter.lastRefill;
    const tokensToAdd = Math.floor(timePassed / RATE_LIMIT.INTERVAL_MS);

    if (tokensToAdd > 0) {
      this.rateLimiter.tokens = Math.min(
        RATE_LIMIT.BURST,
        this.rateLimiter.tokens + tokensToAdd
      );
      this.rateLimiter.lastRefill = now;
    }

    // If no tokens available, wait
    if (this.rateLimiter.tokens <= 0) {
      const waitTime = RATE_LIMIT.INTERVAL_MS - (now - this.rateLimiter.lastRequest);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      this.rateLimiter.tokens = 1;
    }

    this.rateLimiter.tokens--;
    this.rateLimiter.lastRequest = Date.now();
  }

  /**
   * Makes an authenticated API request with retry logic
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    retryCount: number = 0
  ): Promise<ApiResponse<T>> {
    await this.waitForRateLimit();
    await authManager.ensureAuthenticated();

    const url = `${API_BASE_URL}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        method,
        headers: authManager.getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeout);

      // Handle authentication errors
      if (response.status === 401) {
        const reauthed = await authManager.handleAuthError();
        if (reauthed && retryCount < 1) {
          return this.request<T>(method, endpoint, body, retryCount + 1);
        }
        return {
          success: false,
          error: { code: ERROR_CODES.SESSION_EXPIRED, message: 'Session expired' },
          timestamp: new Date().toISOString()
        };
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '60', 10);
        if (retryCount < RETRY_CONFIG.MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return this.request<T>(method, endpoint, body, retryCount + 1);
        }
        return {
          success: false,
          error: { code: ERROR_CODES.RATE_LIMITED, message: 'Rate limited' },
          timestamp: new Date().toISOString()
        };
      }

      // Handle retryable errors
      if (RETRY_CONFIG.RETRYABLE_STATUS_CODES.includes(response.status)) {
        if (retryCount < RETRY_CONFIG.MAX_RETRIES) {
          const delay = Math.min(
            RETRY_CONFIG.INITIAL_DELAY * Math.pow(RETRY_CONFIG.BACKOFF_FACTOR, retryCount),
            RETRY_CONFIG.MAX_DELAY
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request<T>(method, endpoint, body, retryCount + 1);
        }
      }

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: {
            code: ERROR_CODES.INVALID_RESPONSE,
            message: `Request failed: ${response.status}`,
            details: { body: errorBody }
          },
          timestamp: new Date().toISOString()
        };
      }

      const data = await response.json() as T;
      return {
        success: true,
        data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      clearTimeout(timeout);

      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: { code: ERROR_CODES.NETWORK_ERROR, message: 'Request timed out' },
            timestamp: new Date().toISOString()
          };
        }
      }

      // Retry on network errors
      if (retryCount < RETRY_CONFIG.MAX_RETRIES) {
        const delay = Math.min(
          RETRY_CONFIG.INITIAL_DELAY * Math.pow(RETRY_CONFIG.BACKOFF_FACTOR, retryCount),
          RETRY_CONFIG.MAX_DELAY
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request<T>(method, endpoint, body, retryCount + 1);
      }

      return {
        success: false,
        error: {
          code: ERROR_CODES.NETWORK_ERROR,
          message: error instanceof Error ? error.message : 'Network error'
        },
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * GET request helper
   */
  private async get<T>(endpoint: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    let url = endpoint;
    if (params) {
      const searchParams = new URLSearchParams(params);
      url = `${endpoint}?${searchParams.toString()}`;
    }
    return this.request<T>('GET', url);
  }

  /**
   * POST request helper
   */
  private async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', endpoint, body);
  }

  // ============ API Methods ============

  /**
   * Gets logbook entries for a date range
   * The Diabetes:M API uses POST with fromDate/toDate (milliseconds) in body
   */
  async getLogbookEntries(
    dateRange: string,
    category?: string
  ): Promise<ApiResponse<LogbookEntry[]>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `logbook:${dateRange}:${category || ''}`;

    // Check cache
    const cached = await encryptedCache.get<LogbookEntry[]>(cacheKey);
    if (cached) {
      auditLogger.logOperation('get_logbook_entries', 'get_logbook_entries', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    const { from, to } = dateRangeToParams(dateRange);

    // API uses camelCase fromDate/toDate with millisecond timestamps
    // and various include* flags
    const body: Record<string, unknown> = {
      fromDate: new Date(from).getTime(),
      toDate: new Date(to + 'T23:59:59').getTime(),
      includeGlucose: true,
      includeBolus: true,
      includeBasal: true,
      includeCarbs: true,
      includeSensor: true,
      includeWeight: true,
      includePressure: true,
      includeHbA1c: true,
      isDescOrder: true,
      all: true
    };

    // The API returns { logEntryList: [...], filter: {...}, total_rows: N }
    interface DiaryResponse {
      logEntryList: LogbookEntry[];
      filter: unknown;
      total_rows: number;
      nextPageEntryTime?: number;
    }

    const response = await this.post<DiaryResponse>(ENDPOINTS.LOGBOOK_ENTRIES, body);

    // Transform response to extract just the entries
    let entriesResponse: ApiResponse<LogbookEntry[]>;
    if (response.success && response.data) {
      const entries = response.data.logEntryList || [];
      entriesResponse = {
        success: true,
        data: entries,
        timestamp: new Date().toISOString()
      };
      await encryptedCache.set(cacheKey, entries, 5 * 60 * 1000, true); // 5 min encrypted cache
    } else {
      entriesResponse = {
        success: false,
        error: response.error,
        timestamp: new Date().toISOString()
      };
    }

    auditLogger.logOperation(
      'get_logbook_entries',
      'get_logbook_entries',
      entriesResponse.success,
      timer(),
      cacheKey,
      response.error?.code
    );

    return entriesResponse;
  }

  /**
   * Gets glucose statistics for a period
   */
  async getGlucoseStatistics(period: string): Promise<ApiResponse<GlucoseStatistics>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `glucose_stats:${period}`;

    // Check cache
    const cached = await encryptedCache.get<GlucoseStatistics>(cacheKey);
    if (cached) {
      auditLogger.logOperation('get_glucose_statistics', 'get_glucose_statistics', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    const { from, to } = dateRangeToParams(period);
    const response = await this.get<GlucoseStatistics>(ENDPOINTS.GLUCOSE_STATISTICS, { from, to });

    if (response.success && response.data) {
      await encryptedCache.set(cacheKey, response.data, 5 * 60 * 1000, true); // 5 min encrypted cache
    }

    auditLogger.logOperation(
      'get_glucose_statistics',
      'get_glucose_statistics',
      response.success,
      timer(),
      cacheKey,
      response.error?.code
    );

    return response;
  }

  /**
   * Gets insulin analysis for a period
   */
  async getInsulinAnalysis(period: string): Promise<ApiResponse<InsulinAnalysis>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `insulin_analysis:${period}`;

    // Check cache
    const cached = await encryptedCache.get<InsulinAnalysis>(cacheKey);
    if (cached) {
      auditLogger.logOperation('get_insulin_analysis', 'get_insulin_analysis', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    const { from, to } = dateRangeToParams(period);
    const response = await this.get<InsulinAnalysis>(ENDPOINTS.INSULIN_STATISTICS, { from, to });

    if (response.success && response.data) {
      await encryptedCache.set(cacheKey, response.data, 5 * 60 * 1000, true); // 5 min encrypted cache
    }

    auditLogger.logOperation(
      'get_insulin_analysis',
      'get_insulin_analysis',
      response.success,
      timer(),
      cacheKey,
      response.error?.code
    );

    return response;
  }

  /**
   * Gets personal metrics
   */
  async getPersonalMetrics(): Promise<ApiResponse<PersonalMetrics>> {
    const timer = auditLogger.startTimer();
    const cacheKey = 'personal_metrics';

    // Check cache (shorter TTL for sensitive data)
    const cached = await encryptedCache.get<PersonalMetrics>(cacheKey);
    if (cached) {
      auditLogger.logPersonalMetricsAccess('get_personal_metrics', true, timer(), true, 'cache_hit');
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    const response = await this.get<PersonalMetrics>(ENDPOINTS.PERSONAL_METRICS);

    if (response.success && response.data) {
      await encryptedCache.set(cacheKey, response.data, 2 * 60 * 1000, true); // 2 min encrypted cache (more sensitive)
    }

    auditLogger.logPersonalMetricsAccess(
      'get_personal_metrics',
      response.success,
      timer(),
      true,
      'api_fetch',
      response.error?.code
    );

    return response;
  }

  /**
   * Searches foods database
   * The Diabetes:M API uses POST with query, language, and limit in body
   * Response format: { total, next, nextPageUrl, result: [...] }
   */
  async searchFoods(
    query: string,
    filter?: string,
    language: string = 'en'
  ): Promise<ApiResponse<FoodItem[]>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `foods:${query}:${filter || ''}:${language}`;

    // Check cache (public data, unencrypted)
    const cached = await encryptedCache.get<FoodItem[]>(cacheKey);
    if (cached) {
      auditLogger.logOperation('search_foods', 'search_foods', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    // API uses POST with query, language, and limit
    const body: Record<string, unknown> = {
      query: query,
      language: language.toLowerCase(),
      limit: 50
    };

    // The API returns { total, next, nextPageUrl, result: [...] }
    interface FoodSearchResponse {
      total: number;
      next: boolean;
      nextPageUrl: string | null;
      result: FoodItem[];
    }

    const response = await this.post<FoodSearchResponse>(ENDPOINTS.FOODS_SEARCH, body);

    // Transform response to extract just the results
    let foodsResponse: ApiResponse<FoodItem[]>;
    if (response.success && response.data) {
      const foods = response.data.result || [];
      foodsResponse = {
        success: true,
        data: foods,
        timestamp: new Date().toISOString()
      };
      // Public data, no encryption needed, longer TTL
      await encryptedCache.set(cacheKey, foods, 30 * 60 * 1000, false); // 30 min unencrypted cache
    } else {
      foodsResponse = {
        success: false,
        error: response.error,
        timestamp: new Date().toISOString()
      };
    }

    auditLogger.logOperation(
      'search_foods',
      'search_foods',
      foodsResponse.success,
      timer(),
      cacheKey,
      response.error?.code
    );

    return foodsResponse;
  }

  /**
   * Generates a health report
   */
  async generateHealthReport(
    period: string,
    format: string
  ): Promise<ApiResponse<HealthReport>> {
    const timer = auditLogger.startTimer();

    // Reports are not cached - always generated fresh
    const { from, to } = dateRangeToParams(period);

    const response = await this.post<HealthReport>(ENDPOINTS.GENERATE_REPORT, {
      from,
      to,
      format
    });

    auditLogger.logOperation(
      'generate_health_report',
      'generate_health_report',
      response.success,
      timer(),
      `${period}:${format}`,
      response.error?.code
    );

    return response;
  }

  /**
   * Sets up initial authentication with provided credentials
   */
  async authenticate(email: string, password: string): Promise<boolean> {
    return authManager.login(email, password);
  }

  /**
   * Logs out and clears session
   */
  async logout(): Promise<void> {
    return authManager.logout();
  }

  /**
   * Checks if client is authenticated
   */
  isAuthenticated(): boolean {
    return authManager.isAuthenticated();
  }
}

// Singleton instance
export const diabetesMClient = new DiabetesMClient();
