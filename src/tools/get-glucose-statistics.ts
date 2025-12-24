/**
 * Tool: get_glucose_statistics
 *
 * Gets glucose statistics including distribution (hypo/low/normal/high/hyper),
 * average, min/max values, and estimated HbA1c for a specified period.
 *
 * Security:
 * - Input validation with Zod
 * - Period validation (max 90 days)
 * - Encrypted cache (5 min TTL)
 * - Audit logging
 */

import { z } from 'zod';
import { diabetesMClient } from '../api/client.js';
import { GetGlucoseStatisticsInputSchema } from '../types/tools.js';
import type { GlucoseStatistics, GlucoseDistribution } from '../types/api.js';

export const getGlucoseStatisticsToolDefinition = {
  name: 'get_glucose_statistics',
  description: 'Get glucose statistics including distribution (hypo/low/normal/high/hyper), average, min/max values, and estimated HbA1c for a specified period.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      period: {
        type: 'string',
        enum: ['today', '7', '14', '30', '90'],
        description: 'Period in days for statistics calculation'
      }
    },
    required: ['period']
  },
  annotations: {
    title: 'Get Glucose Statistics',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface GetGlucoseStatisticsResult {
  distribution: GlucoseDistribution;
  distributionPercentages: {
    hypo: string;
    low: string;
    normal: string;
    high: string;
    hyper: string;
  };
  average: number;
  min: number;
  max: number;
  standardDeviation: number;
  coefficientOfVariation: number;
  estimatedHbA1c: number;
  timeInRange: number;
  readingsCount: number;
  period: string;
  analysis: string;
}

/**
 * Generates a human-readable analysis of glucose statistics
 */
function generateAnalysis(stats: GlucoseStatistics): string {
  const parts: string[] = [];

  // HbA1c assessment
  if (stats.estimatedHbA1c < 5.7) {
    parts.push(`Estimated HbA1c of ${stats.estimatedHbA1c.toFixed(1)}% is in the normal range.`);
  } else if (stats.estimatedHbA1c < 6.5) {
    parts.push(`Estimated HbA1c of ${stats.estimatedHbA1c.toFixed(1)}% indicates prediabetes range.`);
  } else if (stats.estimatedHbA1c < 7.0) {
    parts.push(`Estimated HbA1c of ${stats.estimatedHbA1c.toFixed(1)}% is at target for most diabetics.`);
  } else {
    parts.push(`Estimated HbA1c of ${stats.estimatedHbA1c.toFixed(1)}% is above target. Consider discussing with your healthcare provider.`);
  }

  // Time in Range assessment
  if (stats.timeInRange >= 70) {
    parts.push(`Time in range of ${stats.timeInRange.toFixed(0)}% meets the recommended target of >70%.`);
  } else if (stats.timeInRange >= 50) {
    parts.push(`Time in range of ${stats.timeInRange.toFixed(0)}% is below the recommended 70%. Focus on reducing variability.`);
  } else {
    parts.push(`Time in range of ${stats.timeInRange.toFixed(0)}% needs improvement. Consider reviewing insulin dosing and meal timing.`);
  }

  // Variability assessment
  if (stats.coefficientOfVariation <= 36) {
    parts.push(`Glucose variability (CV: ${stats.coefficientOfVariation.toFixed(0)}%) is stable.`);
  } else {
    parts.push(`Glucose variability (CV: ${stats.coefficientOfVariation.toFixed(0)}%) is high. Consider more consistent meal timing and carb counting.`);
  }

  // Hypoglycemia warning
  const hypoPercentage = stats.distribution.hypo + stats.distribution.low;
  if (hypoPercentage > 4) {
    parts.push(`⚠️ Low glucose readings (${hypoPercentage.toFixed(1)}%) exceed the recommended <4%. Risk of hypoglycemia.`);
  }

  return parts.join(' ');
}

/**
 * Executes the get_glucose_statistics tool
 */
export async function executeGetGlucoseStatistics(
  args: unknown
): Promise<GetGlucoseStatisticsResult> {
  // Validate input
  const validatedInput = GetGlucoseStatisticsInputSchema.parse(args);
  const { period } = validatedInput;

  // Make API call
  const response = await diabetesMClient.getGlucoseStatistics(period);

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || 'Failed to retrieve glucose statistics'
    );
  }

  const stats = response.data;
  const total = stats.distribution.hypo + stats.distribution.low +
    stats.distribution.normal + stats.distribution.high + stats.distribution.hyper;

  // Calculate percentages
  const toPercentage = (value: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%';

  return {
    distribution: stats.distribution,
    distributionPercentages: {
      hypo: toPercentage(stats.distribution.hypo),
      low: toPercentage(stats.distribution.low),
      normal: toPercentage(stats.distribution.normal),
      high: toPercentage(stats.distribution.high),
      hyper: toPercentage(stats.distribution.hyper)
    },
    average: stats.average,
    min: stats.min,
    max: stats.max,
    standardDeviation: stats.standardDeviation,
    coefficientOfVariation: stats.coefficientOfVariation,
    estimatedHbA1c: stats.estimatedHbA1c,
    timeInRange: stats.timeInRange,
    readingsCount: stats.readingsCount,
    period: stats.period,
    analysis: generateAnalysis(stats)
  };
}
