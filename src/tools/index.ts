/**
 * MCP Tools Index
 *
 * Exports all tool definitions and executors for the Diabetes:M MCP server.
 * Total: 10 tools (7 data tools + 3 credential management tools)
 */

import {
  getLogbookEntriesToolDefinition,
  executeGetLogbookEntries
} from './get-logbook-entries.js';

import {
  getGlucoseStatisticsToolDefinition,
  executeGetGlucoseStatistics
} from './get-glucose-statistics.js';

import {
  getInsulinAnalysisToolDefinition,
  executeGetInsulinAnalysis
} from './get-insulin-analysis.js';

import {
  getPersonalMetricsToolDefinition,
  executeGetPersonalMetrics
} from './get-personal-metrics.js';

import {
  searchFoodsToolDefinition,
  executeSearchFoods
} from './search-foods.js';

import {
  generateHealthReportToolDefinition,
  executeGenerateHealthReport
} from './generate-health-report.js';

import {
  setupCredentialsToolDefinition,
  executeSetupCredentials,
  checkCredentialsToolDefinition,
  executeCheckCredentials,
  clearCredentialsToolDefinition,
  executeClearCredentials
} from './setup-credentials.js';

import {
  getIOBToolDefinition,
  executeGetIOB
} from './get-iob.js';

// Re-export tool definitions and executors
export {
  // Data tools
  getLogbookEntriesToolDefinition,
  executeGetLogbookEntries,
  getGlucoseStatisticsToolDefinition,
  executeGetGlucoseStatistics,
  getInsulinAnalysisToolDefinition,
  executeGetInsulinAnalysis,
  getPersonalMetricsToolDefinition,
  executeGetPersonalMetrics,
  searchFoodsToolDefinition,
  executeSearchFoods,
  generateHealthReportToolDefinition,
  executeGenerateHealthReport,
  getIOBToolDefinition,
  executeGetIOB,
  // Credential management tools
  setupCredentialsToolDefinition,
  executeSetupCredentials,
  checkCredentialsToolDefinition,
  executeCheckCredentials,
  clearCredentialsToolDefinition,
  executeClearCredentials
};

// Result types
export type { GetLogbookEntriesResult } from './get-logbook-entries.js';
export type { GetGlucoseStatisticsResult } from './get-glucose-statistics.js';
export type { GetInsulinAnalysisResult } from './get-insulin-analysis.js';
export type { GetPersonalMetricsResult } from './get-personal-metrics.js';
export type { SearchFoodsResult, FoodItemResult } from './search-foods.js';
export type { GenerateHealthReportResult } from './generate-health-report.js';
export type { IOBResult } from './get-iob.js';
export type { SetupCredentialsResult, CheckCredentialsResult, ClearCredentialsResult } from './setup-credentials.js';

/**
 * All tool definitions for MCP server registration
 */
export const ALL_TOOL_DEFINITIONS = [
  // Credential management (first for discoverability)
  setupCredentialsToolDefinition,
  checkCredentialsToolDefinition,
  clearCredentialsToolDefinition,
  // Data tools
  getLogbookEntriesToolDefinition,
  getGlucoseStatisticsToolDefinition,
  getInsulinAnalysisToolDefinition,
  getIOBToolDefinition,
  getPersonalMetricsToolDefinition,
  searchFoodsToolDefinition,
  generateHealthReportToolDefinition
];

/**
 * Tool executor map
 */
export const TOOL_EXECUTORS = {
  // Credential management
  'setup_credentials': executeSetupCredentials,
  'check_credentials': executeCheckCredentials,
  'clear_credentials': executeClearCredentials,
  // Data tools
  'get_logbook_entries': executeGetLogbookEntries,
  'get_glucose_statistics': executeGetGlucoseStatistics,
  'get_insulin_analysis': executeGetInsulinAnalysis,
  'get_iob': executeGetIOB,
  'get_personal_metrics': executeGetPersonalMetrics,
  'search_foods': executeSearchFoods,
  'generate_health_report': executeGenerateHealthReport
} as const;

export type ToolName = keyof typeof TOOL_EXECUTORS;
