/**
 * AES-256-GCM Encryption Module
 *
 * Provides secure encryption/decryption with:
 * - Random IV (16 bytes) per operation
 * - Random salt (64 bytes) for key derivation
 * - PBKDF2 key derivation from master key
 * - GCM authentication tag for integrity
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHash } from 'node:crypto';
import { DEFAULT_SECURITY_CONFIG, type EncryptedData, type SecurityConfig } from '../types/security.js';

const ENCRYPTION_VERSION = 1;

export class EncryptionService {
  private config: SecurityConfig;

  constructor(config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
    this.config = config;
  }

  /**
   * Encrypts text using AES-256-GCM with key derived from master key
   *
   * @param plaintext - Text to encrypt
   * @param masterKey - Master key (from keyring)
   * @returns EncryptedData object with base64 encoded ciphertext
   */
  encrypt(plaintext: string, masterKey: Buffer): EncryptedData {
    // Generate random salt and IV
    const salt = randomBytes(this.config.saltSize);
    const iv = randomBytes(this.config.ivSize);

    // Derive key using PBKDF2
    const key = pbkdf2Sync(
      masterKey,
      salt,
      this.config.pbkdf2Iterations,
      this.config.keySize,
      'sha512'
    );

    // Create cipher and encrypt
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // Concatenate: salt (64) + iv (16) + authTag (16) + encrypted
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);

    // Zero out sensitive data
    key.fill(0);

    return {
      data: combined.toString('base64'),
      version: ENCRYPTION_VERSION,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Decrypts data encrypted with encrypt()
   *
   * @param encryptedData - EncryptedData object
   * @param masterKey - Master key (from keyring)
   * @returns Decrypted plaintext
   * @throws Error if decryption fails (wrong key, tampered data)
   */
  decrypt(encryptedData: EncryptedData, masterKey: Buffer): string {
    if (encryptedData.version !== ENCRYPTION_VERSION) {
      throw new Error(`Unsupported encryption version: ${encryptedData.version}`);
    }

    const combined = Buffer.from(encryptedData.data, 'base64');

    // Extract components
    const salt = combined.subarray(0, this.config.saltSize);
    const iv = combined.subarray(
      this.config.saltSize,
      this.config.saltSize + this.config.ivSize
    );
    const authTag = combined.subarray(
      this.config.saltSize + this.config.ivSize,
      this.config.saltSize + this.config.ivSize + this.config.tagSize
    );
    const encrypted = combined.subarray(
      this.config.saltSize + this.config.ivSize + this.config.tagSize
    );

    // Derive key using same parameters
    const key = pbkdf2Sync(
      masterKey,
      salt,
      this.config.pbkdf2Iterations,
      this.config.keySize,
      'sha512'
    );

    // Create decipher
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);

      // Zero out sensitive data
      key.fill(0);

      return decrypted.toString('utf8');
    } catch (error) {
      // Zero out sensitive data even on error
      key.fill(0);
      throw new Error('Decryption failed: data may be corrupted or key is incorrect');
    }
  }

  /**
   * Generates a secure random master key
   *
   * @returns 32-byte random key
   */
  generateMasterKey(): Buffer {
    return randomBytes(this.config.keySize);
  }

  /**
   * Creates a SHA-256 hash of input for audit logging
   * (Allows traceability without storing sensitive data)
   *
   * @param input - Data to hash
   * @returns Hex-encoded hash
   */
  hashForAudit(input: string): string {
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Securely zeros a buffer
   *
   * @param buffer - Buffer to zero
   */
  secureZero(buffer: Buffer): void {
    buffer.fill(0);
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();
