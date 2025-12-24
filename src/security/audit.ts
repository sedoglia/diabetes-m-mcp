/**
 * Audit Logging Module
 *
 * Provides secure audit logging for:
 * - All tool operations (general audit log)
 * - Personal metrics access (separate high-sensitivity log)
 *
 * Logs contain:
 * - Timestamp
 * - Operation name
 * - Success/failure status
 * - Duration
 * - Input hash (for traceability without storing sensitive data)
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_LOG_FILE_NAME,
  PERSONAL_AUDIT_LOG_FILE_NAME,
  DEFAULT_SECURITY_CONFIG,
  type AuditLogEntry,
  type PersonalMetricsAuditEntry
} from '../types/security.js';
import { encryptionService } from './encryption.js';

const CONFIG_DIR = join(homedir(), '.diabetesm');
const AUDIT_LOG_PATH = join(CONFIG_DIR, AUDIT_LOG_FILE_NAME);
const PERSONAL_AUDIT_LOG_PATH = join(CONFIG_DIR, PERSONAL_AUDIT_LOG_FILE_NAME);

/**
 * Ensures config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Audit Logger
 */
class AuditLogger {
  /**
   * Logs a general operation
   */
  logOperation(
    operation: string,
    toolName: string | undefined,
    success: boolean,
    durationMs: number,
    inputData?: string,
    errorCode?: string
  ): void {
    ensureConfigDir();

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      toolName,
      success,
      duration: durationMs,
      inputHash: inputData ? encryptionService.hashForAudit(inputData) : undefined,
      errorCode
    };

    const logLine = JSON.stringify(entry) + '\n';
    appendFileSync(AUDIT_LOG_PATH, logLine, { mode: 0o600 });
  }

  /**
   * Logs personal metrics access (high sensitivity)
   */
  logPersonalMetricsAccess(
    operation: string,
    success: boolean,
    durationMs: number,
    consentGiven: boolean,
    purpose: string,
    errorCode?: string
  ): void {
    ensureConfigDir();

    const entry: PersonalMetricsAuditEntry = {
      timestamp: new Date().toISOString(),
      operation,
      toolName: 'get_personal_metrics',
      success,
      duration: durationMs,
      consentGiven,
      purpose,
      errorCode
    };

    const logLine = JSON.stringify(entry) + '\n';
    appendFileSync(PERSONAL_AUDIT_LOG_PATH, logLine, { mode: 0o600 });
  }

  /**
   * Creates an operation timer for measuring duration
   */
  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  /**
   * Retrieves recent audit log entries
   */
  getRecentEntries(count: number = 100): AuditLogEntry[] {
    if (!existsSync(AUDIT_LOG_PATH)) {
      return [];
    }

    try {
      const content = readFileSync(AUDIT_LOG_PATH, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = lines
        .slice(-count)
        .map(line => JSON.parse(line) as AuditLogEntry);

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Retrieves recent personal metrics audit entries
   */
  getRecentPersonalMetricsEntries(count: number = 50): PersonalMetricsAuditEntry[] {
    if (!existsSync(PERSONAL_AUDIT_LOG_PATH)) {
      return [];
    }

    try {
      const content = readFileSync(PERSONAL_AUDIT_LOG_PATH, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries = lines
        .slice(-count)
        .map(line => JSON.parse(line) as PersonalMetricsAuditEntry);

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Cleans up old audit entries based on retention policy
   */
  cleanupOldEntries(): void {
    const retentionMs = DEFAULT_SECURITY_CONFIG.auditRetentionDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - retentionMs);

    this.cleanupLogFile(AUDIT_LOG_PATH, cutoffDate);
    this.cleanupLogFile(PERSONAL_AUDIT_LOG_PATH, cutoffDate);
  }

  /**
   * Helper to clean up a specific log file
   */
  private cleanupLogFile(path: string, cutoffDate: Date): void {
    if (!existsSync(path)) {
      return;
    }

    try {
      const content = readFileSync(path, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);

      const validLines = lines.filter(line => {
        try {
          const entry = JSON.parse(line) as AuditLogEntry;
          return new Date(entry.timestamp) > cutoffDate;
        } catch {
          return false;
        }
      });

      if (validLines.length < lines.length) {
        writeFileSync(path, validLines.join('\n') + '\n', { mode: 0o600 });
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Gets audit log statistics
   */
  getStatistics(): {
    totalOperations: number;
    successRate: number;
    averageDuration: number;
    lastOperation?: string;
  } {
    const entries = this.getRecentEntries(1000);

    if (entries.length === 0) {
      return {
        totalOperations: 0,
        successRate: 0,
        averageDuration: 0
      };
    }

    const successCount = entries.filter(e => e.success).length;
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);

    return {
      totalOperations: entries.length,
      successRate: (successCount / entries.length) * 100,
      averageDuration: totalDuration / entries.length,
      lastOperation: entries[entries.length - 1]?.timestamp
    };
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();
