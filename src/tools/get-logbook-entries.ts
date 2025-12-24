/**
 * Tool: get_logbook_entries
 *
 * Retrieves logbook entries from Diabetes:M including glucose readings,
 * insulin doses, carbs, and notes for a specified date range.
 *
 * Security:
 * - Input validation with Zod
 * - Rate limit: 1 request/second
 * - Audit logging
 * - Encrypted cache
 */

import { z } from 'zod';
import { diabetesMClient } from '../api/client.js';
import { GetLogbookEntriesInputSchema } from '../types/tools.js';
import type { LogbookEntry } from '../types/api.js';

export const getLogbookEntriesToolDefinition = {
  name: 'get_logbook_entries',
  description: 'Retrieve logbook entries from Diabetes:M including glucose readings, insulin doses, carbs, and notes for a specified date range.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dateRange: {
        type: 'string',
        enum: ['today', '7days', '30days', '90days'],
        description: 'Time range for logbook entries'
      },
      category: {
        type: 'string',
        description: 'Optional category filter (e.g., breakfast, lunch, dinner)'
      }
    },
    required: ['dateRange']
  },
  annotations: {
    title: 'Get Logbook Entries',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface GetLogbookEntriesResult {
  entries: LogbookEntry[];
  count: number;
  dateRange: string;
  period: { from: string; to: string };
}

/**
 * Executes the get_logbook_entries tool
 */
export async function executeGetLogbookEntries(
  args: unknown
): Promise<GetLogbookEntriesResult> {
  // Validate input
  const validatedInput = GetLogbookEntriesInputSchema.parse(args);
  const { dateRange, category } = validatedInput;

  // Make API call
  const response = await diabetesMClient.getLogbookEntries(dateRange, category);

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || 'Failed to retrieve logbook entries'
    );
  }

  // Calculate date range for response
  const now = new Date();
  const to = now.toISOString().split('T')[0] as string;
  let from: string;

  switch (dateRange) {
    case 'today':
      from = to;
      break;
    case '7days':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    case '30days':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    case '90days':
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
      break;
    default:
      from = to;
  }

  return {
    entries: response.data,
    count: response.data.length,
    dateRange,
    period: { from, to }
  };
}
