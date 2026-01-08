/**
 * Tool: get_ic_ratios
 *
 * Retrieves the configured Insulin-to-Carb (IC) ratios and Insulin Sensitivity
 * Factors (ISF) from the user's Diabetes:M profile, organized by meal time.
 *
 * The Diabetes:M API stores these values as arrays of 48 elements (one per
 * 30-minute interval). This tool converts them to a more readable format
 * grouped by meal times (breakfast, lunch, dinner, night).
 *
 * Security:
 * - Input validation with Zod
 * - Rate limit: 1 request/second
 * - Audit logging
 */

import { diabetesMClient } from '../api/client.js';
import { API_BASE_URL, ENDPOINTS } from '../api/endpoints.js';
import { authManager } from '../api/auth.js';
import { auditLogger } from '../security/audit.js';
import { encryptedCache } from '../cache/encrypted-cache.js';

/**
 * IC Ratios result structure
 */
export interface ICRatiosResult {
  /** IC ratios by time period */
  icRatios: {
    /** Breakfast (06:00-10:00) */
    breakfast: number | null;
    /** Lunch (11:00-14:00) */
    lunch: number | null;
    /** Dinner (17:00-21:00) */
    dinner: number | null;
    /** Night/Other (21:00-06:00) */
    night: number | null;
    /** Default value if no time-specific values */
    default: number | null;
  };
  /** ISF (Insulin Sensitivity Factor) by time period, in mg/dL */
  isf: {
    breakfast: number | null;
    lunch: number | null;
    dinner: number | null;
    night: number | null;
    default: number | null;
  };
  /** Full 48-value arrays (every 30 min) if available */
  rawData?: {
    icRatioPerHour: number[];
    isfPerHour: number[];
  };
  /** Timestamp of retrieval */
  retrievedAt: string;
  /** Summary message */
  summary: string;
}

export const getICRatiosToolDefinition = {
  name: 'get_ic_ratios',
  description: 'Get the configured Insulin-to-Carb (IC) ratios and Insulin Sensitivity Factors (ISF) from your Diabetes:M profile. Returns values organized by meal time (breakfast, lunch, dinner, night). IC ratio indicates how many grams of carbs are covered by 1 unit of insulin. ISF indicates how much 1 unit of insulin lowers blood glucose (in mg/dL).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      includeRawData: {
        type: 'boolean',
        description: 'Include the full 48-value arrays (every 30 minutes) in the response. Default is false.',
        default: false
      }
    }
  },
  annotations: {
    title: 'Get IC Ratios & ISF',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

/**
 * Time period definitions (indices in 48-element array)
 * Each index represents 30 minutes, starting from midnight
 * Index 0 = 00:00-00:30, Index 1 = 00:30-01:00, etc.
 */
const TIME_PERIODS = {
  // Breakfast: 06:00-10:00 (indices 12-19)
  breakfast: { start: 12, end: 20 },
  // Lunch: 11:00-14:00 (indices 22-27)
  lunch: { start: 22, end: 28 },
  // Dinner: 17:00-21:00 (indices 34-41)
  dinner: { start: 34, end: 42 },
  // Night: 21:00-06:00 (indices 42-47, 0-11)
  night: { start: 42, end: 48, wrapStart: 0, wrapEnd: 12 }
};

/**
 * Extracts the most representative value from a time period
 * Uses the median of non-zero values
 */
function getValueForPeriod(
  array: number[] | undefined,
  period: { start: number; end: number; wrapStart?: number; wrapEnd?: number }
): number | null {
  if (!array || array.length !== 48) return null;

  const values: number[] = [];

  // Get values from main range
  for (let i = period.start; i < period.end && i < 48; i++) {
    const val = array[i];
    if (val !== undefined && val > 0) {
      values.push(val);
    }
  }

  // Handle wrap-around for night period
  if (period.wrapStart !== undefined && period.wrapEnd !== undefined) {
    for (let i = period.wrapStart; i < period.wrapEnd; i++) {
      const val = array[i];
      if (val !== undefined && val > 0) {
        values.push(val);
      }
    }
  }

  if (values.length === 0) return null;

  // Return median value (most representative)
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[mid - 1]! + values[mid]!) / 2
    : values[mid]!;

  return Math.round(median * 10) / 10;
}

/**
 * Gets the first non-zero value or default
 */
function getFirstNonZero(array: number[] | undefined, defaultValue: number | undefined): number | null {
  if (array) {
    for (const val of array) {
      if (val > 0) return val;
    }
  }
  return defaultValue !== undefined && defaultValue > 0 ? defaultValue : null;
}

/**
 * Executes the get_ic_ratios tool
 */
