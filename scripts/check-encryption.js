#!/usr/bin/env node
/**
 * Check Encryption Script
 *
 * Verifies the Diabetes:M credentials configuration:
 * - Checks if credentials file exists
 * - Verifies master key storage location
 * - Tests decryption of stored credentials
 * - Displays configuration status
 *
 * Usage: npm run check-encryption
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv, scryptSync, createHash, pbkdf2Sync } from 'node:crypto';

// Constants
const KEYRING_SERVICE_NAME = 'diabetes-m-mcp';
const KEYRING_MASTER_KEY_ACCOUNT = 'master-key';
const CREDENTIALS_FILE_NAME = 'diabetesm-credentials.enc';
const TOKENS_FILE_NAME = 'diabetesm-tokens.enc';

// Security config
const SECURITY_CONFIG = {
  keySize: 32,
  ivSize: 16,
  saltSize: 64,
  tagSize: 16,
  pbkdf2Iterations: 100000
};

/**
 * Gets the appropriate config directory for the current OS
 */
function getConfigDir() {
  const home = homedir();
  switch (process.platform) {
    case 'win32':
      return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'diabetes-m-mcp');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'diabetes-m-mcp');
    default:
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'diabetes-m-mcp');
  }
}

const CONFIG_DIR = getConfigDir();
const CREDENTIALS_PATH = join(CONFIG_DIR, CREDENTIALS_FILE_NAME);
const TOKENS_PATH = join(CONFIG_DIR, TOKENS_FILE_NAME);
const FALLBACK_KEY_FILE = join(CONFIG_DIR, 'master.key.enc');

/**
 * Derives a key from machine-specific data for fallback encryption
 */
function deriveFallbackKey() {
  const machineId = `${homedir()}-${process.platform}-${process.arch}`;
  const salt = createHash('sha256').update('diabetesm-salt-v1').digest();
  return scryptSync(machineId, salt, 32);
}

/**
 * Decrypts master key from file (fallback mode)
 */
function decryptFromFile(data) {
  const fallbackKey = deriveFallbackKey();
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
 * Attempts to load keytar dynamically
 */
async function loadKeytar() {
  try {
    const keytarModule = await import('keytar');
    return keytarModule.default || keytarModule;
  } catch {
    return null;
  }
}

/**
 * Gets master key info
 */
async function getMasterKeyInfo() {
  const keytar = await loadKeytar();
  const info = {
    keytarAvailable: !!keytar,
    keyringHasKey: false,
    fileHasKey: existsSync(FALLBACK_KEY_FILE),
    storage: 'none',
    masterKey: null
  };

  if (keytar) {
    try {
      const storedKey = await keytar.getPassword(KEYRING_SERVICE_NAME, KEYRING_MASTER_KEY_ACCOUNT);
      if (storedKey) {
        info.keyringHasKey = true;
        info.storage = 'keyring';
        info.masterKey = Buffer.from(storedKey, 'base64');
      }
    } catch (error) {
      info.keyringError = error.message;
    }
  }

  if (!info.masterKey && info.fileHasKey) {
    try {
      const encryptedData = readFileSync(FALLBACK_KEY_FILE);
      info.masterKey = decryptFromFile(encryptedData);
      info.storage = 'file';
    } catch (error) {
      info.fileError = error.message;
    }
  }

  return info;
}

/**
 * Decrypts encrypted data
 */
function decrypt(encryptedData, masterKey) {
  if (encryptedData.version !== 1) {
    throw new Error(`Unsupported encryption version: ${encryptedData.version}`);
  }

  const combined = Buffer.from(encryptedData.data, 'base64');
  const salt = combined.subarray(0, SECURITY_CONFIG.saltSize);
  const iv = combined.subarray(SECURITY_CONFIG.saltSize, SECURITY_CONFIG.saltSize + SECURITY_CONFIG.ivSize);
  const authTag = combined.subarray(
    SECURITY_CONFIG.saltSize + SECURITY_CONFIG.ivSize,
    SECURITY_CONFIG.saltSize + SECURITY_CONFIG.ivSize + SECURITY_CONFIG.tagSize
  );
  const encrypted = combined.subarray(
    SECURITY_CONFIG.saltSize + SECURITY_CONFIG.ivSize + SECURITY_CONFIG.tagSize
  );

  const key = pbkdf2Sync(masterKey, salt, SECURITY_CONFIG.pbkdf2Iterations, SECURITY_CONFIG.keySize, 'sha512');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    key.fill(0);
    return decrypted.toString('utf8');
  } catch {
    key.fill(0);
    throw new Error('Decryption failed');
  }
}

