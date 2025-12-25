/**
 * Keyring Integration Module
 *
 * Provides secure master key storage using OS-native keyrings:
 * - macOS: Keychain
 * - Windows: Credential Vault
 * - Linux: Secret Service (GNOME Keyring, KWallet)
 *
 * Falls back to file-based storage if keytar is unavailable.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import {
  KEYRING_SERVICE_NAME,
  KEYRING_MASTER_KEY_ACCOUNT,
  getConfigDir,
  type KeyringService
} from '../types/security.js';
import { encryptionService } from './encryption.js';

const CONFIG_DIR = getConfigDir();
const FALLBACK_KEY_FILE = join(CONFIG_DIR, 'master.key.enc');

/**
 * Wrapper for keytar with fallback support
 */
class KeyringManager {
  private keytar: KeyringService | null = null;
  private keytarAvailable: boolean | null = null;

  /**
   * Attempts to load keytar dynamically
   */
  private async loadKeytar(): Promise<KeyringService | null> {
    if (this.keytarAvailable === false) {
      return null;
    }

    if (this.keytar) {
      return this.keytar;
    }

    try {
      // Dynamic import to handle missing native module
      const keytarModule = await import('keytar');
      this.keytar = keytarModule.default || keytarModule;
      this.keytarAvailable = true;
      return this.keytar;
    } catch {
      console.error('[KeyringManager] keytar not available, using file-based fallback');
      this.keytarAvailable = false;
      return null;
    }
  }

  /**
   * Ensures config directory exists
   */
  private ensureConfigDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Derives a key from machine-specific data for fallback encryption
   */
  private deriveFallbackKey(): Buffer {
    // Use machine-specific data as password
    const machineId = `${homedir()}-${process.platform}-${process.arch}`;
    const salt = createHash('sha256').update('diabetesm-salt-v1').digest();
    return scryptSync(machineId, salt, 32);
  }

  /**
   * Encrypts master key for file storage (fallback mode)
   */
  private encryptForFile(masterKey: Buffer): Buffer {
    const fallbackKey = this.deriveFallbackKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', fallbackKey, iv);
    const encrypted = Buffer.concat([cipher.update(masterKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Zero fallback key
    fallbackKey.fill(0);

    return Buffer.concat([iv, authTag, encrypted]);
  }

  /**
   * Decrypts master key from file (fallback mode)
   */
  private decryptFromFile(data: Buffer): Buffer {
    const fallbackKey = this.deriveFallbackKey();
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);

    const decipher = createDecipheriv('aes-256-gcm', fallbackKey, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      fallbackKey.fill(0);
      return decrypted;
    } catch {
      fallbackKey.fill(0);
      throw new Error('Failed to decrypt master key from file');
    }
  }

  /**
   * Gets the master key, generating if needed
   */
  async getMasterKey(): Promise<Buffer> {
    // Try keytar first
    const keytar = await this.loadKeytar();

    if (keytar) {
      try {
        const storedKey = await keytar.getPassword(
          KEYRING_SERVICE_NAME,
          KEYRING_MASTER_KEY_ACCOUNT
        );

        if (storedKey) {
          return Buffer.from(storedKey, 'base64');
        }

        // Generate new key
        const newKey = encryptionService.generateMasterKey();
        await keytar.setPassword(
          KEYRING_SERVICE_NAME,
          KEYRING_MASTER_KEY_ACCOUNT,
          newKey.toString('base64')
        );
        console.error('[KeyringManager] Generated new master key in system keyring');
        return newKey;
      } catch (error) {
        console.error('[KeyringManager] Keyring error, falling back to file:', error);
      }
    }

    // Fallback to file-based storage
    return this.getMasterKeyFromFile();
  }

  /**
   * Gets master key from file (fallback)
   */
  private getMasterKeyFromFile(): Buffer {
    this.ensureConfigDir();

    if (existsSync(FALLBACK_KEY_FILE)) {
      const encryptedData = readFileSync(FALLBACK_KEY_FILE);
      return this.decryptFromFile(encryptedData);
    }

    // Generate new key
    const newKey = encryptionService.generateMasterKey();
    const encryptedKey = this.encryptForFile(newKey);
    writeFileSync(FALLBACK_KEY_FILE, encryptedKey, { mode: 0o600 });
    console.error('[KeyringManager] Generated new master key in file');
    return newKey;
  }

  /**
   * Deletes the master key (for reset/cleanup)
   */
  async deleteMasterKey(): Promise<boolean> {
    let deleted = false;

    // Try keytar
    const keytar = await this.loadKeytar();
    if (keytar) {
      try {
        deleted = await keytar.deletePassword(
          KEYRING_SERVICE_NAME,
          KEYRING_MASTER_KEY_ACCOUNT
        );
      } catch {
        // Ignore errors
      }
    }

    // Also delete file if exists
    if (existsSync(FALLBACK_KEY_FILE)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(FALLBACK_KEY_FILE);
      deleted = true;
    }

    return deleted;
  }

  /**
   * Checks if keytar (native keyring) is available
   */
  async isKeytarAvailable(): Promise<boolean> {
    await this.loadKeytar();
    return this.keytarAvailable === true;
  }

  /**
   * Gets the storage location being used
   */
  async getStorageLocation(): Promise<'keyring' | 'file'> {
    const available = await this.isKeytarAvailable();
    return available ? 'keyring' : 'file';
  }
}

// Singleton instance
export const keyringManager = new KeyringManager();