export async function executeGetICRatios(args: unknown): Promise<ICRatiosResult> {
  const timer = auditLogger.startTimer();
  const includeRawData = (args as { includeRawData?: boolean })?.includeRawData ?? false;

  const cacheKey = 'ic_ratios';

  // Check cache
  const cached = await encryptedCache.get<ICRatiosResult>(cacheKey);
  if (cached) {
    auditLogger.logOperation('get_ic_ratios', 'get_ic_ratios', true, timer(), cacheKey);
    // Adjust raw data based on request
    if (!includeRawData && cached.rawData) {
      const { ...result } = cached;
      delete result.rawData;
      return result;
    }
    return cached;
  }

  // Raw API response format
  interface RawProfileResponse {
    settings?: {
      insulin_sensitivity_default?: number;
      insulin_sensitivity_per_hour?: number[];
      carbohydrates_ratio_default?: number;
      carbohydrates_ratio_per_hour?: number[];
    };
  }

  // Ensure authenticated
  await authManager.ensureAuthenticated();

  // Fetch profile
  const response = await fetch(`${API_BASE_URL}${ENDPOINTS.PERSONAL_METRICS}`, {
    method: 'GET',
    headers: authManager.getAuthHeaders()
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.status}`);
  }

  const data = await response.json() as RawProfileResponse;
  const settings = data.settings || {};

  // Extract IC ratios
  const icPerHour = settings.carbohydrates_ratio_per_hour;
  const icDefault = settings.carbohydrates_ratio_default;

  // Extract ISF (convert from mmol/L to mg/dL)
  const isfPerHourRaw = settings.insulin_sensitivity_per_hour;
  const isfDefaultRaw = settings.insulin_sensitivity_default;

  // Convert ISF array from mmol/L to mg/dL
  const isfPerHour = isfPerHourRaw?.map(v => v > 0 ? Math.round(v * 18.0182) : 0);
  const isfDefault = isfDefaultRaw !== undefined && isfDefaultRaw > 0
    ? Math.round(isfDefaultRaw * 18.0182)
    : undefined;

  // Calculate values for each time period
  const icRatios = {
    breakfast: getValueForPeriod(icPerHour, TIME_PERIODS.breakfast),
    lunch: getValueForPeriod(icPerHour, TIME_PERIODS.lunch),
    dinner: getValueForPeriod(icPerHour, TIME_PERIODS.dinner),
    night: getValueForPeriod(icPerHour, TIME_PERIODS.night),
    default: getFirstNonZero(icPerHour, icDefault)
  };

  const isf = {
    breakfast: getValueForPeriod(isfPerHour, TIME_PERIODS.breakfast),
    lunch: getValueForPeriod(isfPerHour, TIME_PERIODS.lunch),
    dinner: getValueForPeriod(isfPerHour, TIME_PERIODS.dinner),
    night: getValueForPeriod(isfPerHour, TIME_PERIODS.night),
    default: getFirstNonZero(isfPerHour, isfDefault)
  };

  // Build summary
  const icParts: string[] = [];
  if (icRatios.breakfast) icParts.push(`Breakfast: 1u/${icRatios.breakfast}g`);
  if (icRatios.lunch) icParts.push(`Lunch: 1u/${icRatios.lunch}g`);
  if (icRatios.dinner) icParts.push(`Dinner: 1u/${icRatios.dinner}g`);
  if (icRatios.night) icParts.push(`Night: 1u/${icRatios.night}g`);

  const isfParts: string[] = [];
  if (isf.breakfast) isfParts.push(`Breakfast: ${isf.breakfast} mg/dL`);
  if (isf.lunch) isfParts.push(`Lunch: ${isf.lunch} mg/dL`);
  if (isf.dinner) isfParts.push(`Dinner: ${isf.dinner} mg/dL`);
  if (isf.night) isfParts.push(`Night: ${isf.night} mg/dL`);

  let summary = '';
  if (icParts.length > 0) {
    summary += `IC Ratios: ${icParts.join(', ')}. `;
  } else if (icRatios.default) {
    summary += `IC Ratio (default): 1u/${icRatios.default}g. `;
  } else {
    summary += 'No IC ratios configured. ';
  }

  if (isfParts.length > 0) {
    summary += `ISF: ${isfParts.join(', ')}.`;
  } else if (isf.default) {
    summary += `ISF (default): ${isf.default} mg/dL.`;
  } else {
    summary += 'No ISF configured.';
  }

  const result: ICRatiosResult = {
    icRatios,
    isf,
    retrievedAt: new Date().toISOString(),
    summary: summary.trim()
  };

  // Add raw data if requested
  if (includeRawData && (icPerHour || isfPerHour)) {
    result.rawData = {
      icRatioPerHour: icPerHour || [],
      isfPerHour: isfPerHour || []
    };
  }

  // Cache for 5 minutes
  await encryptedCache.set(cacheKey, { ...result, rawData: { icRatioPerHour: icPerHour || [], isfPerHour: isfPerHour || [] } }, 5 * 60 * 1000, true);

  auditLogger.logOperation('get_ic_ratios', 'get_ic_ratios', true, timer(), cacheKey);

  return result;
}
