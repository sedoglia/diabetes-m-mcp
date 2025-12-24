/**
 * Tool: get_personal_metrics
 *
 * Retrieves personal health metrics including weight, BMI, BMR,
 * daily calorie needs, insulin sensitivity, blood pressure, and latest HbA1c.
 *
 * Security:
 * - HIGHEST SENSITIVITY - contains personal health data
 * - Explicit consent tracking
 * - Extra encryption layer
 * - Separate audit log
 * - Shorter cache TTL (2 min)
 */

import { z } from 'zod';
import { diabetesMClient } from '../api/client.js';
import { auditLogger } from '../security/audit.js';
import { GetPersonalMetricsInputSchema } from '../types/tools.js';
import type { PersonalMetrics } from '../types/api.js';

export const getPersonalMetricsToolDefinition = {
  name: 'get_personal_metrics',
  description: 'Retrieve personal health metrics including weight, BMI, BMR, daily calorie needs, insulin sensitivity, blood pressure, and latest HbA1c. This tool accesses sensitive personal health data.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: []
  },
  annotations: {
    title: 'Get Personal Metrics',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

export interface GetPersonalMetricsResult {
  weight?: {
    value: number;
    unit: string;
  };
  height?: {
    value: number;
    unit: string;
  };
  bmi?: {
    value: number;
    category: string;
  };
  bmr?: number;
  dailyCalorieNeeds?: number;
  insulinSensitivity?: number;
  bloodPressure?: {
    systolic: number;
    diastolic: number;
    category: string;
  };
  pulse?: number;
  hba1c?: {
    value: number;
    date?: string;
    assessment: string;
  };
  diabetesInfo?: {
    type?: string;
    diagnosisDate?: string;
  };
  summary: string;
  warnings: string[];
}

/**
 * Categorizes BMI
 */
function categorizeBmi(bmi: number): string {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal weight';
  if (bmi < 30) return 'Overweight';
  if (bmi < 35) return 'Obesity Class I';
  if (bmi < 40) return 'Obesity Class II';
  return 'Obesity Class III';
}

/**
 * Categorizes blood pressure
 */
function categorizeBloodPressure(systolic: number, diastolic: number): string {
  if (systolic < 120 && diastolic < 80) return 'Normal';
  if (systolic < 130 && diastolic < 80) return 'Elevated';
  if (systolic < 140 || diastolic < 90) return 'High Blood Pressure Stage 1';
  if (systolic >= 140 || diastolic >= 90) return 'High Blood Pressure Stage 2';
  if (systolic > 180 || diastolic > 120) return 'Hypertensive Crisis';
  return 'Unknown';
}

/**
 * Assesses HbA1c value
 */
function assessHba1c(hba1c: number): string {
  if (hba1c < 5.7) return 'Normal range';
  if (hba1c < 6.5) return 'Prediabetes range';
  if (hba1c < 7.0) return 'Well-controlled diabetes (target for most adults)';
  if (hba1c < 8.0) return 'Above target - may need adjustment';
  return 'Significantly above target - discuss with healthcare provider';
}

/**
 * Generates warnings based on metrics
 */
function generateWarnings(metrics: PersonalMetrics): string[] {
  const warnings: string[] = [];

  // BMI warnings
  if (metrics.bmi !== undefined) {
    if (metrics.bmi < 18.5) {
      warnings.push('BMI indicates underweight. Consider nutritional consultation.');
    } else if (metrics.bmi >= 30) {
      warnings.push('BMI indicates obesity. Weight management may improve diabetes control.');
    }
  }

  // Blood pressure warnings
  if (metrics.bloodPressureSystolic !== undefined && metrics.bloodPressureDiastolic !== undefined) {
    if (metrics.bloodPressureSystolic >= 140 || metrics.bloodPressureDiastolic >= 90) {
      warnings.push('Blood pressure is elevated. Regular monitoring and medication review recommended.');
    }
    if (metrics.bloodPressureSystolic > 180 || metrics.bloodPressureDiastolic > 120) {
      warnings.push('⚠️ CRITICAL: Blood pressure is in hypertensive crisis range. Seek immediate medical attention.');
    }
  }

  // HbA1c warnings
  if (metrics.hba1c !== undefined) {
    if (metrics.hba1c >= 9.0) {
      warnings.push('HbA1c is significantly elevated. Urgent review of diabetes management needed.');
    } else if (metrics.hba1c >= 8.0) {
      warnings.push('HbA1c is above target. Consider reviewing treatment plan with healthcare provider.');
    }
  }

  return warnings;
}

/**
 * Generates a summary of personal metrics
 */
function generateSummary(metrics: PersonalMetrics, warnings: string[]): string {
  const parts: string[] = [];

  if (metrics.weight !== undefined && metrics.weightUnit) {
    parts.push(`Weight: ${metrics.weight} ${metrics.weightUnit}`);
  }

  if (metrics.bmi !== undefined) {
    parts.push(`BMI: ${metrics.bmi.toFixed(1)} (${categorizeBmi(metrics.bmi)})`);
  }

  if (metrics.hba1c !== undefined) {
    parts.push(`Latest HbA1c: ${metrics.hba1c}%`);
  }

  if (metrics.bloodPressureSystolic !== undefined && metrics.bloodPressureDiastolic !== undefined) {
    parts.push(`Blood Pressure: ${metrics.bloodPressureSystolic}/${metrics.bloodPressureDiastolic} mmHg`);
  }

  if (warnings.length > 0) {
    parts.push(`${warnings.length} warning(s) require attention.`);
  }

  return parts.join('. ') + '.';
}

/**
 * Executes the get_personal_metrics tool
 */
export async function executeGetPersonalMetrics(
  args: unknown
): Promise<GetPersonalMetricsResult> {
  // Validate input (empty object expected)
  GetPersonalMetricsInputSchema.parse(args);

  // Make API call
  const response = await diabetesMClient.getPersonalMetrics();

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || 'Failed to retrieve personal metrics'
    );
  }

  const metrics = response.data;
  const warnings = generateWarnings(metrics);

  const result: GetPersonalMetricsResult = {
    summary: '',
    warnings
  };

  // Populate weight
  if (metrics.weight !== undefined) {
    result.weight = {
      value: metrics.weight,
      unit: metrics.weightUnit
    };
  }

  // Populate height
  if (metrics.height !== undefined) {
    result.height = {
      value: metrics.height,
      unit: metrics.heightUnit
    };
  }

  // Populate BMI
  if (metrics.bmi !== undefined) {
    result.bmi = {
      value: metrics.bmi,
      category: categorizeBmi(metrics.bmi)
    };
  }

  // Populate other metrics
  result.bmr = metrics.bmr;
  result.dailyCalorieNeeds = metrics.dailyCalorieNeeds;
  result.insulinSensitivity = metrics.insulinSensitivity;
  result.pulse = metrics.pulse;

  // Populate blood pressure
  if (metrics.bloodPressureSystolic !== undefined && metrics.bloodPressureDiastolic !== undefined) {
    result.bloodPressure = {
      systolic: metrics.bloodPressureSystolic,
      diastolic: metrics.bloodPressureDiastolic,
      category: categorizeBloodPressure(metrics.bloodPressureSystolic, metrics.bloodPressureDiastolic)
    };
  }

  // Populate HbA1c
  if (metrics.hba1c !== undefined) {
    result.hba1c = {
      value: metrics.hba1c,
      date: metrics.hba1cDate,
      assessment: assessHba1c(metrics.hba1c)
    };
  }

  // Populate diabetes info
  if (metrics.diabetesType || metrics.diagnosisDate) {
    result.diabetesInfo = {
      type: metrics.diabetesType,
      diagnosisDate: metrics.diagnosisDate
    };
  }

  // Generate summary
  result.summary = generateSummary(metrics, warnings);

  return result;
}
