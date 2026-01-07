/**
 * Tool: get_iob (Insulin on Board)
 *
 * Calculates the active insulin remaining in the body based on recent
 * insulin doses and their decay over time.
 *
 * Uses an exponential decay model similar to OpenAPS/Loop algorithms.
 * The calculation considers:
 * - All insulin doses (bolus, correction, basal) from the logbook
 * - Time elapsed since each dose
 * - Duration of Insulin Action (DIA) - configurable, default 4 hours
 *
 * Security:
 * - Input validation with Zod
 * - Rate limit: 1 request/second
 * - Audit logging
 */

import { diabetesMClient } from '../api/client.js';
import { GetIOBInputSchema } from '../types/tools.js';
import type { LogbookEntry } from '../types/api.js';

/**
 * IOB calculation result
 */
export interface IOBResult {
  /** Current IOB value in units */
  iob: number;
  /** Formatted IOB string (e.g., "9.36u") */
  iobFormatted: string;
  /** Duration of Insulin Action used for calculation (hours) */
  dia: number;
  /** Timestamp of calculation */
  calculatedAt: string;
  /** Breakdown of IOB by dose type */
  breakdown: {
    fromBolus: number;
    fromCorrection: number;
    fromBasal: number;
  };
  /** Recent doses that contributed to IOB */
  activeDoses: Array<{
    time: string;
    type: 'bolus' | 'correction' | 'basal';
    dose: number;
    remaining: number;
    percentRemaining: number;
  }>;
  /** Summary message */
  summary: string;
}

