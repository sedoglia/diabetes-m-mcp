# Diabetes:M MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[🇮🇹 Versione Italiana](README_IT.md)

MCP (Model Context Protocol) server for integrating [Diabetes:M](https://diabetes-m.com) health data with Claude Desktop. Access your glucose readings, insulin data, food diary, and health metrics through natural language conversations.

## ✨ Features

- **9 MCP Tools** for comprehensive diabetes data access
- **Multi-layer security** with AES-256-GCM encryption
- **System keyring integration** for secure master key storage (Windows Credential Vault, macOS Keychain, Linux Secret Service)
- **Encrypted credential storage** in user profile (never in config files)
- **Cookie-based authentication** (reverse-engineered from analytics.diabetes-m.com)
- **Smart food search** from your diary entries
- **Comprehensive audit logging**

## 🔧 Available Tools

### Credential Management

| Tool | Description |
|------|-------------|
| `setup_credentials` | Configure your Diabetes:M login securely |
| `check_credentials` | Check if credentials are configured |
| `clear_credentials` | Remove stored credentials |

### Health Data Tools

| Tool | Description |
|------|-------------|
| `get_logbook_entries` | Retrieve logbook entries (glucose, insulin, carbs, notes) |
| `get_glucose_statistics` | Get glucose distribution, average, estimated HbA1c |
| `get_insulin_analysis` | Analyze insulin usage and carb ratios |
| `get_personal_metrics` | Get weight, BMI, blood pressure, HbA1c |
| `search_foods` | Search food database (includes your custom foods from diary) |
| `generate_health_report` | Generate comprehensive health report |

## 📦 Installation

### Option 1: Using npx (Recommended)

No installation required - just configure Claude Desktop:

```json
{
  "mcpServers": {
    "diabetes-m": {
      "command": "npx",
      "args": ["-y", "@anthropic/diabetes-m-mcp"]
    }
  }
}
```

### Option 2: Global Installation

```bash
npm install -g @anthropic/diabetes-m-mcp
```

Then configure Claude Desktop:

```json
{
  "mcpServers": {
    "diabetes-m": {
      "command": "diabetes-m-mcp"
    }
  }
}
```

### Option 3: From Source

```bash
git clone https://github.com/anthropics/diabetes-m-mcp.git
cd diabetes-m-mcp
npm install
npm run build
```

Then configure Claude Desktop:

```json
{
  "mcpServers": {
    "diabetes-m": {
      "command": "node",
      "args": ["/path/to/diabetes-m-mcp/dist/index.js"]
    }
  }
}
```

## ⚙️ Claude Desktop Configuration

Configuration file location:

| OS | Path |
|----|------|
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

**⚠️ IMPORTANT: NO credentials in config file!** Credentials are managed securely through the `setup_credentials` tool.

## 🚀 First-Time Setup

1. Add the server to your Claude Desktop config (see above)
2. Restart Claude Desktop
3. Ask Claude: **"Setup my Diabetes:M credentials"**
4. Provide your email/username and password when prompted
5. Your credentials are encrypted and stored securely
6. Start using natural language to access your diabetes data!

## 💬 Usage Examples

### Setup Credentials
```
"Setup my Diabetes:M credentials with username myuser and password mypassword"
```

### Check Credential Status
```
"Check my Diabetes:M credential status"
```

### Get Logbook Entries
```
"Show me my logbook entries for the last 7 days"
"What were my glucose readings yesterday?"
```

### Get Glucose Statistics
```
"Show me my glucose statistics for the past 30 days"
"What's my estimated HbA1c?"
"How is my time in range this month?"
```

### Analyze Insulin Usage
```
"Analyze my insulin usage over the last 14 days"
"What's my average daily insulin dose?"
```

### Get Personal Metrics
```
"What are my current health metrics?"
"Show me my weight and blood pressure history"
```

### Search Foods
```
"Search for 'polenta' in the food database"
"Find nutrition info for pasta"
```

### Generate Health Report
```
"Generate a detailed health report for the last 90 days"
```

## 🔒 Security Architecture

### Multi-Layer Protection

```
┌─────────────────────────────────────────────────────┐
│                  Layer 1: OS Keyring                │
│  Master key in Windows Vault / macOS Keychain /     │
│  Linux Secret Service                               │
├─────────────────────────────────────────────────────┤
│              Layer 2: Encryption at Rest            │
│  AES-256-GCM • Random IV/Salt • PBKDF2 (100K iter) │
├─────────────────────────────────────────────────────┤
│               Layer 3: Secure Storage               │
│  ~/.diabetesm/credentials.enc • tokens.enc          │
│  File permissions: 0600 (owner only)                │
├─────────────────────────────────────────────────────┤
│              Layer 4: Input Validation              │
│  Zod schemas • SQL injection prevention             │
│  Rate limiting (1 req/sec)                          │
├─────────────────────────────────────────────────────┤
│               Layer 5: Audit Logging                │
│  Hashed identifiers • Separate sensitive log        │
│  Configurable retention (default: 90 days)          │
└─────────────────────────────────────────────────────┘
```

### Storage Locations

| File | Purpose |
|------|---------|
| `~/.diabetesm/diabetesm-credentials.enc` | Encrypted credentials |
| `~/.diabetesm/diabetesm-tokens.enc` | Encrypted session tokens |
| `~/.diabetesm/diabetesm-audit.log` | Audit log (hashed data) |

## 🏗️ Project Structure

```
diabetes-m-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # MCP server setup
│   ├── api/
│   │   ├── auth.ts           # Authentication (with cookie handling)
│   │   ├── client.ts         # HTTP client
│   │   └── endpoints.ts      # API endpoints (reverse-engineered)
│   ├── security/
│   │   ├── audit.ts          # Audit logging
│   │   ├── credentials.ts    # Credential management
│   │   ├── encryption.ts     # AES-256-GCM encryption
│   │   └── keyring.ts        # System keyring integration
│   ├── cache/
│   │   └── encrypted-cache.ts # Encrypted caching
│   ├── tools/
│   │   ├── setup-credentials.ts
│   │   ├── get-logbook-entries.ts
│   │   ├── get-glucose-statistics.ts
│   │   ├── get-insulin-analysis.ts
│   │   ├── get-personal-metrics.ts
│   │   ├── search-foods.ts    # Searches API + diary entries
│   │   └── generate-health-report.ts
│   └── types/
│       ├── api.ts            # API types
│       ├── security.ts       # Security types
│       └── tools.ts          # Tool schemas
├── package.json
├── tsconfig.json
└── README.md
```

## 🔍 Troubleshooting

### "No credentials configured" Error

Run the setup_credentials tool:
```
"Setup my Diabetes:M credentials"
```

### Authentication Failed

1. Verify your email/username and password are correct
2. Try logging into [analytics.diabetes-m.com](https://analytics.diabetes-m.com) manually
3. Re-run setup_credentials with correct credentials

### Keyring Issues

If the system keyring isn't available:
- The server automatically falls back to encrypted file storage
- Keys are stored in `~/.diabetesm/master.key.enc`
- Security is maintained through machine-specific encryption

### Rate Limiting

The server implements rate limiting (1 request/second). If you see rate limit errors:
- Wait a few seconds and retry
- Avoid rapid successive calls

### Food Search Returns No Results

The Diabetes:M API food search only returns public database foods. If you're searching for your custom foods:
- The tool automatically searches your diary entries for custom foods
- Ensure you've used the food in a meal entry within the last 90 days

## 🔧 Development

### Prerequisites

- Node.js 18+
- npm 8+

### Build

```bash
npm install
npm run build
```

### Run Locally

```bash
npm start
```

### Watch Mode

```bash
npm run dev
```

## 🔏 Privacy Policy

### Data Collection
This MCP server collects and processes the following data:
- **Diabetes:M credentials** (username/password): Stored locally in encrypted form only
- **Health data**: Glucose readings, insulin doses, food logs, and personal metrics retrieved from your Diabetes:M account
- **Audit logs**: Hashed operation logs for security monitoring (no raw health data)

### Data Storage
- All data is stored **locally on your device** in `~/.diabetesm/`
- Credentials are encrypted with **AES-256-GCM** encryption
- Master encryption key is stored in your **OS keyring** (Windows Credential Vault, macOS Keychain, or Linux Secret Service)
- No data is stored in config files or plain text

### Data Transmission
- Data is transmitted **only to Diabetes:M servers** (analytics.diabetes-m.com)
- All connections use **HTTPS/TLS** encryption
- **No data is sent to Anthropic, third parties, or any other servers**

### Data Retention
- Cached data expires automatically (5-minute TTL for sensitive data)
- Audit logs are retained for 90 days by default
- You can delete all stored data at any time using the `clear_credentials` tool

### Your Rights
- You have full control over your data
- Use `clear_credentials` to remove all stored credentials and tokens
- Delete the `~/.diabetesm/` directory to remove all local data

### Third-Party Services
This server interacts only with:
- **Diabetes:M** (analytics.diabetes-m.com): Your health data provider

## 📜 License

MIT License - See [LICENSE](LICENSE) file

## ⚠️ Disclaimer

This tool is for personal health management and informational purposes only. It does not provide medical advice. Always consult with your healthcare provider for medical decisions.

**Not affiliated with, endorsed by, or connected to Diabetes:M or Sirma Medical Systems.**

## 🙏 Credits

- Diabetes:M API reverse-engineered from [analytics.diabetes-m.com](https://analytics.diabetes-m.com)
- Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- Inspired by [garmin-mcp-ts](https://github.com/sedoglia/garmin-mcp-ts)

## ☕ Support

If you find this project useful, consider supporting the development:

[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue.svg)](https://www.paypal.com/donate/?business=YOUR_PAYPAL)
