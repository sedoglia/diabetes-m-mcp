/**
 * Tool: setup_credentials
 *
 * Configures Diabetes:M credentials securely.
 * Credentials are encrypted with AES-256-GCM and stored in the user profile.
 *
 * Security:
 * - Credentials never stored in plain text
 * - Encrypted with master key from OS keyring
 * - Stored in platform-specific config directory:
 *   - Windows: %LOCALAPPDATA%\diabetes-m-mcp\
 *   - macOS: ~/Library/Application Support/diabetes-m-mcp/
 *   - Linux: ~/.config/diabetes-m-mcp/
 */

import { z } from 'zod';
import { join } from 'node:path';
import { credentialsManager } from '../security/credentials.js';
import { diabetesMClient } from '../api/client.js';
import { auditLogger } from '../security/audit.js';
import { keyringManager } from '../security/keyring.js';
import { CREDENTIALS_FILE_NAME, getConfigDir } from '../types/security.js';

export const setupCredentialsToolDefinition = {
  name: 'setup_credentials',
  description: 'Configure Diabetes:M login credentials. Credentials are encrypted and stored securely in your user profile - never in plain text or config files.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      email: {
        type: 'string',
        description: 'Your Diabetes:M account email or username'
      },
      password: {
        type: 'string',
        description: 'Your Diabetes:M account password'
      }
    },
    required: ['email', 'password']
  },
  annotations: {
    title: 'Setup Credentials',
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true
  }
};

const SetupCredentialsInputSchema = z.object({
  email: z.string().min(1, 'Email is required'),
  password: z.string().min(1, 'Password is required')
});

export interface SetupCredentialsResult {
  success: boolean;
  message: string;
  storageLocation: string;
  securityInfo: {
    encryptionMethod: string;
    keyStorage: string;
    credentialsFile: string;
  };
}

/**
 * Executes the setup_credentials tool
 */
export async function executeSetupCredentials(
  args: unknown
): Promise<SetupCredentialsResult> {
  const timer = auditLogger.startTimer();

  // Validate input
  const validatedInput = SetupCredentialsInputSchema.parse(args);
  const { email, password } = validatedInput;

  try {
    // Store credentials encrypted
    await credentialsManager.storeCredentials(email, password);

    // Try to authenticate to verify credentials
    const authSuccess = await diabetesMClient.authenticate(email, password);

    if (!authSuccess) {
      // Credentials stored but auth failed - warn user
      auditLogger.logOperation('setup_credentials', 'setup_credentials', false, timer(), undefined, 'AUTH_FAILED');

      return {
        success: false,
        message: 'Credentials saved but authentication failed. Please verify your email and password are correct for analytics.diabetes-m.com',
        storageLocation: credentialsManager.getStorageInfo().configDir,
        securityInfo: {
          encryptionMethod: 'AES-256-GCM with PBKDF2 key derivation',
          keyStorage: await keyringManager.isKeytarAvailable() ? 'OS Keyring (Windows Credential Vault / macOS Keychain / Linux Secret Service)' : 'Encrypted file',
          credentialsFile: join(getConfigDir(), CREDENTIALS_FILE_NAME)
        }
      };
    }

    auditLogger.logOperation('setup_credentials', 'setup_credentials', true, timer());

    return {
      success: true,
      message: 'Credentials configured and verified successfully. You can now use all Diabetes:M tools.',
      storageLocation: credentialsManager.getStorageInfo().configDir,
      securityInfo: {
        encryptionMethod: 'AES-256-GCM with PBKDF2 key derivation',
        keyStorage: await keyringManager.isKeytarAvailable() ? 'OS Keyring (Windows Credential Vault / macOS Keychain / Linux Secret Service)' : 'Encrypted file',
        credentialsFile: join(getConfigDir(), CREDENTIALS_FILE_NAME)
      }
    };
  } catch (error) {
    auditLogger.logOperation('setup_credentials', 'setup_credentials', false, timer(), undefined, 'STORAGE_ERROR');

    throw new Error(
      `Failed to store credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Tool: check_credentials
 *
 * Checks if credentials are configured and valid.
 */
export const checkCredentialsToolDefinition = {
  name: 'check_credentials',
  description: 'Check if Diabetes:M credentials are configured and show security status. Does not reveal any credential information.',
  inputSchema: {
    type: 'object' as const,
    properties: {}
  },
  annotations: {
    title: 'Check Credentials',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false
  }
};

export interface CheckCredentialsResult {
  configured: boolean;
  authenticated: boolean;
  storageInfo: {
    hasCredentials: boolean;
    hasTokens: boolean;
    configDir: string;
    keyringAvailable: boolean;
  };
  message: string;
}

/**
 * Executes the check_credentials tool
 */
export async function executeCheckCredentials(
  _args: unknown
): Promise<CheckCredentialsResult> {
  const storageInfo = credentialsManager.getStorageInfo();
  const keyringAvailable = await keyringManager.isKeytarAvailable();

  const result: CheckCredentialsResult = {
    configured: storageInfo.hasCredentials,
    authenticated: diabetesMClient.isAuthenticated(),
    storageInfo: {
      ...storageInfo,
      keyringAvailable
    },
    message: ''
  };

  if (!result.configured) {
    result.message = 'No credentials configured. Use the setup_credentials tool to configure your Diabetes:M login.';
  } else if (!result.authenticated) {
    result.message = 'Credentials are configured but not currently authenticated. The next API call will attempt to authenticate.';
  } else {
    result.message = 'Credentials are configured and authenticated. All Diabetes:M tools are ready to use.';
  }

  return result;
}

/**
 * Tool: clear_credentials
 *
 * Removes stored credentials and tokens.
 */
export const clearCredentialsToolDefinition = {
  name: 'clear_credentials',
  description: 'Remove all stored Diabetes:M credentials and tokens from secure storage.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      confirm: {
        type: 'boolean',
        description: 'Must be true to confirm deletion'
      }
    },
    required: ['confirm']
  },
  annotations: {
    title: 'Clear Credentials',
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  }
};

const ClearCredentialsInputSchema = z.object({
  confirm: z.boolean()
});

export interface ClearCredentialsResult {
  success: boolean;
  message: string;
}

/**
 * Executes the clear_credentials tool
 */
export async function executeClearCredentials(
  args: unknown
): Promise<ClearCredentialsResult> {
  const timer = auditLogger.startTimer();
  const validatedInput = ClearCredentialsInputSchema.parse(args);

  if (!validatedInput.confirm) {
    return {
      success: false,
      message: 'Deletion not confirmed. Set confirm to true to delete credentials.'
    };
  }

  try {
    await credentialsManager.clearAll();
    await diabetesMClient.logout();

    auditLogger.logOperation('clear_credentials', 'clear_credentials', true, timer());

    return {
      success: true,
      message: 'All credentials and tokens have been removed from secure storage.'
    };
  } catch (error) {
    auditLogger.logOperation('clear_credentials', 'clear_credentials', false, timer(), undefined, 'CLEAR_ERROR');

    return {
      success: false,
      message: `Failed to clear credentials: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
