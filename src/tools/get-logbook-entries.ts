/**
 * Tool: get_logbook_entries
 *
 * Retrieves logbook entries from Diabetes:M including glucose readings,
 * insulin doses, carbs, and notes for a specified date range.
 *
 * Output is simplified and optimized for LLM analysis:
 * - Entries grouped by day with daily summaries
 * - Human-readable formatting
 * - Only non-null fields included
 *
 * Security:
 * - Input validation with Zod
 * - Rate limit: 1 request/second
 * - Audit logging
 * - Encrypted cache
 */

import { diabetesMClient } from '../api/client.js';
import { GetLogbookEntriesInputSchema } from '../types/tools.js';
import type { LogbookEntry, SimplifiedLogbookEntry, DailySummary, SimplifiedLogbookResult } from '../types/api.js';

export const getLogbookEntriesToolDefinition = {
  name: 'get_logbook_entries',
  description: 'Retrieve logbook entries from Diabetes:M including glucose readings, insulin doses, carbs, and notes. You can specify either a predefined date range OR a specific date OR a custom date range with startDate and endDate. Returns data grouped by day with summaries optimized for analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string',
        enum: ['today', '7days', '30days', '90days'],
        description: 'Predefined time range for logbook entries (use this OR date OR startDate+endDate)'
      },
      date: {
        type: 'string',
        description: 'Specific date in YYYY-MM-DD format (e.g., 2025-12-25). Use this OR dateRange OR startDate+endDate.'
      },
      startDate: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format for custom date range (must be used together with endDate)'
      },
      endDate: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format for custom date range (must be used together with startDate)'
      },
      category: {
        type: 'string',
        description: 'Optional category filter (e.g., breakfast, lunch, dinner)'
      }
    }
  },
  annotations: {
    title: 'Get Logbook Entries',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

// Keep for backward compatibility
export interface GetLogbookEntriesResult {
  entries: LogbookEntry[];
  count: number;
  dateRange: string;
  period: { from: string; to: string };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a date as "Jan 15" or "Jan 15, 2024"
 */
function formatDate(date: Date, includeYear = false): string {
  const month = MONTHS[date.getMonth()];
  const day = date.getDate();
  return includeYear ? `${month} ${day}, ${date.getFullYear()}` : `${month} ${day}`;
}

/**
 * Formats a date as "2024-01-15 (Mon)"
 */
function formatDateWithDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dayName = DAYS[date.getDay()];
  return `${year}-${month}-${day} (${dayName})`;
}

/**
 * Formats time as "14:30"
 */
function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Simplifies a single logbook entry for LLM consumption
 */
function simplifyEntry(entry: LogbookEntry): SimplifiedLogbookEntry {
  const date = new Date(entry.timestamp);
  const simplified: SimplifiedLogbookEntry = {
    time: formatTime(date)
  };

  // Format glucose (always in mg/dL)
  if (entry.glucose !== undefined) {
    simplified.glucose = `${entry.glucose} mg/dL`;
  }

  // Format insulin (compact)
  const insulinParts: string[] = [];
  if (entry.insulinBolus) insulinParts.push(`${entry.insulinBolus}u bolus`);
  if (entry.insulinBasal) insulinParts.push(`${entry.insulinBasal}u basal`);
  if (entry.insulinCorrection) insulinParts.push(`${entry.insulinCorrection}u corr`);
  if (insulinParts.length > 0) {
    simplified.insulin = insulinParts.join(', ');
  }

  // Format meal (compact)
  if (entry.carbs || entry.calories) {
    const mealParts: string[] = [];
    if (entry.carbs) mealParts.push(`${entry.carbs}g carbs`);
    if (entry.calories) mealParts.push(`${entry.calories} cal`);
    simplified.meal = mealParts.join(', ');
  }

  // Include notes and category only if present
  if (entry.notes) simplified.notes = entry.notes;
  if (entry.category) simplified.category = entry.category;

  return simplified;
}

/**
 * Groups entries by date and creates daily summaries
 */
function groupByDay(entries: LogbookEntry[]): DailySummary[] {
  const groups = new Map<string, LogbookEntry[]>();

  // Group entries by date
  for (const entry of entries) {
    const date = new Date(entry.timestamp);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    if (!groups.has(dateKey)) {
      groups.set(dateKey, []);
    }
    groups.get(dateKey)!.push(entry);
  }

  // Sort dates descending (most recent first)
  const sortedDates = Array.from(groups.keys()).sort().reverse();

  return sortedDates.map(dateKey => {
    const dayEntries = groups.get(dateKey)!;
    const date = new Date(dateKey + 'T12:00:00');

    // Calculate glucose stats for the day
    const glucoseValues = dayEntries
      .filter(e => e.glucose !== undefined)
      .map(e => e.glucose!);

    // Calculate insulin totals
    let totalBolus = 0, totalBasal = 0, totalCorrection = 0;
    let totalCarbs = 0, totalCalories = 0;

    for (const entry of dayEntries) {
      if (entry.insulinBolus) totalBolus += entry.insulinBolus;
      if (entry.insulinBasal) totalBasal += entry.insulinBasal;
      if (entry.insulinCorrection) totalCorrection += entry.insulinCorrection;
      if (entry.carbs) totalCarbs += entry.carbs;
      if (entry.calories) totalCalories += entry.calories;
    }

    const summary: DailySummary = {
      date: formatDateWithDay(date),
      glucoseReadings: glucoseValues.length,
      entries: dayEntries
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map(simplifyEntry)
    };

    // Add glucose stats if available (always in mg/dL)
    if (glucoseValues.length > 0) {
      const avg = Math.round(glucoseValues.reduce((a, b) => a + b, 0) / glucoseValues.length);
      const min = Math.min(...glucoseValues);
      const max = Math.max(...glucoseValues);
      summary.glucoseAvg = `${avg} mg/dL`;
      if (min !== max) {
        summary.glucoseRange = `${min}-${max} mg/dL`;
      }
    }

    // Add insulin totals if available
    const totalInsulin = totalBolus + totalBasal + totalCorrection;
    if (totalInsulin > 0) {
      const parts: string[] = [];
      if (totalBolus) parts.push(`${totalBolus}u bolus`);
      if (totalBasal) parts.push(`${totalBasal}u basal`);
      if (totalCorrection) parts.push(`${totalCorrection}u corr`);
      summary.totalInsulin = `${totalInsulin}u (${parts.join(', ')})`;
    }

    // Add nutrition totals if available
    if (totalCarbs > 0) summary.totalCarbs = totalCarbs;
    if (totalCalories > 0) summary.totalCalories = totalCalories;

    return summary;
  });
}

/**
 * Executes the get_logbook_entries tool
 */
export async function executeGetLogbookEntries(
  args: unknown
): Promise<SimplifiedLogbookResult> {
  // Validate input
  const validatedInput = GetLogbookEntriesInputSchema.parse(args);
  const { dateRange, date, startDate, endDate, category } = validatedInput;

  // Make API call with either dateRange, specific date, or custom startDate+endDate
  const response = await diabetesMClient.getLogbookEntries(dateRange, category, date, startDate, endDate);

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || 'Failed to retrieve logbook entries'
    );
  }

  const entries = response.data;

  // Calculate date range for response
  const now = new Date();
  let periodLabel: string;

  if (startDate && endDate) {
    // Custom date range provided
    const from = new Date(startDate + 'T12:00:00');
    const to = new Date(endDate + 'T12:00:00');
    periodLabel = `${formatDate(from)}-${formatDate(to, true)}`;
  } else if (date) {
    // Specific date provided
    const specificDate = new Date(date + 'T12:00:00');
    periodLabel = formatDateWithDay(specificDate);
  } else {
    // Date range provided
    switch (dateRange) {
      case 'today':
        periodLabel = `Today (${formatDate(now, true)})`;
        break;
      case '7days': {
        const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        periodLabel = `Last 7 days (${formatDate(from)}-${formatDate(now, true)})`;
        break;
      }
      case '30days': {
        const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        periodLabel = `Last 30 days (${formatDate(from)}-${formatDate(now, true)})`;
        break;
      }
      case '90days': {
        const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        periodLabel = `Last 90 days (${formatDate(from)}-${formatDate(now, true)})`;
        break;
      }
      default:
        periodLabel = `Today (${formatDate(now, true)})`;
    }
  }

  // Group entries by day
  const dailyData = groupByDay(entries);

  // Calculate overall averages
  const allGlucose = entries.filter(e => e.glucose !== undefined).map(e => e.glucose!);
  const totalInsulin = entries.reduce((sum, e) =>
    sum + (e.insulinBolus || 0) + (e.insulinBasal || 0) + (e.insulinCorrection || 0), 0);
  const totalCarbs = entries.reduce((sum, e) => sum + (e.carbs || 0), 0);
  const daysWithData = dailyData.length;

  const summary: SimplifiedLogbookResult['summary'] = {
    period: periodLabel,
    totalEntries: entries.length,
    daysWithData
  };

  if (allGlucose.length > 0) {
    const avgGlucose = Math.round(allGlucose.reduce((a, b) => a + b, 0) / allGlucose.length);
    summary.avgGlucose = `${avgGlucose} mg/dL`;
  }

  if (totalInsulin > 0 && daysWithData > 0) {
    summary.avgDailyInsulin = `${Math.round(totalInsulin / daysWithData)}u`;
  }

  if (totalCarbs > 0 && daysWithData > 0) {
    summary.avgDailyCarbs = Math.round(totalCarbs / daysWithData);
  }

  return {
    summary,
    dailyData
  };
}
