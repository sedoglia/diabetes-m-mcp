/**
 * Diabetes:M MCP Server
 *
 * Implements the Model Context Protocol server for Diabetes:M integration.
 * Provides 9 tools for accessing diabetes management data and credential management.
 *
 * SECURITY: Credentials are NEVER stored in config files or environment variables.
 * They are encrypted with AES-256-GCM and stored in the user profile.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type ListToolsRequest
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  ALL_TOOL_DEFINITIONS,
  TOOL_EXECUTORS,
  type ToolName
} from './tools/index.js';
import { auditLogger } from './security/audit.js';
import { credentialsManager } from './security/credentials.js';
import { diabetesMClient } from './api/client.js';
import { keyringManager } from './security/keyring.js';

/**
 * Creates and configures the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: 'diabetes-m-mcp',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async (_request: ListToolsRequest) => {
    return {
      tools: ALL_TOOL_DEFINITIONS
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    const timer = auditLogger.startTimer();

    try {
      // Validate tool name
      if (!(name in TOOL_EXECUTORS)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message: `Unknown tool: ${name}`,
                availableTools: Object.keys(TOOL_EXECUTORS)
              })
            }
          ],
          isError: true
        };
      }

      // Check if credentials are needed but not configured
      // (skip for credential management tools)
      const credentialTools = ['setup_credentials', 'check_credentials', 'clear_credentials'];
      if (!credentialTools.includes(name) && !credentialsManager.hasCredentials()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                type: 'AuthenticationRequired',
                message: 'No credentials configured. Please use the setup_credentials tool first to configure your Diabetes:M login.',
                hint: 'Ask Claude to help you set up your Diabetes:M credentials securely.'
              })
            }
          ],
          isError: true
        };
      }

      // Execute tool
      const executor = TOOL_EXECUTORS[name as ToolName];
      const result = await executor(args || {});

      // Log success
      auditLogger.logOperation(
        'tool_call',
        name,
        true,
        timer(),
        JSON.stringify(args)
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      // Log failure
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorCode = error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'EXECUTION_ERROR';

      auditLogger.logOperation(
        'tool_call',
        name,
        false,
        timer(),
        JSON.stringify(args),
        errorCode
      );

      // Format error response
      let formattedError: string;

      if (error instanceof z.ZodError) {
        formattedError = JSON.stringify({
          error: true,
          type: 'ValidationError',
          message: 'Invalid input parameters',
          details: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        });
      } else {
        formattedError = JSON.stringify({
          error: true,
          type: 'ExecutionError',
          message: errorMessage
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: formattedError
          }
        ],
        isError: true
      };
    }
  });

  return server;
}

/**
 * Initializes the server
 * Note: Credentials are managed through the setup_credentials tool,
 * NOT through environment variables or config files.
 */
export async function initializeServer(): Promise<void> {
  // Initialize keyring/encryption
  const keyringAvailable = await keyringManager.isKeytarAvailable();
  const storageType = keyringAvailable ? 'OS Keyring' : 'encrypted file';

  console.error(`[Server] Security: Using ${storageType} for master key storage`);

  // Check for existing credentials
  const hasCredentials = credentialsManager.hasCredentials();

  if (hasCredentials) {
    console.error('[Server] Credentials found in secure storage');

    // Try to authenticate with stored credentials
    const creds = await credentialsManager.getCredentials();
    if (creds) {
      const success = await diabetesMClient.authenticate(creds.email, creds.password);
      if (success) {
        console.error('[Server] Successfully authenticated with stored credentials');
      } else {
        console.error('[Server] Stored credentials invalid - use setup_credentials to reconfigure');
      }
    }
  } else {
    console.error('[Server] No credentials configured');
    console.error('[Server] Use the setup_credentials tool to configure your Diabetes:M login');
  }
}

/**
 * Cleanup function for graceful shutdown
 */
export async function cleanupServer(): Promise<void> {
  try {
    // Logout from API
    await diabetesMClient.logout();

    // Cleanup audit logs
    auditLogger.cleanupOldEntries();

    console.error('[Server] Cleanup completed');
  } catch (error) {
    console.error('[Server] Cleanup error:', error);
  }
}