export const getIOBToolDefinition = {
  name: 'get_iob',
  description: 'Calculate the current Insulin on Board (IOB) - the amount of active insulin still working in the body. Uses recent insulin doses from the logbook and calculates decay based on Duration of Insulin Action (DIA). Useful for dosing decisions and understanding current insulin activity.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      dia: {
        type: 'number',
        description: 'Duration of Insulin Action in hours (how long insulin remains active). Default is 4 hours. Typical range: 3-5 hours depending on insulin type.',
        minimum: 2,
        maximum: 8,
        default: 4
      },
      includeBasal: {
        type: 'boolean',
        description: 'Whether to include basal insulin in IOB calculation. Default is false (only bolus/correction insulin).',
        default: false
      }
    }
  },
  annotations: {
    title: 'Get Insulin on Board (IOB)',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

/**
 * Calculates the insulin activity curve using the Walsh model.
 * This model is widely used in insulin pump software and closely matches
 * the pharmacokinetic profile of rapid-acting insulin analogs.
 *
 * Reference: Walsh et al. "Guidelines for Optimal Bolus Calculator Settings in Adults"
 *
 * @param minutesAgo - Minutes since insulin was administered
 * @param dia - Duration of Insulin Action in hours
 * @returns Fraction of insulin still active (0-1)
 */
function calculateInsulinActivity(minutesAgo: number, dia: number): number {
  const diaMinutes = dia * 60;

  // No insulin remains after DIA
  if (minutesAgo >= diaMinutes) {
    return 0;
  }

  // Insulin hasn't started working yet
  if (minutesAgo < 0) {
    return 1;
  }

  // Walsh model - polynomial approximation of insulin activity
  // This provides a smoother, more realistic curve than simple exponential
  const t = minutesAgo / diaMinutes; // Normalized time (0-1)

  // Walsh curve: IOB = 1 - (t^2 * (3 - 2*t)) adjusted for better fit
  // This creates a sigmoid-like decay that matches clinical data
  if (t <= 0.5) {
    // First half: slow initial decay
    return 1 - (2 * t * t);
  } else {
    // Second half: faster decay
    const t2 = 1 - t;
    return 2 * t2 * t2;
  }
}

/**
 * Alternative: Bilinear model (simpler, used by some pumps)
 * More conservative estimate
 */
function calculateInsulinActivityBilinear(minutesAgo: number, dia: number): number {
  const diaMinutes = dia * 60;

  if (minutesAgo >= diaMinutes || minutesAgo < 0) {
    return minutesAgo < 0 ? 1 : 0;
  }

  // Simple linear decay
  return 1 - (minutesAgo / diaMinutes);
}

/**
 * Formats time as "HH:MM"
 */
function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Executes the get_iob tool
 */
export async function executeGetIOB(args: unknown): Promise<IOBResult> {
  // Validate input
  const validatedInput = GetIOBInputSchema.parse(args);
  const dia = validatedInput.dia ?? 4;
  const includeBasal = validatedInput.includeBasal ?? false;

  const diaMs = dia * 60 * 60 * 1000; // DIA in milliseconds
  const now = Date.now();

  // Get logbook entries for the last DIA + 1 hour (to be safe)
  const lookbackMs = diaMs + (60 * 60 * 1000);
  const fromDate = new Date(now - lookbackMs);
  const toDate = new Date(now);

  // Format dates for API call
  const fromDateStr = fromDate.toISOString().split('T')[0];
  const toDateStr = toDate.toISOString().split('T')[0];

  // Use a Map to deduplicate entries by ID
  const entriesMap = new Map<string, LogbookEntry>();

  // Fetch entries for the from date
  const response = await diabetesMClient.getLogbookEntries(undefined, undefined, fromDateStr);
  if (response.success && response.data) {
    for (const entry of response.data) {
      entriesMap.set(entry.id, entry);
    }
  }

  // If we need data from today too (when fromDate is yesterday)
  if (fromDateStr !== toDateStr) {
    const todayResponse = await diabetesMClient.getLogbookEntries(undefined, undefined, toDateStr);
    if (todayResponse.success && todayResponse.data) {
      for (const entry of todayResponse.data) {
        entriesMap.set(entry.id, entry);
      }
    }
  }

  // Convert map to array
  const entries = Array.from(entriesMap.values());

  // Calculate IOB from each dose
  let totalIOB = 0;
  let bolusIOB = 0;
  let correctionIOB = 0;
  let basalIOB = 0;

  const activeDoses: IOBResult['activeDoses'] = [];

  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();
    const minutesAgo = (now - entryTime) / (1000 * 60);

    // Skip if too old (beyond DIA)
    if (minutesAgo > dia * 60) {
      continue;
    }

    // Skip future entries
    if (minutesAgo < 0) {
      continue;
    }

    // Calculate remaining insulin for each type
    // Use exponential model for bolus (more accurate) and bilinear for others
    const activityExp = calculateInsulinActivity(minutesAgo, dia);
    const activityLinear = calculateInsulinActivityBilinear(minutesAgo, dia);

    // Process bolus insulin (use exponential model for better accuracy)
    if (entry.insulinBolus && entry.insulinBolus > 0) {
      const remaining = entry.insulinBolus * activityExp;
      bolusIOB += remaining;
      totalIOB += remaining;

      if (remaining > 0.01) {
        activeDoses.push({
          time: formatTime(new Date(entry.timestamp)),
          type: 'bolus',
          dose: entry.insulinBolus,
          remaining: Math.round(remaining * 100) / 100,
          percentRemaining: Math.round(activityExp * 100)
        });
      }
    }

    // Process correction insulin (use exponential model)
    if (entry.insulinCorrection && entry.insulinCorrection > 0) {
      const remaining = entry.insulinCorrection * activityExp;
      correctionIOB += remaining;
      totalIOB += remaining;

      if (remaining > 0.01) {
        activeDoses.push({
          time: formatTime(new Date(entry.timestamp)),
          type: 'correction',
          dose: entry.insulinCorrection,
          remaining: Math.round(remaining * 100) / 100,
          percentRemaining: Math.round(activityExp * 100)
        });
      }
    }

    // Process basal insulin (only if requested, use linear model for long-acting)
    if (includeBasal && entry.insulinBasal && entry.insulinBasal > 0) {
      const remaining = entry.insulinBasal * activityLinear;
      basalIOB += remaining;
      totalIOB += remaining;

      if (remaining > 0.01) {
        activeDoses.push({
          time: formatTime(new Date(entry.timestamp)),
          type: 'basal',
          dose: entry.insulinBasal,
          remaining: Math.round(remaining * 100) / 100,
          percentRemaining: Math.round(activityLinear * 100)
        });
      }
    }
  }

  // Sort active doses by time (most recent first)
  activeDoses.sort((a, b) => {
    // Parse times and compare
    const [aH, aM] = a.time.split(':').map(Number);
    const [bH, bM] = b.time.split(':').map(Number);
    return (bH! * 60 + bM!) - (aH! * 60 + aM!);
  });

  // Round values
  totalIOB = Math.round(totalIOB * 100) / 100;
  bolusIOB = Math.round(bolusIOB * 100) / 100;
  correctionIOB = Math.round(correctionIOB * 100) / 100;
  basalIOB = Math.round(basalIOB * 100) / 100;

  // Generate summary
  let summary = `Current IOB: ${totalIOB}u`;
  if (activeDoses.length > 0) {
    summary += ` from ${activeDoses.length} active dose(s)`;
  } else {
    summary += ' (no recent insulin doses)';
  }
  summary += `. DIA: ${dia}h.`;

  if (!includeBasal && basalIOB === 0) {
    summary += ' Basal insulin not included.';
  }

  return {
    iob: totalIOB,
    iobFormatted: `${totalIOB}u`,
    dia,
    calculatedAt: new Date().toISOString(),
    breakdown: {
      fromBolus: bolusIOB,
      fromCorrection: correctionIOB,
      fromBasal: basalIOB
    },
    activeDoses,
    summary
  };
}
