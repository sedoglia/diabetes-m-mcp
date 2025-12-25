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
   * Gets logbook entries for a date range or specific date
   * The Diabetes:M API uses POST with fromDate/toDate (milliseconds) in body
   * @param dateRange - Predefined range: 'today', '7days', '30days', '90days'
   * @param category - Optional category filter
   * @param specificDate - Optional specific date in YYYY-MM-DD format (overrides dateRange)
   */
  async getLogbookEntries(
    dateRange?: string,
    category?: string,
    specificDate?: string
  ): Promise<ApiResponse<LogbookEntry[]>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `logbook:${specificDate || dateRange}:${category || ''}`;

    // Check cache
    const cached = await encryptedCache.get<LogbookEntry[]>(cacheKey);
    if (cached) {
      auditLogger.logOperation('get_logbook_entries', 'get_logbook_entries', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    // Determine date range
    let fromDate: number;
    let toDate: number;

    if (specificDate) {
      // Specific date: from start of day to end of day
      const dateObj = new Date(specificDate + 'T00:00:00');
      fromDate = dateObj.getTime();
      toDate = new Date(specificDate + 'T23:59:59.999').getTime();
    } else if (dateRange) {
      const { from, to } = dateRangeToParams(dateRange);
      fromDate = new Date(from).getTime();
      toDate = new Date(to + 'T23:59:59').getTime();
    } else {
      // Default to today
      const today = new Date().toISOString().split('T')[0];
      fromDate = new Date(today + 'T00:00:00').getTime();
      toDate = new Date(today + 'T23:59:59.999').getTime();
    }

    // API uses camelCase fromDate/toDate with millisecond timestamps
    // and various include* flags
    const body: Record<string, unknown> = {
      fromDate,
      toDate,
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

    // Raw entry format from Diabetes:M API (based on actual API response)
    interface RawLogEntry {
      entry_id?: number;
      entry_time?: number;              // Unix timestamp in milliseconds
      glucose?: number;                 // Value in mmol/L
      glucoseInCurrentUnit?: number;    // Value already converted to user's unit (mg/dL)
      carb_bolus?: number;              // Bolus insulin
      correction_bolus?: number;        // Correction insulin
      basal?: number;                   // Basal insulin
      carbs?: number;                   // Carbohydrates in grams
      proteins?: number;                // Proteins in grams
      fats?: number;                    // Fats in grams
      calories?: number;                // Calories
      notes?: string;                   // Notes/comments
      category?: number;                // Category code (1=breakfast, 2=after breakfast, etc.)
      is_sensor?: boolean;              // Is sensor reading
      food_list?: Array<{               // List of foods
        name: string;
        quantity: number;
        serving: string;
        calories: number;
        total_carbs: number;
        protein: number;
        total_fat: number;
      }>;
      [key: string]: unknown;           // Allow other fields
    }

    // The API returns { logEntryList: [...], filter: {...}, total_rows: N }
    interface DiaryResponse {
      logEntryList: RawLogEntry[];
      filter: unknown;
      total_rows: number;
      nextPageEntryTime?: number;
    }

    /**
     * Maps category number to category name
     */
    const CATEGORY_MAP: Record<number, string> = {
      1: 'breakfast',
      2: 'after_breakfast',
      3: 'lunch',
      4: 'after_lunch',
      5: 'dinner',
      6: 'after_dinner',
      7: 'snack',
      8: 'other',
      9: 'fasting',
      10: 'bedtime'
    };

    /**
     * Maps raw API entry to normalized LogbookEntry format
     * Uses glucoseInCurrentUnit which is already in mg/dL
     */
    function mapToLogbookEntry(raw: RawLogEntry): LogbookEntry {
      // Handle timestamp (entry_time is in milliseconds)
      const timestamp = raw.entry_time
        ? new Date(raw.entry_time).toISOString()
        : new Date().toISOString();

      // Use glucoseInCurrentUnit which is already converted to mg/dL by the API
      // Fall back to converting glucose (mmol/L) if needed
      let glucose: number | undefined;
      if (raw.glucoseInCurrentUnit !== undefined && raw.glucoseInCurrentUnit > 0) {
        glucose = Math.round(raw.glucoseInCurrentUnit);
      } else if (raw.glucose !== undefined && raw.glucose > 0) {
        // Convert from mmol/L to mg/dL
        glucose = Math.round(raw.glucose * 18.0182);
      }

      // Map category number to name
      const categoryName = raw.category !== undefined
        ? CATEGORY_MAP[raw.category] || `category_${raw.category}`
        : undefined;

      return {
        id: String(raw.entry_id || raw.entry_time || Date.now()),
        timestamp,
        glucose,
        glucoseUnit: 'mg/dL',
        insulinBolus: raw.carb_bolus || undefined,
        insulinBasal: raw.basal || undefined,
        insulinCorrection: raw.correction_bolus || undefined,
        carbs: raw.carbs || undefined,
        fat: raw.fats || undefined,
        protein: raw.proteins || undefined,
        calories: raw.calories || undefined,
        notes: raw.notes || undefined,
        category: categoryName,
        isSensor: raw.is_sensor
      };
    }

    const response = await this.post<DiaryResponse>(ENDPOINTS.LOGBOOK_ENTRIES, body);

    // Transform response to extract and normalize entries
    let entriesResponse: ApiResponse<LogbookEntry[]>;
    if (response.success && response.data) {
      const rawEntries = response.data.logEntryList || [];
      const entries = rawEntries.map(mapToLogbookEntry);
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
   * The API returns arrays where indices represent different periods:
   * 0 = 7 days, 1 = 14 days, 2 = 30 days, 3 = 90 days, 4 = today
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

    // Map period to array index
    const periodIndexMap: Record<string, number> = {
      'today': 4,
      '7': 0,
      '14': 1,
      '30': 2,
      '90': 3
    };
    const periodIndex = periodIndexMap[period] ?? 0;

    // Raw API response format
    interface RawStatisticsResponse {
      m_counts: number[];           // Total readings count per period
      m_tooLowCounts: number[];     // Hypo (<54 mg/dL) count
      m_lowCounts: number[];        // Low (54-69 mg/dL) count
      m_normCounts: number[];       // Normal (70-180 mg/dL) count
      m_hiCounts: number[];         // High (181-250 mg/dL) count
      m_tooHiCounts: number[];      // Hyper (>250 mg/dL) count
      m_glucoseLowest: number[];    // Min glucose (mmol/L)
      m_glucoseHighest: number[];   // Max glucose (mmol/L)
      m_glucoseAvgs: number[];      // Average glucose (mmol/L)
      m_estimatedHbA1c: number;     // Estimated HbA1c
      m_deviation: number[];        // Standard deviation (mmol/L)
      m_avgReadingsPerDay: number;  // Average readings per day
      [key: string]: unknown;
    }

    const response = await this.get<RawStatisticsResponse>(ENDPOINTS.GLUCOSE_STATISTICS);

    if (response.success && response.data) {
      const raw = response.data;
      const totalReadings = raw.m_counts?.[periodIndex] || 0;

      // Convert mmol/L to mg/dL (multiply by 18.0182)
      const toMgdl = (mmol: number) => Math.round(mmol * 18.0182);

      // Calculate distribution counts
      const hypoCount = raw.m_tooLowCounts?.[periodIndex] || 0;
      const lowCount = raw.m_lowCounts?.[periodIndex] || 0;
      const normalCount = raw.m_normCounts?.[periodIndex] || 0;
      const highCount = raw.m_hiCounts?.[periodIndex] || 0;
      const hyperCount = raw.m_tooHiCounts?.[periodIndex] || 0;

      // Calculate coefficient of variation (CV = SD / Mean * 100)
      const avgMmol = raw.m_glucoseAvgs?.[periodIndex] || 0;
      const sdMmol = raw.m_deviation?.[periodIndex] || 0;
      const cv = avgMmol > 0 ? (sdMmol / avgMmol) * 100 : 0;

      // Calculate time in range (normal / total * 100)
      const tir = totalReadings > 0 ? (normalCount / totalReadings) * 100 : 0;

      const stats: GlucoseStatistics = {
        distribution: {
          hypo: hypoCount,
          low: lowCount,
          normal: normalCount,
          high: highCount,
          hyper: hyperCount
        },
        average: toMgdl(avgMmol),
        min: toMgdl(raw.m_glucoseLowest?.[periodIndex] || 0),
        max: toMgdl(raw.m_glucoseHighest?.[periodIndex] || 0),
        standardDeviation: toMgdl(sdMmol),
        coefficientOfVariation: Math.round(cv * 10) / 10,
        estimatedHbA1c: Math.round(raw.m_estimatedHbA1c * 10) / 10,
        timeInRange: Math.round(tir * 10) / 10,
        readingsCount: totalReadings,
        period: period === 'today' ? 'Today' : `Last ${period} days`
      };

      await encryptedCache.set(cacheKey, stats, 5 * 60 * 1000, true);

      auditLogger.logOperation(
        'get_glucose_statistics',
        'get_glucose_statistics',
        true,
        timer(),
        cacheKey
      );

      return { success: true, data: stats, timestamp: new Date().toISOString() };
    }

    auditLogger.logOperation(
      'get_glucose_statistics',
      'get_glucose_statistics',
      false,
      timer(),
      cacheKey,
      response.error?.code
    );

    return {
      success: false,
      error: response.error,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Gets insulin analysis for a period
   * Uses statistics endpoint for actual usage data and profile for configured settings
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

    // Map period to array index (same as glucose statistics)
    const periodIndexMap: Record<string, number> = {
      'today': 4,
      '7': 0,
      '14': 1,
      '30': 2,
      '90': 3
    };
    const periodIndex = periodIndexMap[period] ?? 0;
    const daysInPeriod = period === 'today' ? 1 : parseInt(period) || 7;

    // Raw API response format (same endpoint as glucose stats)
    interface RawStatisticsResponse {
      m_insulinAvgs: number[];      // Average daily total insulin
      m_bolusAvgs: number[];        // Average daily bolus
      m_basalAvgs: number[];        // Average daily basal
      m_bolusCorrAvgs: number[];    // Average daily correction bolus
      m_carbAvgs: number[];         // Average daily carbs
      m_insulinCounts: number[];    // Days with insulin data
      m_carbCounts: number[];       // Days with carb data
      m_coverageSum: number;        // Sum for ICR calculation (from actual data)
      m_coverageCounts: number;     // Count for ICR calculation
      m_sensitivitySum: number;     // Sum for ISF calculation (from actual data)
      m_sensitivityCounts: number;  // Count for ISF calculation
      [key: string]: unknown;
    }

    // Also fetch profile to get user-configured ICR and ISF settings
    interface RawProfileResponse {
      settings?: {
        insulin_sensitivity_default?: number;
        insulin_sensitivity_per_hour?: number[];
        carbohydrates_ratio_default?: number;
        carbohydrates_ratio_per_hour?: number[];
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }

    // Fetch both statistics and profile in parallel
    const [statsResponse, profileResponse] = await Promise.all([
      this.get<RawStatisticsResponse>(ENDPOINTS.GLUCOSE_STATISTICS),
      this.get<RawProfileResponse>(ENDPOINTS.PERSONAL_METRICS)
    ]);

    if (statsResponse.success && statsResponse.data) {
      const raw = statsResponse.data;
      const profile = profileResponse.success ? profileResponse.data?.settings : undefined;

      // Get averages for the period
      const avgBolus = raw.m_bolusAvgs?.[periodIndex] || 0;
      const avgBasal = raw.m_basalAvgs?.[periodIndex] || 0;
      const avgCorrection = raw.m_bolusCorrAvgs?.[periodIndex] || 0;
      const avgTotal = raw.m_insulinAvgs?.[periodIndex] || 0;
      const avgCarbs = raw.m_carbAvgs?.[periodIndex] || 0;

      // Calculate totals for period
      const totalBolus = Math.round(avgBolus * daysInPeriod);
      const totalBasal = Math.round(avgBasal * daysInPeriod);
      const totalCorrection = Math.round(avgCorrection * daysInPeriod);
      const totalInsulin = totalBolus + totalBasal + totalCorrection;
      const totalCarbs = Math.round(avgCarbs * daysInPeriod);

      // Calculate percentages
      const bolusPercentage = totalInsulin > 0 ? (totalBolus / totalInsulin) * 100 : 0;
      const basalPercentage = totalInsulin > 0 ? (totalBasal / totalInsulin) * 100 : 0;

      // Get user-configured insulin-to-carb ratio from profile settings
      // carbohydrates_ratio_per_hour is an array with 48 values (every 30 min)
      // We take the first non-zero value as the representative ratio
      let configuredIcr = 0;
      if (profile?.carbohydrates_ratio_per_hour) {
        for (const ratio of profile.carbohydrates_ratio_per_hour) {
          if (ratio > 0) {
            configuredIcr = ratio;
            break;
          }
        }
      }
      if (configuredIcr === 0 && profile?.carbohydrates_ratio_default) {
        configuredIcr = profile.carbohydrates_ratio_default;
      }

      // Get user-configured insulin sensitivity factor from profile settings
      // insulin_sensitivity_per_hour is in mmol/L, need to convert to mg/dL
      let configuredIsf = 0;
      if (profile?.insulin_sensitivity_per_hour) {
        for (const sensitivity of profile.insulin_sensitivity_per_hour) {
          if (sensitivity > 0) {
            configuredIsf = Math.round(sensitivity * 18.0182);
            break;
          }
        }
      }
      if (configuredIsf === 0 && profile?.insulin_sensitivity_default) {
        configuredIsf = Math.round(profile.insulin_sensitivity_default * 18.0182);
      }

      // Use configured values from profile, fall back to calculated from data if not set
      const icr = configuredIcr > 0
        ? configuredIcr
        : (raw.m_coverageCounts > 0
          ? raw.m_coverageSum / raw.m_coverageCounts
          : (avgCarbs > 0 && avgBolus > 0 ? avgCarbs / avgBolus : 0));

      const isf = configuredIsf > 0
        ? configuredIsf
        : (raw.m_sensitivityCounts > 0
          ? Math.round((raw.m_sensitivitySum / raw.m_sensitivityCounts) * 18.0182)
          : 0);

      const analysis: InsulinAnalysis = {
        dailyTotals: {
          bolus: Math.round(avgBolus),
          basal: Math.round(avgBasal),
          correction: Math.round(avgCorrection),
          total: Math.round(avgTotal)
        },
        carbTotals: totalCarbs,
        insulinToCarbRatio: Math.round(icr * 10) / 10,
        correctionFactor: isf,
        averageDailyDose: Math.round(avgTotal * 10) / 10,
        bolusPercentage: Math.round(bolusPercentage * 10) / 10,
        basalPercentage: Math.round(basalPercentage * 10) / 10,
        period: period === 'today' ? 'Today' : `Last ${period} days`
      };

      await encryptedCache.set(cacheKey, analysis, 5 * 60 * 1000, true);

      auditLogger.logOperation(
        'get_insulin_analysis',
        'get_insulin_analysis',
        true,
        timer(),
        cacheKey
      );

      return { success: true, data: analysis, timestamp: new Date().toISOString() };
    }

    auditLogger.logOperation(
      'get_insulin_analysis',
      'get_insulin_analysis',
      false,
      timer(),
      cacheKey,
      statsResponse.error?.code
    );

    return {
      success: false,
      error: statsResponse.error,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Gets personal metrics
   * The API returns nested user/settings objects that need to be mapped
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

    // Raw API response format from /api/v1/user/profile/get_profile
    interface RawProfileResponse {
      token?: string;
      user?: {
        user_id?: number;
        firstname?: string;
        lastname?: string;
        birthdate?: number;
        diabetes_type?: number;      // 1=Type 1, 2=Type 2
        gender?: number;             // 1=Male, 2=Female
        [key: string]: unknown;
      };
      settings?: {
        units?: string;              // 'metric' or 'imperial'
        glucose_unit?: string;       // 'mg_dl' or 'mmol_l'
        current_weight?: number;     // in kg (metric) or lbs (imperial)
        height?: number;             // in cm
        activity_factor?: number;    // 1.2-1.9 range
        insulin_sensitivity_default?: number;  // in mmol/L
        insulin_sensitivity_per_hour?: number[];
        carbohydrates_ratio_default?: number;
        carbohydrates_ratio_per_hour?: number[];
        [key: string]: unknown;
      };
      sub_details?: {
        level?: string;
      };
    }

    const response = await this.get<RawProfileResponse>(ENDPOINTS.PERSONAL_METRICS);

    if (response.success && response.data) {
      const raw = response.data;
      const user = raw.user || {};
      const settings = raw.settings || {};

      // Determine units
      const isMetric = settings.units !== 'imperial';

      // Calculate BMI if weight and height available
      const weight = settings.current_weight;
      const heightCm = settings.height;
      let bmi: number | undefined;
      if (weight !== undefined && heightCm !== undefined && heightCm > 0) {
        const heightM = heightCm / 100;
        bmi = weight / (heightM * heightM);
      }

      // Calculate BMR using Mifflin-St Jeor equation
      let bmr: number | undefined;
      if (weight !== undefined && heightCm !== undefined && user.birthdate !== undefined) {
        const age = Math.floor((Date.now() - user.birthdate) / (365.25 * 24 * 60 * 60 * 1000));
        if (age > 0 && age < 120) {
          // Mifflin-St Jeor: BMR = 10*weight(kg) + 6.25*height(cm) - 5*age + s (s=+5 for male, -161 for female)
          const genderOffset = user.gender === 1 ? 5 : -161;
          bmr = Math.round(10 * weight + 6.25 * heightCm - 5 * age + genderOffset);
        }
      }

      // Calculate daily calorie needs
      let dailyCalorieNeeds: number | undefined;
      if (bmr !== undefined && settings.activity_factor !== undefined) {
        dailyCalorieNeeds = Math.round(bmr * settings.activity_factor);
      }

      // Get insulin sensitivity (convert from mmol/L to mg/dL)
      let insulinSensitivity: number | undefined;
      const isSensitivity = settings.insulin_sensitivity_per_hour?.[0] ||
        settings.insulin_sensitivity_default;
      if (isSensitivity !== undefined && isSensitivity > 0) {
        insulinSensitivity = Math.round(isSensitivity * 18.0182);
      }

      // Map diabetes type
      let diabetesType: string | undefined;
      if (user.diabetes_type === 1) {
        diabetesType = 'Type 1';
      } else if (user.diabetes_type === 2) {
        diabetesType = 'Type 2';
      }

      const metrics: PersonalMetrics = {
        weight: weight,
        weightUnit: isMetric ? 'kg' : 'lbs',
        height: heightCm,
        heightUnit: isMetric ? 'cm' : 'in',
        bmi: bmi !== undefined ? Math.round(bmi * 10) / 10 : undefined,
        bmr: bmr,
        dailyCalorieNeeds: dailyCalorieNeeds,
        insulinSensitivity: insulinSensitivity,
        diabetesType: diabetesType
        // Note: blood pressure, pulse, and HbA1c are not in profile
        // They come from logbook entries with those measurements
      };

      await encryptedCache.set(cacheKey, metrics, 2 * 60 * 1000, true);

      auditLogger.logPersonalMetricsAccess(
        'get_personal_metrics',
        true,
        timer(),
        true,
        'api_fetch'
      );

      return { success: true, data: metrics, timestamp: new Date().toISOString() };
    }

    auditLogger.logPersonalMetricsAccess(
      'get_personal_metrics',
      false,
      timer(),
      true,
      'api_fetch',
      response.error?.code
    );

    return {
      success: false,
      error: response.error,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Searches foods database including user foods extracted from diary entries
   * User foods are stored in diary entries, not in separate endpoints
   */
  async searchFoods(
    query: string,
    filter?: string,
    language: string = 'en'
  ): Promise<ApiResponse<FoodItem[]>> {
    const timer = auditLogger.startTimer();
    const cacheKey = `foods:${query}:${filter || ''}:${language}`;

    // Check cache
    const cached = await encryptedCache.get<FoodItem[]>(cacheKey);
    if (cached) {
      auditLogger.logOperation('search_foods', 'search_foods', true, timer(), cacheKey);
      return { success: true, data: cached, timestamp: new Date().toISOString() };
    }

    // Raw API food item format (from food_list in diary entries)
    interface RawFoodItem {
      food_id?: number;
      input_id?: number;
      name?: string;
      brand?: string;
      category?: string;
      food_type?: string;
      // Nutrition per serving_size
      calories?: number;
      total_carbs?: number;
      protein?: number;
      total_fat?: number;
      fiber?: number;
      sugars?: number;
      sodium?: number;
      saturated_fat?: number;
      trans_fat?: number;
      cholesterol?: number;
      // Serving info
      serving?: string;
      serving_size?: number;
      serving_id?: number;
      quantity?: number;
      // Source info
      barcode?: string;
      external_source_code?: number;  // 0 = user created
      has_ingredients?: boolean;
      glycemic_index?: number;
      [key: string]: unknown;
    }

    interface FoodSearchResponse {
      total: number;
      next: boolean | number;
      nextPageUrl: string | null;
      result: RawFoodItem[];
    }

    // Diary entry with food_list
    interface DiaryEntry {
      food_list?: RawFoodItem[];
      food?: string;  // JSON string of foods (legacy format)
      [key: string]: unknown;
    }

    interface DiaryResponse {
      logEntryList?: DiaryEntry[];
      [key: string]: unknown;
    }

    /**
     * Maps raw API food item to our FoodItem type
     * Normalizes nutrition to per 100g
     */
    const mapToFoodItem = (raw: RawFoodItem, sourceOverride?: 'user' | 'database' | 'recent' | 'favorite'): FoodItem => {
      const servingSize = raw.serving_size || 100;
      const factor = 100 / servingSize;

      // Handle -1 values (means "not available" in the API)
      const safeValue = (val: number | undefined) =>
        val !== undefined && val >= 0 ? val : 0;

      const nutritionPer100g = {
        calories: Math.round(safeValue(raw.calories) * factor),
        carbs: Math.round((safeValue(raw.total_carbs) * factor) * 10) / 10,
        protein: Math.round((safeValue(raw.protein) * factor) * 10) / 10,
        fat: Math.round((safeValue(raw.total_fat) * factor) * 10) / 10,
        fiber: raw.fiber !== undefined && raw.fiber >= 0
          ? Math.round((raw.fiber * factor) * 10) / 10
          : undefined,
        sugar: raw.sugars !== undefined && raw.sugars >= 0
          ? Math.round((raw.sugars * factor) * 10) / 10
          : undefined,
        sodium: raw.sodium !== undefined && raw.sodium >= 0
          ? Math.round(raw.sodium * factor)
          : undefined
      };

      // Determine source - external_source_code 0 means user-created
      let source: 'user' | 'database' | 'recent' | 'favorite' = sourceOverride || 'database';
      if (!sourceOverride && raw.external_source_code === 0) {
        source = 'user';
      }

      return {
        id: String(raw.food_id || raw.input_id || Date.now()),
        name: raw.name || 'Unknown',
        brand: raw.brand,
        category: raw.category || raw.food_type,
        nutritionPer100g,
        servingSizes: [{
          name: raw.serving || 'g',
          grams: servingSize
        }],
        source,
        barcode: raw.barcode,
        language: language
      };
    };

    /**
     * Filters foods by query string (case-insensitive)
     */
    const matchesQuery = (food: RawFoodItem, searchQuery: string): boolean => {
      const q = searchQuery.toLowerCase();
      const name = (food.name || '').toLowerCase();
      const brand = (food.brand || '').toLowerCase();
      return name.includes(q) || brand.includes(q);
    };

    // Collect all foods from different sources
    const allFoods: FoodItem[] = [];
    const seenIds = new Set<string>();

    // Helper to add foods without duplicates (by name, not just ID)
    const addFoods = (foods: FoodItem[]) => {
      for (const food of foods) {
        // Use name as key to avoid duplicates with different IDs
        const key = food.name.toLowerCase();
        if (!seenIds.has(key)) {
          seenIds.add(key);
          allFoods.push(food);
        }
      }
    };

    // 1. Extract user foods from diary entries (last 90 days)
    // This is where user-created foods are stored in Diabetes:M
    if (!filter || filter === 'userCreated' || filter === 'recent') {
      try {
        const now = Date.now();
        const fromDate = now - 90 * 24 * 60 * 60 * 1000;

        const diaryResponse = await this.post<DiaryResponse>(ENDPOINTS.LOGBOOK_ENTRIES, {
          fromDate,
          toDate: now,
          includeCarbs: true,
          all: true
        });

        if (diaryResponse.success && diaryResponse.data?.logEntryList) {
          const foodMap = new Map<string, RawFoodItem>();

          for (const entry of diaryResponse.data.logEntryList) {
            // Get foods from food_list array (preferred)
            const foods = entry.food_list || [];

            // Also try to parse legacy food JSON string
            if (entry.food && typeof entry.food === 'string' && entry.food.length > 2) {
              try {
                const parsedFoods = JSON.parse(entry.food) as RawFoodItem[];
                foods.push(...parsedFoods);
              } catch {
                // Ignore parse errors
              }
            }

            // Add unique foods that match query
            for (const food of foods) {
              if (food.name && matchesQuery(food, query)) {
                const key = food.name.toLowerCase();
                if (!foodMap.has(key)) {
                  foodMap.set(key, food);
                }
              }
            }
          }

          // Convert to FoodItem array
          const diaryFoods = Array.from(foodMap.values())
            .map(f => mapToFoodItem(f, f.external_source_code === 0 ? 'user' : 'recent'));
          addFoods(diaryFoods);
        }
      } catch {
        // Continue if recent endpoint fails
      }
    }

    // 4. Search public database (only if not filtering to user-only sources)
    if (!filter || filter === 'database') {
      const body: Record<string, unknown> = {
        query: query,
        language: language.toLowerCase(),
        limit: 50
      };

      const response = await this.post<FoodSearchResponse>(ENDPOINTS.FOODS_SEARCH, body);
      if (response.success && response.data) {
        const rawFoods = response.data.result || [];
        const foods = rawFoods.map(f => mapToFoodItem(f));
        addFoods(foods);
      }
    }

    // Return combined results
    const foodsResponse: ApiResponse<FoodItem[]> = {
      success: true,
      data: allFoods,
      timestamp: new Date().toISOString()
    };

    // Cache results
    if (allFoods.length > 0) {
      await encryptedCache.set(cacheKey, allFoods, 30 * 60 * 1000, false);
    }

    auditLogger.logOperation(
      'search_foods',
      'search_foods',
      true,
      timer(),
      cacheKey
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
