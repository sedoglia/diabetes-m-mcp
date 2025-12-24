/**
 * Tool: get_insulin_analysis
 *
 * Analyzes insulin usage including daily totals (bolus/basal/correction),
 * carbohydrate totals, and insulin-to-carb ratio analysis.
 *
 * Security:
 * - Input validation with Zod
 * - Period validation (max 90 days)
 * - Encrypted cache (5 min TTL)
 * - Audit logging
 */

import { z } from 'zod';
import { diabetesMClient } from '../api/client.js';
import { GetInsulinAnalysisInputSchema } from '../types/tools.js';
import type { InsulinAnalysis, InsulinTotals } from '../types/api.js';

export const getInsulinAnalysisToolDefinition = {
  name: 'get_insulin_analysis',
  description: 'Analyze insulin usage including daily totals (bolus/basal/correction), carbohydrate totals, and insulin-to-carb ratio analysis.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['today', '7', '14', '30', '90'],
        description: 'Period in days for insulin analysis'
      }
    },
    required: ['period']
  },
  annotations: {
    title: 'Get Insulin Analysis',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface GetInsulinAnalysisResult {
  dailyTotals: InsulinTotals;
  carbTotals: number;
  averageDailyCarbs: number;
  insulinToCarbRatio: number;
  correctionFactor: number;
  averageDailyDose: number;
  bolusPercentage: number;
  basalPercentage: number;
  period: string;
  analysis: string;
  recommendations: string[];
}

/**
 * Generates analysis and recommendations based on insulin data
 */
function generateAnalysisAndRecommendations(data: InsulinAnalysis): {
  analysis: string;
  recommendations: string[];
} {
  const analysis: string[] = [];
  const recommendations: string[] = [];

  // Bolus/Basal ratio analysis
  if (data.bolusPercentage > 0 && data.basalPercentage > 0) {
    const ratio = `${data.bolusPercentage.toFixed(0)}/${data.basalPercentage.toFixed(0)}`;
    analysis.push(`Bolus/Basal ratio is ${ratio}.`);

    if (data.bolusPercentage > 60) {
      recommendations.push('Consider reviewing basal rates - bolus percentage is higher than typical (50-60%).');
    } else if (data.basalPercentage > 60) {
      recommendations.push('Basal insulin percentage is high. Verify basal rates are not causing lows or reducing meal coverage.');
    } else {
      analysis.push('This is within the typical 50/50 to 60/40 range.');
    }
  }

  // Total daily dose assessment
  if (data.averageDailyDose > 0) {
    analysis.push(`Average total daily dose is ${data.averageDailyDose.toFixed(1)} units.`);
  }

  // Insulin to carb ratio
  if (data.insulinToCarbRatio > 0) {
    analysis.push(`Insulin-to-carb ratio: 1 unit per ${data.insulinToCarbRatio.toFixed(0)}g carbs.`);

    if (data.insulinToCarbRatio < 5) {
      recommendations.push('Insulin-to-carb ratio is aggressive. Monitor for post-meal hypoglycemia.');
    } else if (data.insulinToCarbRatio > 20) {
      recommendations.push('Insulin-to-carb ratio is conservative. Monitor for post-meal hyperglycemia.');
    }
  }

  // Correction factor
  if (data.correctionFactor > 0) {
    analysis.push(`Correction factor: 1 unit lowers glucose by approximately ${data.correctionFactor.toFixed(0)} mg/dL.`);
  }

  // Carb intake
  const days = parseInt(data.period.replace(/\D/g, '')) || 1;
  const avgCarbs = data.carbTotals / days;
  analysis.push(`Average daily carbohydrate intake: ${avgCarbs.toFixed(0)}g.`);

  if (avgCarbs < 100) {
    recommendations.push('Low carbohydrate intake detected. Ensure adequate nutrition and discuss with your dietitian.');
  } else if (avgCarbs > 300) {
    recommendations.push('High carbohydrate intake. Consider reviewing meal plans for glucose management.');
  }

  return {
    analysis: analysis.join(' '),
    recommendations
  };
}

/**
 * Executes the get_insulin_analysis tool
 */
export async function executeGetInsulinAnalysis(
  args: unknown
): Promise<GetInsulinAnalysisResult> {
  // Validate input
  const validatedInput = GetInsulinAnalysisInputSchema.parse(args);
  const { period } = validatedInput;

  // Make API call
  const response = await diabetesMClient.getInsulinAnalysis(period);

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || 'Failed to retrieve insulin analysis'
    );
  }

  const data = response.data;

  // Calculate average daily carbs
  const days = period === 'today' ? 1 : parseInt(period);
  const averageDailyCarbs = data.carbTotals / days;

  // Generate analysis
  const { analysis, recommendations } = generateAnalysisAndRecommendations(data);

  return {
    dailyTotals: data.dailyTotals,
    carbTotals: data.carbTotals,
    averageDailyCarbs,
    insulinToCarbRatio: data.insulinToCarbRatio,
    correctionFactor: data.correctionFactor,
    averageDailyDose: data.averageDailyDose,
    bolusPercentage: data.bolusPercentage,
    basalPercentage: data.basalPercentage,
    period: data.period,
    analysis,
    recommendations
  };
}
