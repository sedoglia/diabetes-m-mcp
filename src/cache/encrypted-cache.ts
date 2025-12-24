/**
 * Encrypted Cache Module
 *
 * Provides encrypted in-memory caching with TTL for sensitive data.
 * Supports both encrypted (for sensitive data) and plain (for public data) caching.
 */

import { createHash } from 'node:crypto';
import { encryptionService } from '../security/encryption.js';
import { keyringManager } from '../security/keyring.js';
import { DEFAULT_SECURITY_CONFIG } from '../types/security.js';

interface CacheEntry<T> {
  data: T | string; // T for plain, encrypted string for sensitive
  encrypted: boolean;
  expiresAt: number;
  createdAt: number;
}

/**
 * Encrypted Cache Manager
 */
class EncryptedCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private masterKey: Buffer | null = null;

  /**
   * Generates a cache key hash
   */
  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Ensures master key is loaded
   */
  private async ensureMasterKey(): Promise<Buffer> {
    if (!this.masterKey) {
      this.masterKey = await keyringManager.getMasterKey();
    }
    return this.masterKey;
  }

  /**
   * Stores data in cache with encryption
   *
   * @param key - Cache key
   * @param data - Data to cache
   * @param ttlMs - Time to live in milliseconds (default: 5 minutes)
   * @param encrypt - Whether to encrypt the data (default: true)
   */
  async set<T>(
    key: string,
    data: T,
    ttlMs: number = DEFAULT_SECURITY_CONFIG.cacheTtlMs,
    encrypt: boolean = true
  ): Promise<void> {
    const hashedKey = this.hashKey(key);
    const now = Date.now();

    let storedData: T | string;
    if (encrypt) {
      const masterKey = await this.ensureMasterKey();
      const encrypted = encryptionService.encrypt(JSON.stringify(data), masterKey);
      storedData = encrypted.data;
    } else {
      storedData = data;
    }

    const entry: CacheEntry<T> = {
      data: storedData,
      encrypted: encrypt,
      expiresAt: now + ttlMs,
      createdAt: now
    };

    this.cache.set(hashedKey, entry);
  }

  /**
   * Retrieves data from cache
   *
   * @param key - Cache key
   * @returns Cached data or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    const hashedKey = this.hashKey(key);
    const entry = this.cache.get(hashedKey) as CacheEntry<T> | undefined;

    if (!entry) {
      return null;
    }

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hashedKey);
      return null;
    }

    if (entry.encrypted) {
      try {
        const masterKey = await this.ensureMasterKey();
        const decrypted = encryptionService.decrypt(
          { data: entry.data as string, version: 1, timestamp: '' },
          masterKey
        );
        return JSON.parse(decrypted) as T;
      } catch {
        // Decryption failed, remove corrupt entry
        this.cache.delete(hashedKey);
        return null;
      }
    }

    return entry.data as T;
  }

  /**
   * Checks if key exists and is not expired
   */
  has(key: string): boolean {
    const hashedKey = this.hashKey(key);
    const entry = this.cache.get(hashedKey);

    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(hashedKey);
      return false;
    }

    return true;
  }

  /**
   * Deletes a cache entry
   */
  delete(key: string): boolean {
    const hashedKey = this.hashKey(key);
    return this.cache.delete(hashedKey);
  }

  /**
   * Clears all cached data
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Removes all expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Gets cache statistics
   */
  getStats(): { size: number; oldestEntry?: number; newestEntry?: number } {
    if (this.cache.size === 0) {
      return { size: 0 };
    }

    let oldest = Infinity;
    let newest = 0;

    for (const entry of this.cache.values()) {
      if (entry.createdAt < oldest) oldest = entry.createdAt;
      if (entry.createdAt > newest) newest = entry.createdAt;
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
      newestEntry: newest
    };
  }
}

// Singleton instance
export const encryptedCache = new EncryptedCache();

/**
 * Cache decorator for async functions
 */
export function cached<T>(
  keyPrefix: string,
  ttlMs: number = DEFAULT_SECURITY_CONFIG.cacheTtlMs,
  encrypt: boolean = true
) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<T>;

    descriptor.value = async function (...args: unknown[]): Promise<T> {
      const cacheKey = `${keyPrefix}:${JSON.stringify(args)}`;

      // Try to get from cache
      const cachedResult = await encryptedCache.get<T>(cacheKey);
      if (cachedResult !== null) {
        return cachedResult;
      }

      // Execute original method
      const result = await originalMethod.apply(this, args);

      // Store in cache
      await encryptedCache.set(cacheKey, result, ttlMs, encrypt);

      return result;
    };

    return descriptor;
  };
}
