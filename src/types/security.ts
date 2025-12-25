/**
 * Security Types
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export interface EncryptedData {
  /** Base64 encoded encrypted data (salt + iv + tag + ciphertext) */
  data: string;
  /** Version of encryption scheme */
  version: number;
  /** Timestamp of encryption */
  timestamp: string;
}

export interface StoredCredentials {
  email: EncryptedData;
  password: EncryptedData;
  createdAt: string;
  updatedAt: string;
}

export interface StoredTokens {
  accessToken: EncryptedData;
  sessionId?: EncryptedData;
  expiresAt: string;
  createdAt: string;
}

export interface AuditLogEntry {
  timestamp: string;
  operation: string;
  toolName?: string;
  success: boolean;
  errorCode?: string;
  /** Duration in milliseconds */
  duration: number;
  /** Hash of input for traceability without storing sensitive data */
  inputHash?: string;
}

export interface PersonalMetricsAuditEntry extends AuditLogEntry {
  /** Explicit consent tracking */
  consentGiven: boolean;
  /** Purpose of access */
  purpose: string;
}

export interface RateLimitState {
  lastRequest: number;
  requestCount: number;
  windowStart: number;
}

export interface CacheEntry<T> {
  data: EncryptedData;
  expiresAt: number;
  createdAt: number;
  /** Cache key hash */
  keyHash: string;
}

export interface SecurityConfig {
  /** Encryption key size in bytes */
  keySize: 32;
  /** IV size in bytes */
  ivSize: 16;
  /** Salt size in bytes */
  saltSize: 64;
  /** Auth tag size in bytes */
  tagSize: 16;
  /** PBKDF2 iterations */
  pbkdf2Iterations: number;
  /** Cache TTL in milliseconds */
  cacheTtlMs: number;
  /** Rate limit: requests per second */
  rateLimit: number;
  /** Audit log retention days */
  auditRetentionDays: number;
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  keySize: 32,
  ivSize: 16,
  saltSize: 64,
  tagSize: 16,
  pbkdf2Iterations: 100000,
  cacheTtlMs: 5 * 60 * 1000, // 5 minutes
  rateLimit: 1, // 1 request per second
  auditRetentionDays: 90
};

export interface KeyringService {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export const KEYRING_SERVICE_NAME = 'diabetes-m-mcp';
export const KEYRING_MASTER_KEY_ACCOUNT = 'master-key';
export const CREDENTIALS_FILE_NAME = 'diabetesm-credentials.enc';
export const TOKENS_FILE_NAME = 'diabetesm-tokens.enc';
export const AUDIT_LOG_FILE_NAME = 'diabetesm-audit.log';
export const PERSONAL_AUDIT_LOG_FILE_NAME = 'diabetesm-personal-audit.log';

/**
 * Gets the appropriate config directory for the current OS
 * - Windows: %LOCALAPPDATA%\diabetes-m-mcp\
 * - macOS: ~/Library/Application Support/diabetes-m-mcp/
 * - Linux: ~/.config/diabetes-m-mcp/
 */
export function getConfigDir(): string {
  const home = homedir();

  switch (process.platform) {
    case 'win32':
      // Use LOCALAPPDATA on Windows
      return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'diabetes-m-mcp');
    case 'darwin':
      // Use ~/Library/Application Support on macOS
      return join(home, 'Library', 'Application Support', 'diabetes-m-mcp');
    default:
      // Use ~/.config on Linux and other Unix-like systems
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'diabetes-m-mcp');
  }
}
