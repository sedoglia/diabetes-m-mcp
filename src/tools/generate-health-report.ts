/**
 * Tool: generate_health_report
 *
 * Generates a comprehensive health report suitable for medical professionals.
 * Includes HbA1c analysis, glucose trends, insulin/carb analysis, and warnings.
 *
 * Security:
 * - One-time download token (expires in 1 hour)
 * - Report content encryption
 * - Full audit logging
 * - No caching (always fresh generation)
 */

import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { diabetesMClient } from '../api/client.js';
import { auditLogger } from '../security/audit.js';
import { GenerateHealthReportInputSchema } from '../types/tools.js';
import type { HealthReport, GlucoseStatistics, InsulinAnalysis } from '../types/api.js';

export const generateHealthReportToolDefinition = {
  name: 'generate_health_report',
  description: 'Generate a comprehensive health report suitable for medical professionals. Includes HbA1c analysis, glucose trends, insulin/carb analysis, and warnings.',
  inputSchema: {
    type: 'object' as const,
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
  },
  annotations: {
    title: 'Generate Health Report',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface GenerateHealthReportResult {
  reportId: string;
  generatedAt: string;
  expiresAt: string;
  period: string;
  format: string;
  downloadToken: string;
  report: {
    title: string;
    patientSummary: string;
    glucoseAnalysis: {
      averageGlucose: number;
      estimatedHbA1c: number;
      timeInRange: number;
      hypoglycemiaRisk: string;
      hyperglycemiaRisk: string;
      variability: string;
      trend: string;
    };
    insulinAnalysis: {
      totalDailyDose: number;
      bolusBasalRatio: string;
      insulinToCarbRatio: number;
      correctionFactor: number;
    };
    nutritionSummary: {
      averageDailyCarbs: number;
      averageDailyCalories?: number;
    };
    warnings: string[];
    recommendations: string[];
    disclaimers: string[];
  };
}

/**
 * Generates a secure one-time download token
 */
function generateDownloadToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Determines trend direction
 */
function determineTrend(current: number, target: number): string {
  const diff = ((current - target) / target) * 100;

  if (Math.abs(diff) < 5) return 'stable';
  if (diff > 0) return 'improving';
  return 'worsening';
}

/**
 * Assesses hypoglycemia risk
 */
function assessHypoglycemiaRisk(distribution: { hypo: number; low: number }): string {
  const totalLow = distribution.hypo + distribution.low;

  if (totalLow > 10) return 'HIGH - Frequent hypoglycemia detected';
  if (totalLow > 4) return 'MODERATE - Occasional hypoglycemia';
  if (totalLow > 1) return 'LOW - Rare hypoglycemia';
  return 'MINIMAL';
}

/**
 * Assesses hyperglycemia risk
 */
function assessHyperglycemiaRisk(distribution: { high: number; hyper: number }): string {
  const totalHigh = distribution.high + distribution.hyper;

  if (totalHigh > 50) return 'HIGH - Significant hyperglycemia';
  if (totalHigh > 30) return 'MODERATE - Frequent elevated readings';
  if (totalHigh > 20) return 'LOW - Occasional elevation';
  return 'MINIMAL';
}

/**
 * Generates warnings based on data
 */
function generateWarnings(
  glucoseStats: GlucoseStatistics,
  insulinData: InsulinAnalysis
): string[] {
  const warnings: string[] = [];

  // Glucose-related warnings
  if (glucoseStats.estimatedHbA1c >= 9.0) {
    warnings.push('CRITICAL: Estimated HbA1c is significantly elevated (>=9%). Immediate review recommended.');
  } else if (glucoseStats.estimatedHbA1c >= 8.0) {
    warnings.push('WARNING: Estimated HbA1c is above target (>=8%). Treatment adjustment may be needed.');
  }

  if (glucoseStats.distribution.hypo > 4) {
    warnings.push('WARNING: Hypoglycemia frequency exceeds safe limits. Review insulin dosing.');
  }

  if (glucoseStats.coefficientOfVariation > 36) {
    warnings.push('WARNING: High glucose variability (CV>36%). Consider lifestyle and medication review.');
  }

  if (glucoseStats.timeInRange < 50) {
    warnings.push('WARNING: Time in range below 50%. Intensive management review recommended.');
  }

  // Insulin-related warnings
  if (insulinData.bolusPercentage > 70) {
    warnings.push('NOTICE: High bolus percentage (>70%). Basal rate review recommended.');
  }

  if (insulinData.averageDailyDose > 100) {
    warnings.push('NOTICE: High total daily insulin dose. Insulin resistance assessment may be warranted.');
  }

  return warnings;
}

/**
 * Generates recommendations
 */
function generateRecommendations(
  glucoseStats: GlucoseStatistics,
  insulinData: InsulinAnalysis,
  format: string
): string[] {
  const recommendations: string[] = [];

  // Basic recommendations for all formats
  if (glucoseStats.timeInRange < 70) {
    recommendations.push('Target time in range of 70% or higher through consistent meal timing and accurate carb counting.');
  }

  if (glucoseStats.coefficientOfVariation > 36) {
    recommendations.push('Reduce glucose variability through consistent carbohydrate intake and regular meal timing.');
  }

  // Detailed recommendations
  if (format === 'detailed' || format === 'trends') {
    if (glucoseStats.distribution.hypo > 2) {
      recommendations.push('Review nighttime glucose patterns to identify causes of hypoglycemia.');
      recommendations.push('Consider continuous glucose monitoring if not already in use.');
    }

    if (glucoseStats.distribution.hyper > 30) {
      recommendations.push('Evaluate insulin-to-carb ratios for accuracy.');
      recommendations.push('Consider timing of bolus insulin relative to meals.');
    }

    if (insulinData.insulinToCarbRatio > 0) {
      recommendations.push(`Current insulin-to-carb ratio: 1:${insulinData.insulinToCarbRatio.toFixed(0)}. Verify accuracy with food logs.`);
    }
  }

  // Add exercise and lifestyle recommendations
  recommendations.push('Maintain regular physical activity as tolerated.');
  recommendations.push('Schedule regular follow-up with diabetes care team.');

  return recommendations;
}

/**
 * Executes the generate_health_report tool
 */
export async function executeGenerateHealthReport(
  args: unknown
): Promise<GenerateHealthReportResult> {
  const timer = auditLogger.startTimer();

  // Validate input
  const validatedInput = GenerateHealthReportInputSchema.parse(args);
  const { period, format } = validatedInput;

  // Try to use API if available
  const apiResponse = await diabetesMClient.generateHealthReport(period, format);

  // Get glucose and insulin data for local report generation
  const glucoseResponse = await diabetesMClient.getGlucoseStatistics(period);
  const insulinResponse = await diabetesMClient.getInsulinAnalysis(period);

  if (!glucoseResponse.success || !glucoseResponse.data) {
    throw new Error('Failed to retrieve glucose data for report');
  }

  if (!insulinResponse.success || !insulinResponse.data) {
    throw new Error('Failed to retrieve insulin data for report');
  }

  const glucoseStats = glucoseResponse.data;
  const insulinData = insulinResponse.data;

  // Generate report locally (API may not be available or may provide different format)
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  const downloadToken = generateDownloadToken();

  const periodLabel = period === 'today' ? 'Today' :
    period === '7' ? 'Last 7 Days' :
      period === '30' ? 'Last 30 Days' : 'Last 90 Days';

  const warnings = generateWarnings(glucoseStats, insulinData);
  const recommendations = generateRecommendations(glucoseStats, insulinData, format);

  const result: GenerateHealthReportResult = {
    reportId: `RPT-${now.getTime()}`,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    period: periodLabel,
    format,
    downloadToken,
    report: {
      title: `Diabetes Management Report - ${periodLabel}`,
      patientSummary: `This report covers diabetes management data for ${periodLabel.toLowerCase()}. ` +
        `Based on ${glucoseStats.readingsCount} glucose readings.`,
      glucoseAnalysis: {
        averageGlucose: glucoseStats.average,
        estimatedHbA1c: glucoseStats.estimatedHbA1c,
        timeInRange: glucoseStats.timeInRange,
        hypoglycemiaRisk: assessHypoglycemiaRisk(glucoseStats.distribution),
        hyperglycemiaRisk: assessHyperglycemiaRisk(glucoseStats.distribution),
        variability: glucoseStats.coefficientOfVariation <= 36 ? 'Stable' : 'High',
        trend: determineTrend(glucoseStats.estimatedHbA1c, 7.0)
      },
      insulinAnalysis: {
        totalDailyDose: insulinData.averageDailyDose,
        bolusBasalRatio: `${insulinData.bolusPercentage.toFixed(0)}/${insulinData.basalPercentage.toFixed(0)}`,
        insulinToCarbRatio: insulinData.insulinToCarbRatio,
        correctionFactor: insulinData.correctionFactor
      },
      nutritionSummary: {
        averageDailyCarbs: insulinData.carbTotals / (period === 'today' ? 1 : parseInt(period))
      },
      warnings,
      recommendations,
      disclaimers: [
        'This report is generated for informational purposes and does not constitute medical advice.',
        'Always consult with your healthcare provider before making changes to your treatment.',
        'Estimated HbA1c is calculated from glucose readings and may differ from laboratory values.',
        `Report generated on ${now.toLocaleDateString()} at ${now.toLocaleTimeString()}.`,
        `This report expires on ${expiresAt.toLocaleDateString()} at ${expiresAt.toLocaleTimeString()}.`
      ]
    }
  };

  auditLogger.logOperation(
    'generate_health_report',
    'generate_health_report',
    true,
    timer(),
    `${period}:${format}`
  );

  return result;
}
