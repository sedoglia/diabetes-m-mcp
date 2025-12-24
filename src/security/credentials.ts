/**
 * Credentials Management Module
 *
 * Handles encrypted storage of:
 * - User credentials (email/password)
 * - Session tokens (access token, session ID)
 *
 * All data is encrypted with AES-256-GCM using the master key from keyring.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CREDENTIALS_FILE_NAME,
  TOKENS_FILE_NAME,
  type StoredCredentials,
  type StoredTokens,
  type EncryptedData
} from '../types/security.js';
import { encryptionService } from './encryption.js';
import { keyringManager } from './keyring.js';

const CONFIG_DIR = join(homedir(), '.diabetesm');
const CREDENTIALS_PATH = join(CONFIG_DIR, CREDENTIALS_FILE_NAME);
const TOKENS_PATH = join(CONFIG_DIR, TOKENS_FILE_NAME);

/**
 * Ensures config directory exists with proper permissions
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Credentials Manager
 */
class CredentialsManager {
  private masterKey: Buffer | null = null;

  /**
   * Initializes the credentials manager by loading the master key
   */
  private async ensureMasterKey(): Promise<Buffer> {
    if (!this.masterKey) {
      this.masterKey = await keyringManager.getMasterKey();
    }
    return this.masterKey;
  }

  /**
   * Stores user credentials (email/password) encrypted
   */
  async storeCredentials(email: string, password: string): Promise<void> {
    ensureConfigDir();
    const masterKey = await this.ensureMasterKey();

    const now = new Date().toISOString();
    const storedCredentials: StoredCredentials = {
      email: encryptionService.encrypt(email, masterKey),
      password: encryptionService.encrypt(password, masterKey),
      createdAt: now,
      updatedAt: now
    };

    writeFileSync(
      CREDENTIALS_PATH,
      JSON.stringify(storedCredentials, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Retrieves stored credentials
   * @returns Decrypted email and password, or null if not stored
   */
  async getCredentials(): Promise<{ email: string; password: string } | null> {
    if (!existsSync(CREDENTIALS_PATH)) {
      return null;
    }

    try {
      const masterKey = await this.ensureMasterKey();
      const data = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as StoredCredentials;

      return {
        email: encryptionService.decrypt(data.email, masterKey),
        password: encryptionService.decrypt(data.password, masterKey)
      };
    } catch (error) {
      console.error('[CredentialsManager] Failed to read credentials:', error);
      return null;
    }
  }

  /**
   * Checks if credentials are stored
   */
  hasCredentials(): boolean {
    return existsSync(CREDENTIALS_PATH);
  }

  /**
   * Deletes stored credentials
   */
  async deleteCredentials(): Promise<void> {
    if (existsSync(CREDENTIALS_PATH)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(CREDENTIALS_PATH);
    }
  }

  /**
   * Stores session tokens encrypted
   */
  async storeTokens(accessToken: string, sessionId?: string, expiresAt?: Date): Promise<void> {
    ensureConfigDir();
    const masterKey = await this.ensureMasterKey();

    const now = new Date().toISOString();
    const expiry = expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000); // Default 24h

    const storedTokens: StoredTokens = {
      accessToken: encryptionService.encrypt(accessToken, masterKey),
      sessionId: sessionId
        ? encryptionService.encrypt(sessionId, masterKey)
        : undefined,
      expiresAt: expiry.toISOString(),
      createdAt: now
    };

    writeFileSync(
      TOKENS_PATH,
      JSON.stringify(storedTokens, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Retrieves stored tokens if not expired
   * @returns Decrypted tokens or null if not stored/expired
   */
  async getTokens(): Promise<{ accessToken: string; sessionId?: string } | null> {
    if (!existsSync(TOKENS_PATH)) {
      return null;
    }

    try {
      const masterKey = await this.ensureMasterKey();
      const data = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as StoredTokens;

      // Check expiry
      const expiresAt = new Date(data.expiresAt);
      if (expiresAt <= new Date()) {
        console.error('[CredentialsManager] Tokens expired, deleting');
        await this.deleteTokens();
        return null;
      }

      return {
        accessToken: encryptionService.decrypt(data.accessToken, masterKey),
        sessionId: data.sessionId
          ? encryptionService.decrypt(data.sessionId, masterKey)
          : undefined
      };
    } catch (error) {
      console.error('[CredentialsManager] Failed to read tokens:', error);
      return null;
    }
  }

  /**
   * Checks if valid (non-expired) tokens are stored
   */
  async hasValidTokens(): Promise<boolean> {
    const tokens = await this.getTokens();
    return tokens !== null;
  }

  /**
   * Deletes stored tokens
   */
  async deleteTokens(): Promise<void> {
    if (existsSync(TOKENS_PATH)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(TOKENS_PATH);
    }
  }

  /**
   * Clears all stored data (credentials and tokens)
   */
  async clearAll(): Promise<void> {
    await this.deleteCredentials();
    await this.deleteTokens();
  }

  /**
   * Gets info about stored data without revealing sensitive content
   */
  getStorageInfo(): { hasCredentials: boolean; hasTokens: boolean; configDir: string } {
    return {
      hasCredentials: existsSync(CREDENTIALS_PATH),
      hasTokens: existsSync(TOKENS_PATH),
      configDir: CONFIG_DIR
    };
  }
}

// Singleton instance
export const credentialsManager = new CredentialsManager();
