/**
 * MCP Tools Input/Output Types
 */

import { z } from 'zod';

// Date range schemas
export const DateRangeSchema = z.enum(['today', '7days', '30days', '90days']);
export type DateRange = z.infer<typeof DateRangeSchema>;

export const PeriodSchema = z.enum(['today', '7', '14', '30', '90']);
export type Period = z.infer<typeof PeriodSchema>;

export const LanguageSchema = z.enum(['IT', 'EN', 'FR', 'DE', 'ES']);
export type Language = z.infer<typeof LanguageSchema>;

export const FoodFilterSchema = z.enum(['userCreated', 'recent', 'favorites', 'meals', 'dishes']);
export type FoodFilter = z.infer<typeof FoodFilterSchema>;

export const ReportFormatSchema = z.enum(['summary', 'detailed', 'trends']);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

// Tool input schemas
export const GetLogbookEntriesInputSchema = z.object({
  dateRange: DateRangeSchema.optional().describe('Time range for logbook entries (today, 7days, 30days, 90days)'),
  date: z.string().optional().describe('Specific date in YYYY-MM-DD format (e.g., 2025-12-25)'),
  category: z.string().optional().describe('Optional category filter (e.g., breakfast, lunch, dinner)')
}).refine(
  data => data.dateRange || data.date,
  { message: 'Either dateRange or date must be provided' }
);
export type GetLogbookEntriesInput = z.infer<typeof GetLogbookEntriesInputSchema>;

export const GetGlucoseStatisticsInputSchema = z.object({
  period: PeriodSchema.describe('Period in days for statistics calculation')
});
export type GetGlucoseStatisticsInput = z.infer<typeof GetGlucoseStatisticsInputSchema>;

export const GetInsulinAnalysisInputSchema = z.object({
  period: PeriodSchema.describe('Period in days for insulin analysis')
});
export type GetInsulinAnalysisInput = z.infer<typeof GetInsulinAnalysisInputSchema>;

export const GetPersonalMetricsInputSchema = z.object({}).describe('No input required');
export type GetPersonalMetricsInput = z.infer<typeof GetPersonalMetricsInputSchema>;

export const SearchFoodsInputSchema = z.object({
  query: z.string().min(1).max(100).describe('Search query for food items'),
  filter: FoodFilterSchema.optional().describe('Optional filter for food source'),
  language: LanguageSchema.optional().default('EN').describe('Language for results')
});
export type SearchFoodsInput = z.infer<typeof SearchFoodsInputSchema>;

export const GenerateHealthReportInputSchema = z.object({
  period: PeriodSchema.describe('Period for the health report'),
  format: ReportFormatSchema.describe('Report format type')
});
export type GenerateHealthReportInput = z.infer<typeof GenerateHealthReportInputSchema>;

export const GetIOBInputSchema = z.object({
  dia: z.number().min(2).max(8).optional().describe('Duration of Insulin Action in hours (default: 4)'),
  includeBasal: z.boolean().optional().describe('Whether to include basal insulin in IOB calculation (default: false)')
});
export type GetIOBInput = z.infer<typeof GetIOBInputSchema>;

// Tool definitions for MCP
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_logbook_entries',
    description: 'Retrieve logbook entries from Diabetes:M including glucose readings, insulin doses, carbs, and notes. You can specify either a date range (today, 7days, 30days, 90days) OR a specific date (YYYY-MM-DD format).',
    inputSchema: {
      type: 'object',
      properties: {
        dateRange: {
          type: 'string',
          enum: ['today', '7days', '30days', '90days'],
          description: 'Time range for logbook entries (use this OR date, not both)'
        },
        date: {
          type: 'string',
          description: 'Specific date in YYYY-MM-DD format (e.g., 2025-12-25). Use this OR dateRange, not both.'
        },
        category: {
          type: 'string',
          description: 'Optional category filter (e.g., breakfast, lunch, dinner)'
        }
      }
    }
  },
  {
    name: 'get_glucose_statistics',
    description: 'Get glucose statistics including distribution (hypo/low/normal/high/hyper), average, min/max values, and estimated HbA1c for a specified period.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7', '14', '30', '90'],
          description: 'Period in days for statistics calculation'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'get_insulin_analysis',
    description: 'Analyze insulin usage including daily totals (bolus/basal/correction), carbohydrate totals, and insulin-to-carb ratio analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7', '14', '30', '90'],
          description: 'Period in days for insulin analysis'
        }
      },
      required: ['period']
    }
  },
  {
    name: 'get_personal_metrics',
    description: 'Retrieve personal health metrics including weight, BMI, BMR, daily calorie needs, insulin sensitivity, blood pressure, and latest HbA1c.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'search_foods',
    description: 'Search the Diabetes:M food database for nutritional information. Returns foods with nutrition per 100g, serving sizes, and source.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for food items',
          minLength: 1,
          maxLength: 100
        },
        filter: {
          type: 'string',
          enum: ['userCreated', 'recent', 'favorites', 'meals', 'dishes'],
          description: 'Optional filter for food source'
        },
        language: {
          type: 'string',
          enum: ['IT', 'EN', 'FR', 'DE', 'ES'],
          description: 'Language for results',
          default: 'EN'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'generate_health_report',
    description: 'Generate a comprehensive health report suitable for medical professionals. Includes HbA1c analysis, glucose trends, insulin/carb analysis, and warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', '7', '30', '90'],
          description: 'Period for the health report'
        },
        format: {
          type: 'string',
          enum: ['summary', 'detailed', 'trends'],
          description: 'Report format type'
        }
      },
      required: ['period', 'format']
    }
  },
  {
    name: 'get_iob',
    description: 'Calculate the current Insulin on Board (IOB) - the amount of active insulin still working in the body. Uses recent insulin doses from the logbook and calculates decay based on Duration of Insulin Action (DIA).',
    inputSchema: {
      type: 'object',
      properties: {
        dia: {
          type: 'number',
          description: 'Duration of Insulin Action in hours (default: 4). Typical range: 3-5 hours.',
          minimum: 2,
          maximum: 8
        },
        includeBasal: {
          type: 'boolean',
          description: 'Whether to include basal insulin in IOB calculation (default: false)'
        }
      }
    }
  }
];
