# Diabetes:M MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatible-purple.svg)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![PayPal](https://img.shields.io/badge/Support%20the%20Project-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/sedoglia)

**[🇮🇹 Versione Italiana](README.md)**

MCP (Model Context Protocol) server to integrate [Diabetes:M](https://diabetes-m.com) data with Claude Desktop. Access your glucose readings, insulin data, food diary, and health metrics through natural language conversations.

## ✨ Features

- **9 MCP Tools** for complete diabetes data access
- **Multi-layer security** with AES-256-GCM encryption
- **System keyring integration** for secure master key storage (Windows Credential Vault, macOS Keychain, Linux Secret Service)
- **Encrypted credentials** in user profile (never in config files)
- **Cookie-based authentication** (reverse-engineered from analytics.diabetes-m.com)
- **Smart food search** from your diary entries
- **Comprehensive audit logging**

## 🔧 Available Tools

### Credential Management

| Tool | Description |
|------|-------------|
| `setup_credentials` | Configure Diabetes:M login securely |
| `check_credentials` | Check if credentials are configured |
| `clear_credentials` | Remove stored credentials |

### Health Data Tools

| Tool | Description |
|------|-------------|
| `get_logbook_entries` | Retrieve diary entries (glucose, insulin, carbs, notes) |
| `get_glucose_statistics` | Get glucose distribution, average, estimated HbA1c |
| `get_insulin_analysis` | Analyze insulin usage and carb ratios |
| `get_personal_metrics` | Get weight, BMI, blood pressure, HbA1c |
| `search_foods` | Search food database (includes your custom foods from diary) |
| `generate_health_report` | Generate comprehensive health report |

---

## Prerequisites

- **Node.js** 18.0 or higher
- **npm** 8.0 or higher
- **Claude Desktop** installed
- **Diabetes-M Connect** account with valid credentials

## 🚀 Quick Installation (Precompiled Bundle)

### Steps:

### 1. Install Keytar (Recommended for maximum security)

To use the native OS vault (Windows Credential Manager, macOS Keychain, Linux Secret Service), install `keytar`:

```bash
npm install keytar
```

> **Note:** If `keytar` cannot be installed, the system will automatically use an encrypted file as fallback.

### 2. Download the bundle

Use your browser or:

```bash
wget https://github.com/sedoglia/diabetes-m-mcp/releases/download/v1.1.0/diabetes-m-mcp.mcpb
```

### 3. Verify integrity

Verify integrity (optional but recommended):

```bash
wget https://github.com/sedoglia/diabetes-m-mcp/releases/download/v1.1.0/diabetes-m-mcp.mcpb.sha256
sha256sum -c diabetes-m-mcp.mcpb.sha256
```

### 4. Install the extension in Claude Desktop (Recommended Method)

**Installation via Custom Desktop Extensions:**

1. Open **Claude Desktop**
2. Go to **Settings**
3. Select the **Extensions** tab
4. Click on **Advanced settings** and find the **Extension Developer** section
5. Click on **"Install Extension..."**
6. Select the `.mcpb` file (`diabetes-m-mcp.mcpb` downloaded in step 1)
7. Follow the on-screen instructions to complete the installation

> **Note:** This is the simplest and recommended method. The extension will be automatically integrated into Claude Desktop without manual configuration.

---

### 5. Configure Diabetes-M Credentials (Secure Method - Recommended)

Open a **new chat in Claude Desktop** and type the following prompt:

```
Configure my Diabetes-M login credentials
```

Reply to the message providing:
- **Username:** your Diabetes-M email
- **Password:** your Diabetes-M password

The extension will automatically encrypt and securely save the credentials in the native OS vault (Windows Credential Manager, macOS Keychain, Linux Secret Service).

> **Note:** Credentials will NOT be saved in text files. They will always be encrypted and managed by the native OS vault.

### 6. Restart Claude Desktop

- Close the application completely
- Reopen Claude Desktop
- Check in Settings → Developer the connection status ✅

## 🚀 Installation (cloning the repository with GIT)

### 1. Clone the Repository

```bash
git clone https://github.com/sedoglia/diabetes-m-mcp
cd diabetes-m-mcp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Install Keytar (Recommended for maximum security)

To use the native OS vault (Windows Credential Manager, macOS Keychain, Linux Secret Service), install `keytar`:

```bash
npm install keytar
```

> **Note:** If `keytar` cannot be installed, the system will automatically use an encrypted file as fallback.

### 4. Build the Project

```bash
npm run build
```

### 5. Configure Diabetes-M Credentials (Secure Method - Recommended)

Run the setup script to configure credentials securely:

```bash
npm run setup-encryption
```

This script:
1. Creates a secure directory in the user's home
2. Generates an encryption key and saves it in the native OS vault
3. Asks for Diabetes-M email and password
4. Encrypts and securely saves the credentials

To verify the configuration:
```bash
npm run check-encryption
```

> **Security Note:** Never commit the `.env` file to version control. It's already included in `.gitignore`. We recommend using the secure method described above.

### 6. Claude Desktop Configuration

#### Configuration File Location

The Claude Desktop configuration file is located at:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

#### Configuration Example

Add the Diabetes-M MCP server to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "Diabetes-M": {
      "command": "node",
      "args": ["C:\\path\\to\\diabetes-M-mcp\\dist\\index.js"]
    }
  }
}
```

**For macOS/Linux:**

```json
{
  "mcpServers": {
    "Diabetes-M": {
      "command": "node",
      "args": ["/path/to/diabetes-m-mcp/dist/index.js"]
    }
  }
}
```

#### Configuration Verification

1. Restart Claude Desktop after saving the configuration
2. Look for Diabetes-M tools among the available ones (hammer icon)
3. Try asking: "What are my recent activities on Diabetes-M?"

## 💬 Usage Examples

### Configure Credentials
```
"Configure my Diabetes:M credentials with username myuser and password mypassword"
```

### Check Credentials Status
```
"Check the status of my Diabetes:M credentials"
```

### Get Logbook Entries
```
"Show me the logbook entries from the last 7 days"
"What were my glucose readings yesterday?"
```

### Get Glucose Statistics
```
"Show me glucose statistics for the last 30 days"
"What is my estimated HbA1c?"
"How is my time in range this month?"
```

### Analyze Insulin Usage
```
"Analyze my insulin usage over the last 2 weeks"
"What is my average daily insulin dose?"
```

### Get Personal Metrics
```
"What are my current health metrics?"
"Show me my weight and blood pressure history"
```

### Search Foods
```
"Search for 'polenta' in the food database"
"Find nutritional info for pasta"
```

### Generate Health Report
```
"Generate a detailed health report for the last 90 days"
```

## 🔒 Security Architecture

### Multi-Layer Protection

```
┌─────────────────────────────────────────────────────┐
│                Layer 1: OS Keyring                  │
│  Master key in Windows Vault / macOS Keychain /     │
│  Linux Secret Service                               │
├─────────────────────────────────────────────────────┤
│            Layer 2: Encryption at Rest              │
│  AES-256-GCM • Random IV/Salt • PBKDF2 (100K iter)  │
├─────────────────────────────────────────────────────┤
│              Layer 3: Secure Storage                │
│  %LOCALAPPDATA%/diabetes-m-mcp/ (Win)               │
│  ~/Library/Application Support/diabetes-m-mcp/ (Mac)│
│  ~/.config/diabetes-m-mcp/ (Linux)                  │
├─────────────────────────────────────────────────────┤
│            Layer 4: Input Validation                │
│  Zod schemas • SQL injection prevention             │
│  Rate limiting (1 req/sec)                          │
├─────────────────────────────────────────────────────┤
│              Layer 5: Audit Logging                 │
│  Hashed identifiers • Separate sensitive log        │
│  Configurable retention (default: 90 days)          │
└─────────────────────────────────────────────────────┘
```

### Storage Locations

Configuration files are saved in OS-specific directories:

| Operating System | Path |
|------------------|------|
| **Windows** | `%LOCALAPPDATA%\diabetes-m-mcp\` |
| **macOS** | `~/Library/Application Support/diabetes-m-mcp/` |
| **Linux** | `~/.config/diabetes-m-mcp/` |

| File | Purpose |
|------|---------|
| `diabetesm-credentials.enc` | Encrypted credentials |
| `diabetesm-tokens.enc` | Encrypted session tokens |
| `diabetesm-audit.log` | Audit log (hashed data) |

> **Note:** The master encryption key is always saved in the native OS keyring (Windows Credential Vault, macOS Keychain, Linux Secret Service), not in these files.

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
"Configure my Diabetes:M credentials"
```

### Authentication Failed

1. Verify your email/username and password are correct
2. Try logging into [analytics.diabetes-m.com](https://analytics.diabetes-m.com) manually
3. Re-run setup_credentials with correct credentials

### Keyring Issues

If the system keyring isn't available:
- The server automatically falls back to encrypted file storage
- Keys are stored in `<config-dir>/master.key.enc`
- Security is maintained through machine-specific encryption

### Rate Limiting

The server implements rate limiting (1 request/second). If you see rate limit errors:
- Wait a few seconds and retry
- Avoid rapid successive calls

### Food Search Returns No Results

The Diabetes:M API food search only returns foods from the public database. If you're looking for your custom foods:
- The tool automatically searches your diary entries for custom foods
- Make sure you've used the food in a meal entry within the last 90 days

## 🔏 Privacy Policy

### Data Collection
This MCP server collects and processes the following data:
- **Diabetes:M credentials** (username/password): Stored locally in encrypted form only
- **Health data**: Glucose readings, insulin doses, food logs, and personal metrics retrieved from your Diabetes:M account
- **Audit logs**: Hashed operation logs for security monitoring (no raw health data)

### Data Storage
- All data is stored **locally on your device** in the OS-specific config directory:
  - Windows: `%LOCALAPPDATA%\diabetes-m-mcp\`
  - macOS: `~/Library/Application Support/diabetes-m-mcp/`
  - Linux: `~/.config/diabetes-m-mcp/`
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
- Delete the OS-specific config directory to remove all local data

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

[![PayPal](https://img.shields.io/badge/PayPal-Donate-blue.svg)](https://paypal.me/sedoglia)
