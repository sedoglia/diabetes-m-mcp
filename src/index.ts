#!/usr/bin/env node
/**
 * Diabetes:M MCP Server
 *
 * Entry point for the Model Context Protocol server that integrates
 * Diabetes:M health data with Claude Desktop.
 *
 * SECURITY: Credentials are NEVER stored in config files or environment variables.
 * Use the setup_credentials tool to configure your login securely.
 *
 * Usage:
 *   npx @anthropic/diabetes-m-mcp
 *
 * Configuration in Claude Desktop's claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "diabetes-m": {
 *         "command": "npx",
 *         "args": ["-y", "@anthropic/diabetes-m-mcp"]
 *       }
 *     }
 *   }
 *
 * First-time setup:
 *   Ask Claude: "Setup my Diabetes:M credentials"
 *   Claude will use the setup_credentials tool to securely store your login.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, initializeServer, cleanupServer } from './server.js';

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.error('[DiabetesM-MCP] Starting server...');

  // Initialize server (checks for stored credentials)
  await initializeServer();

  // Create server
  const server = createServer();

  // Create stdio transport
  const transport = new StdioServerTransport();

  // Handle process signals for graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.error(`[DiabetesM-MCP] Received ${signal}, shutting down...`);

    try {
      await cleanupServer();
      await server.close();
      console.error('[DiabetesM-MCP] Server stopped');
      process.exit(0);
    } catch (error) {
      console.error('[DiabetesM-MCP] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('[DiabetesM-MCP] Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[DiabetesM-MCP] Unhandled rejection:', reason);
    process.exit(1);
  });

  // Connect transport and start server
  try {
    await server.connect(transport);
    console.error('[DiabetesM-MCP] Server running on stdio');
    console.error('[DiabetesM-MCP] Available tools:');
    console.error('  Credential Management:');
    console.error('    - setup_credentials: Configure your Diabetes:M login securely');
    console.error('    - check_credentials: Check credential status');
    console.error('    - clear_credentials: Remove stored credentials');
    console.error('  Data Tools:');
    console.error('    - get_logbook_entries: Retrieve logbook entries');
    console.error('    - get_glucose_statistics: Get glucose statistics');
    console.error('    - get_insulin_analysis: Analyze insulin usage');
    console.error('    - get_personal_metrics: Get personal health metrics');
    console.error('    - search_foods: Search food database');
    console.error('    - generate_health_report: Generate health reports');
  } catch (error) {
    console.error('[DiabetesM-MCP] Failed to start server:', error);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('[DiabetesM-MCP] Fatal error:', error);
  process.exit(1);
});
