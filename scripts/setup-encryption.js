#!/usr/bin/env node
/**
 * Setup Encryption Script
 *
 * Interactive script to configure Diabetes:M credentials securely.
 * Stores email and password encrypted using AES-256-GCM with the master key
 * stored in the OS keyring (or file-based fallback).
 *
 * Usage: npm run setup-encryption
 */

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash, pbkdf2Sync } from 'node:crypto';

// Constants
const KEYRING_SERVICE_NAME = 'diabetes-m-mcp';
const KEYRING_MASTER_KEY_ACCOUNT = 'master-key';
const CREDENTIALS_FILE_NAME = 'diabetesm-credentials.enc';
const ENCRYPTION_VERSION = 1;

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
const FALLBACK_KEY_FILE = join(CONFIG_DIR, 'master.key.enc');

/**
 * Ensures config directory exists
 */
function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Derives a key from machine-specific data for fallback encryption
 */
function deriveFallbackKey() {
  const machineId = `${homedir()}-${process.platform}-${process.arch}`;
  const salt = createHash('sha256').update('diabetesm-salt-v1').digest();
  return scryptSync(machineId, salt, 32);
}

/**
 * Encrypts master key for file storage (fallback mode)
 */
function encryptForFile(masterKey) {
  const fallbackKey = deriveFallbackKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', fallbackKey, iv);
  const encrypted = Buffer.concat([cipher.update(masterKey), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fallbackKey.fill(0);
  return Buffer.concat([iv, authTag, encrypted]);
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
 * Generates a 32-byte random key
 */
function generateMasterKey() {
  return randomBytes(32);
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
 * Gets or creates master key
 */
async function getMasterKey() {
  const keytar = await loadKeytar();

  if (keytar) {
    try {
      const storedKey = await keytar.getPassword(KEYRING_SERVICE_NAME, KEYRING_MASTER_KEY_ACCOUNT);
      if (storedKey) {
        return { key: Buffer.from(storedKey, 'base64'), storage: 'keyring' };
      }
      // Generate new key
      const newKey = generateMasterKey();
      await keytar.setPassword(KEYRING_SERVICE_NAME, KEYRING_MASTER_KEY_ACCOUNT, newKey.toString('base64'));
      return { key: newKey, storage: 'keyring' };
    } catch (error) {
      console.error('Keyring error, falling back to file:', error.message);
    }
  }

  // Fallback to file-based storage
  ensureConfigDir();
  if (existsSync(FALLBACK_KEY_FILE)) {
    const encryptedData = readFileSync(FALLBACK_KEY_FILE);
    return { key: decryptFromFile(encryptedData), storage: 'file' };
  }

  // Generate new key
  const newKey = generateMasterKey();
  const encryptedKey = encryptForFile(newKey);
  writeFileSync(FALLBACK_KEY_FILE, encryptedKey, { mode: 0o600 });
  return { key: newKey, storage: 'file' };
}

/**
 * Encrypts text using AES-256-GCM
 */
function encrypt(plaintext, masterKey) {
  const salt = randomBytes(SECURITY_CONFIG.saltSize);
  const iv = randomBytes(SECURITY_CONFIG.ivSize);
  const key = pbkdf2Sync(masterKey, salt, SECURITY_CONFIG.pbkdf2Iterations, SECURITY_CONFIG.keySize, 'sha512');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  key.fill(0);
  return {
    data: combined.toString('base64'),
    version: ENCRYPTION_VERSION,
    timestamp: new Date().toISOString()
  };
}

/**
 * Prompts for input (with optional hidden input for passwords)
 */
function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });

    if (hidden && process.platform !== 'win32') {
      // Hide input on Unix systems
      process.stdout.write(question);
      const stdin = process.openStdin();
      stdin.setRawMode(true);

      let input = '';
      stdin.on('data', function handler(char) {
        char = char.toString();
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            stdin.setRawMode(false);
            stdin.removeListener('data', handler);
            stdout.write('\n');
            rl.close();
            resolve(input);
            break;
          case '\u0003':
            process.exit();
            break;
          case '\u007F':
            input = input.slice(0, -1);
            break;
          default:
            input += char;
            break;
        }
      });
    } else {
      // Windows or visible input
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Simple prompt using readline
 */
function simplePrompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Main setup function
 */
async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Diabetes:M MCP Server - Credential Setup');
  console.log('='.repeat(60));
  console.log('');
  console.log('This script will securely store your Diabetes:M credentials.');
  console.log('Your email and password will be encrypted using AES-256-GCM.');
  console.log('');

  // Check if credentials already exist
  if (existsSync(CREDENTIALS_PATH)) {
    console.log('WARNING: Credentials already configured.');
    const overwrite = await simplePrompt('Do you want to overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Setup cancelled.');
      process.exit(0);
    }
    console.log('');
  }

  // Get master key
  console.log('Initializing encryption...');
  const { key: masterKey, storage } = await getMasterKey();
  console.log(`Master key storage: ${storage === 'keyring' ? 'OS Keyring (secure)' : 'Encrypted file'}`);
  console.log('');

  // Prompt for credentials
  const email = await simplePrompt('Enter your Diabetes:M email: ');
  if (!email || !email.includes('@')) {
    console.error('ERROR: Invalid email address.');
    process.exit(1);
  }

  console.log('Enter your Diabetes:M password (input will be visible on Windows):');
  const password = await simplePrompt('Password: ');
  if (!password || password.length < 4) {
    console.error('ERROR: Password too short.');
    process.exit(1);
  }

  // Encrypt and store
  console.log('');
  console.log('Encrypting credentials...');

  ensureConfigDir();

  const now = new Date().toISOString();
  const storedCredentials = {
    email: encrypt(email, masterKey),
    password: encrypt(password, masterKey),
    createdAt: now,
    updatedAt: now
  };

  writeFileSync(CREDENTIALS_PATH, JSON.stringify(storedCredentials, null, 2), { mode: 0o600 });

  // Clear sensitive data from memory
  masterKey.fill(0);

  console.log('');
  console.log('='.repeat(60));
  console.log('  Setup Complete!');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Credentials stored in: ${CREDENTIALS_PATH}`);
  console.log(`Master key stored in: ${storage === 'keyring' ? 'OS Keyring' : FALLBACK_KEY_FILE}`);
  console.log('');
  console.log('You can verify the configuration with: npm run check-encryption');
  console.log('');
}

main().catch((error) => {
  console.error('Setup failed:', error.message);
  process.exit(1);
});