/**
 * Masks a string showing only first and last chars
 */
function maskString(str, visibleChars = 2) {
  if (str.length <= visibleChars * 2) {
    return '*'.repeat(str.length);
  }
  return str.substring(0, visibleChars) + '*'.repeat(str.length - visibleChars * 2) + str.substring(str.length - visibleChars);
}

/**
 * Main check function
 */
async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Diabetes:M MCP Server - Encryption Status');
  console.log('='.repeat(60));
  console.log('');

  // Platform info
  console.log('System Information:');
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Config directory: ${CONFIG_DIR}`);
  console.log('');

  // Check master key
  console.log('Master Key Status:');
  const keyInfo = await getMasterKeyInfo();

  console.log(`  Keytar (OS Keyring) available: ${keyInfo.keytarAvailable ? 'YES' : 'NO'}`);
  if (keyInfo.keyringError) {
    console.log(`  Keyring error: ${keyInfo.keyringError}`);
  }
  console.log(`  Key in OS Keyring: ${keyInfo.keyringHasKey ? 'YES' : 'NO'}`);
  console.log(`  Key in file: ${keyInfo.fileHasKey ? 'YES' : 'NO'}`);
  console.log(`  Active storage: ${keyInfo.storage.toUpperCase()}`);

  if (!keyInfo.masterKey) {
    console.log('');
    console.log('ERROR: No master key found!');
    console.log('Run "npm run setup-encryption" to configure credentials.');
    process.exit(1);
  }

  console.log('');

  // Check credentials file
  console.log('Credentials Status:');
  if (!existsSync(CREDENTIALS_PATH)) {
    console.log('  Credentials file: NOT FOUND');
    console.log('');
    console.log('ERROR: Credentials not configured!');
    console.log('Run "npm run setup-encryption" to configure credentials.');
    process.exit(1);
  }

  console.log(`  Credentials file: ${CREDENTIALS_PATH}`);

  try {
    const credentialsData = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'));

    // Verify decryption
    const email = decrypt(credentialsData.email, keyInfo.masterKey);
    const password = decrypt(credentialsData.password, keyInfo.masterKey);

    console.log('  Decryption test: PASSED');
    console.log(`  Email: ${maskString(email, 3)}`);
    console.log(`  Password: ${'*'.repeat(password.length)} (${password.length} chars)`);
    console.log(`  Created: ${credentialsData.createdAt}`);
    console.log(`  Updated: ${credentialsData.updatedAt}`);
  } catch (error) {
    console.log('  Decryption test: FAILED');
    console.log('');
    console.log('ERROR: Could not decrypt credentials!');
    console.log('The master key may have changed. Run "npm run setup-encryption" to reconfigure.');
    process.exit(1);
  }

  console.log('');

  // Check tokens file
  console.log('Session Tokens Status:');
  if (!existsSync(TOKENS_PATH)) {
    console.log('  Tokens file: NOT FOUND (will be created on first login)');
  } else {
    console.log(`  Tokens file: ${TOKENS_PATH}`);
    try {
      const tokensData = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
      const expiresAt = new Date(tokensData.expiresAt);
      const isExpired = expiresAt <= new Date();

      console.log(`  Expires: ${tokensData.expiresAt}`);
      console.log(`  Status: ${isExpired ? 'EXPIRED' : 'VALID'}`);
      console.log(`  Created: ${tokensData.createdAt}`);

      if (!isExpired) {
        try {
          decrypt(tokensData.accessToken, keyInfo.masterKey);
          console.log('  Token decryption: PASSED');
        } catch {
          console.log('  Token decryption: FAILED');
        }
      }
    } catch (error) {
      console.log(`  Read error: ${error.message}`);
    }
  }

  // Clear sensitive data
  if (keyInfo.masterKey) {
    keyInfo.masterKey.fill(0);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  All checks passed!');
  console.log('='.repeat(60));
  console.log('');
}

main().catch((error) => {
  console.error('Check failed:', error.message);
  process.exit(1);
});
