/**
 * API Response Types for Diabetes:M Analytics
 */

export interface LoginResponse {
  success: boolean;
  token?: string;
  sessionId?: string;
  userId?: number;
  error?: string;
}

export interface LogbookEntry {
  id: string;
  timestamp: string;
  glucose?: number;
  glucoseUnit: 'mg/dL' | 'mmol/L';
  insulinBolus?: number;
  insulinBasal?: number;
  insulinCorrection?: number;
  carbs?: number;
  fat?: number;
  protein?: number;
  calories?: number;
  notes?: string;
  photos?: string[];
  tags?: string[];
  category?: string;
  isSensor?: boolean;
}

/**
 * Simplified logbook entry for LLM consumption
 * Only includes non-null fields with human-readable formatting
 */
export interface SimplifiedLogbookEntry {
  time: string;           // "14:30" format
  glucose?: string;       // "120 mg/dL" or "6.7 mmol/L"
  insulin?: string;       // "8u bolus, 2u correction" compact format
  meal?: string;          // "45g carbs (320 cal)" compact format
  notes?: string;
  category?: string;
}

/**
 * Daily summary for logbook entries
 */
export interface DailySummary {
  date: string;           // "2024-01-15 (Mon)"
  glucoseAvg?: string;    // "125 mg/dL"
  glucoseRange?: string;  // "95-180 mg/dL"
  glucoseReadings: number;
  totalInsulin?: string;  // "32u (24u bolus, 8u basal)"
  totalCarbs?: number;
  totalCalories?: number;
  entries: SimplifiedLogbookEntry[];
}

/**
 * Simplified logbook result optimized for LLM analysis
 */
export interface SimplifiedLogbookResult {
  summary: {
    period: string;       // "Last 7 days (Jan 8-15, 2024)"
    totalEntries: number;
    daysWithData: number;
    avgGlucose?: string;
    avgDailyInsulin?: string;
    avgDailyCarbs?: number;
  };
  dailyData: DailySummary[];
}

export interface GlucoseDistribution {
  hypo: number;      // < 54 mg/dL
  low: number;       // 54-69 mg/dL
  normal: number;    // 70-180 mg/dL
  high: number;      // 181-250 mg/dL
  hyper: number;     // > 250 mg/dL
}

export interface GlucoseStatistics {
  distribution: GlucoseDistribution;
  average: number;
  min: number;
  max: number;
  standardDeviation: number;
  coefficientOfVariation: number;
  estimatedHbA1c: number;
  timeInRange: number;
  readingsCount: number;
  period: string;
}

export interface InsulinTotals {
  bolus: number;
  basal: number;
  correction: number;
  total: number;
}

export interface InsulinAnalysis {
  dailyTotals: InsulinTotals;
  carbTotals: number;
  insulinToCarbRatio: number;
  correctionFactor: number;
  averageDailyDose: number;
  bolusPercentage: number;
  basalPercentage: number;
  period: string;
}

export interface PersonalMetrics {
  weight?: number;
  weightUnit: 'kg' | 'lbs';
  height?: number;
  heightUnit: 'cm' | 'in';
  bmi?: number;
  bmr?: number;
  dailyCalorieNeeds?: number;
  insulinSensitivity?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  pulse?: number;
  hba1c?: number;
  hba1cDate?: string;
  diabetesType?: string;
  diagnosisDate?: string;
}

export interface NutritionInfo {
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface FoodItem {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  nutritionPer100g: NutritionInfo;
  servingSizes?: Array<{
    name: string;
    grams: number;
  }>;
  source: 'user' | 'database' | 'recent' | 'favorite';
  ingredients?: string;
  barcode?: string;
  language?: string;
}

export interface HealthReport {
  id: string;
  generatedAt: string;
  expiresAt: string;
  period: string;
  format: 'summary' | 'detailed' | 'trends';
  downloadToken: string;
  content: {
    glucoseSummary: GlucoseStatistics;
    insulinSummary: InsulinAnalysis;
    warnings: string[];
    recommendations: string[];
    trends: {
      glucoseTrend: 'improving' | 'stable' | 'worsening';
      hba1cTrend: 'improving' | 'stable' | 'worsening';
    };
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}
