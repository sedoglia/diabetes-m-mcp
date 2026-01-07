# Diabetes:M MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Compatibile-purple.svg)](https://modelcontextprotocol.io/)
[![Licenza: MIT](https://img.shields.io/badge/Licenza-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![PayPal](https://img.shields.io/badge/Supporta%20il%20Progetto-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/sedoglia)

**[🇬🇧 English Version](README_EN.md)**

Server MCP (Model Context Protocol) per integrare i dati di [Diabetes:M](https://diabetes-m.com) con Claude Desktop. Accedi alle tue letture glicemiche, dati insulina, diario alimentare e metriche di salute attraverso conversazioni in linguaggio naturale.

## ✨ Funzionalità

- **10 Strumenti MCP** per accesso completo ai dati del diabete
- **Sicurezza multi-livello** con crittografia AES-256-GCM
- **Integrazione keyring di sistema** per archiviazione sicura della chiave master (Windows Credential Vault, macOS Keychain, Linux Secret Service)
- **Credenziali criptate** nel profilo utente (mai nei file di configurazione)
- **Autenticazione basata su cookie** (reverse-engineered da analytics.diabetes-m.com)
- **Ricerca cibi intelligente** dalle voci del tuo diario
- **Logging di audit completo**

## 🔧 Strumenti Disponibili

### Gestione Credenziali

| Strumento | Descrizione |
|-----------|-------------|
| `setup_credentials` | Configura il login Diabetes:M in modo sicuro |
| `check_credentials` | Verifica se le credenziali sono configurate |
| `clear_credentials` | Rimuovi le credenziali memorizzate |

### Strumenti Dati Salute

| Strumento | Descrizione |
|-----------|-------------|
| `get_logbook_entries` | Recupera voci del diario (glicemia, insulina, carboidrati, note) |
| `get_glucose_statistics` | Ottieni distribuzione glucosio, media, HbA1c stimata |
| `get_insulin_analysis` | Analizza utilizzo insulina e rapporti carboidrati |
| `get_iob` | Calcola l'Insulina Attiva (IOB) - insulina ancora in azione nel corpo |
| `get_personal_metrics` | Ottieni peso, BMI, pressione sanguigna, HbA1c |
| `search_foods` | Cerca nel database cibi (include i tuoi cibi personalizzati dal diario) |
| `generate_health_report` | Genera report salute completo |

---

## Prerequisiti

- **Node.js** 18.0 o superiore
- **npm** 8.0 o superiore
- **Claude Desktop** installato
- Account **Diabetes-M Connect** con credenziali valide

## 🚀 Installazione Rapida (Bundle Precompilato)

### Passaggi:

### 1. Installa Keytar (Raccomandato per sicurezza massima)

Per utilizzare il vault nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service), installa `keytar`:

```bash
npm install keytar
```

> **Nota:** Se `keytar` non può essere installato, il sistema userà automaticamente un file criptato come fallback.

### 2. Scarica il bundle

Usa il browser oppure:

```bash
wget https://github.com/sedoglia/diabetes-m-mcp/releases/download/v1.1.0/diabetes-m-mcp.mcpb
```

### 3. Verifica l'integrità

Verifica l'integrità (opzionale ma consigliato):

```bash
wget https://github.com/sedoglia/diabetes-m-mcp/releases/download/v1.1.0/diabetes-m-mcp.mcpb.sha256
sha256sum -c diabetes-m-mcp.mcpb.sha256
```

### 4. Installa l'estensione in Claude Desktop (Metodo Consigliato)

**Installazione tramite Custom Desktop Extensions:**

1. Apri **Claude Desktop**
2. Vai su **Impostazioni** (Settings)
3. Seleziona la scheda **Estensioni** (Extensions)
4. Clicca su **Impostazioni Avanzate** (Advanced settings) e trova la sezione **Extension Developer**
5. Clicca su **"Installa Estensione..."** (Install Extension…)
6. Seleziona il file `.mcpb` (`diabetes-m-mcp.mcpb` scaricato al passaggio 2)
7. Segui le indicazioni a schermo per completare l'installazione

> **Nota:** Questo è il metodo più semplice e consigliato. L'estensione sarà automaticamente integrata in Claude Desktop senza necessità di configurazione manuale.

---

### 5. Configura le Credenziali Diabetes-M (Metodo Sicuro - Raccomandato)

Apri una **nuova chat su Claude Desktop** e scrivi il seguente prompt:

```
Configura le credenziali di accesso per Diabetes-M
```

Rispondi al messaggio fornendo:
- **Utente:** la tua email Diabetes-M
- **Password:** la tua password Diabetes-M

L'estensione provvederà automaticamente a criptare e salvare le credenziali in modo sicuro nel vault nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service).

> **Nota:** Le credenziali NON verranno salvate in file di testo. Saranno sempre crittografate e gestite dal vault nativo del SO.

### 6. Riavvia Claude Desktop

- Chiudi completamente l'applicazione
- Riapri Claude Desktop
- Verifica in Impostazioni → Sviluppatore lo stato della connessione ✅

## 🚀 Installazione (clonando il repository con GIT)

### 1. Clona il Repository

```bash
git clone https://github.com/sedoglia/diabetes-m-mcp
cd diabetes-m-mcp
```

### 2. Installa le Dipendenze

```bash
npm install
```

### 3. Installa Keytar (Raccomandato per sicurezza massima)

Per utilizzare il vault nativo del sistema operativo (Windows Credential Manager, macOS Keychain, Linux Secret Service), installa `keytar`:

```bash
npm install keytar
```

> **Nota:** Se `keytar` non può essere installato, il sistema userà automaticamente un file criptato come fallback.

### 4. Compila il Progetto

```bash
npm run build
```

### 5. Configura le Credenziali Diabetes-M (Metodo Sicuro - Raccomandato)

Esegui lo script di setup per configurare le credenziali in modo sicuro:

```bash
npm run setup-encryption
```

Questo script:
1. Crea una directory sicura nella home dell'utente
2. Genera una chiave di encryption e la salva nel vault nativo del SO
3. Chiede email e password Diabetes-M
4. Cripta e salva le credenziali in modo sicuro

Per verificare la configurazione:
```bash
npm run check-encryption
```

> **Nota sulla Sicurezza:** Non commitare mai il file `.env` nel controllo versione. È già incluso in `.gitignore`. Si consiglia di usare il metodo sicuro sopra descritto.

### 6. Configurazione di Claude Desktop

#### Posizione del File di Configurazione

Il file di configurazione di Claude Desktop si trova in:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

#### Esempio di Configurazione

Aggiungi il server MCP Diabetes-M al tuo `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "Diabetes-M": {
      "command": "node",
      "args": ["C:\\percorso\\a\\diabetes-M-mcp\\dist\\index.js"]
    }
  }
}
```

**Per macOS/Linux:**

```json
{
  "mcpServers": {
    "Diabetes-M": {
      "command": "node",
      "args": ["/percorso/a/diabetes-m-mcp/dist/index.js"]
    }
  }
}
```

#### Verifica della Configurazione

1. Riavvia Claude Desktop dopo aver salvato la configurazione
2. Cerca gli strumenti Diabetes-M tra quelli disponibili (icona martello)
3. Prova a chiedere: "Quali sono le mie attività recenti su Diabetes-M?"

## 💬 Esempi d'Uso

### Configurazione Credenziali
```
"Configura le mie credenziali Diabetes:M con username mioutente e password miapassword"
```

### Verifica Stato Credenziali
```
"Verifica lo stato delle mie credenziali Diabetes:M"
```

### Ottieni Voci Diario
```
"Mostrami le voci del diario degli ultimi 7 giorni"
"Quali erano le mie letture glicemiche ieri?"
```

### Ottieni Statistiche Glucosio
```
"Mostrami le statistiche glucosio degli ultimi 30 giorni"
"Qual è la mia HbA1c stimata?"
"Com'è il mio tempo nel range questo mese?"
```

### Analizza Uso Insulina
```
"Analizza il mio uso di insulina nelle ultime 2 settimane"
"Qual è la mia dose media giornaliera di insulina?"
```

### Ottieni Insulina Attiva (IOB)
```
"Quanta insulina attiva ho in questo momento?"
"Calcola il mio IOB con DIA di 4 ore"
"Mostrami l'insulina on board attuale"
```

### Ottieni Metriche Personali
```
"Quali sono le mie metriche di salute attuali?"
"Mostrami la cronologia di peso e pressione sanguigna"
```

### Cerca Cibi
```
"Cerca 'polenta' nel database cibi"
"Trova le info nutrizionali per la pasta"
```

### Genera Report Salute
```
"Genera un report dettagliato sulla salute per gli ultimi 90 giorni"
```

## 🔒 Architettura di Sicurezza

### Protezione Multi-Livello

```
┌─────────────────────────────────────────────────────┐
│               Livello 1: OS Keyring                 │
│  Chiave master in Windows Vault / macOS Keychain /  │
│  Linux Secret Service                               │
├─────────────────────────────────────────────────────┤
│           Livello 2: Crittografia a Riposo          │
│  AES-256-GCM • IV/Salt casuali • PBKDF2 (100K iter) │
├─────────────────────────────────────────────────────┤
│            Livello 3: Storage Sicuro                │
│  %LOCALAPPDATA%/diabetes-m-mcp/ (Win)               │
│  ~/Library/Application Support/diabetes-m-mcp/ (Mac)│
│  ~/.config/diabetes-m-mcp/ (Linux)                  │
├─────────────────────────────────────────────────────┤
│           Livello 4: Validazione Input              │
│  Schemi Zod • Prevenzione SQL injection             │
│  Rate limiting (1 req/sec)                          │
├─────────────────────────────────────────────────────┤
│             Livello 5: Audit Logging                │
│  Identificatori hashati • Log sensibili separati    │
│  Retention configurabile (default: 90 giorni)       │
└─────────────────────────────────────────────────────┘
```

### Posizioni di Storage

I file di configurazione sono salvati in percorsi specifici per ogni sistema operativo:

| Sistema Operativo | Percorso |
|-------------------|----------|
| **Windows** | `%LOCALAPPDATA%\diabetes-m-mcp\` |
| **macOS** | `~/Library/Application Support/diabetes-m-mcp/` |
| **Linux** | `~/.config/diabetes-m-mcp/` |

| File | Scopo |
|------|-------|
| `diabetesm-credentials.enc` | Credenziali criptate |
| `diabetesm-tokens.enc` | Token sessione criptati |
| `diabetesm-audit.log` | Log audit (dati hashati) |

> **Nota:** La chiave di crittografia master è sempre salvata nel keyring nativo del sistema operativo (Windows Credential Vault, macOS Keychain, Linux Secret Service), non in questi file.

## 🏗️ Struttura Progetto

```
diabetes-m-mcp/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Setup server MCP
│   ├── api/
│   │   ├── auth.ts           # Autenticazione (con gestione cookie)
│   │   ├── client.ts         # Client HTTP
│   │   └── endpoints.ts      # Endpoint API (reverse-engineered)
│   ├── security/
│   │   ├── audit.ts          # Logging audit
│   │   ├── credentials.ts    # Gestione credenziali
│   │   ├── encryption.ts     # Crittografia AES-256-GCM
│   │   └── keyring.ts        # Integrazione keyring sistema
│   ├── cache/
│   │   └── encrypted-cache.ts # Cache criptata
│   ├── tools/
│   │   ├── setup-credentials.ts
│   │   ├── get-logbook-entries.ts
│   │   ├── get-glucose-statistics.ts
│   │   ├── get-insulin-analysis.ts
│   │   ├── get-iob.ts         # Calcolo IOB (Insulin on Board)
│   │   ├── get-personal-metrics.ts
│   │   ├── search-foods.ts    # Cerca in API + voci diario
│   │   └── generate-health-report.ts
│   └── types/
│       ├── api.ts            # Tipi API
│       ├── security.ts       # Tipi sicurezza
│       └── tools.ts          # Schemi strumenti
├── package.json
├── tsconfig.json
└── README.md
```

## 🧪 Test

Il progetto include una suite di test completa per verificare il funzionamento di tutti gli strumenti MCP con dati reali.

### Eseguire i Test

```bash
npm test
```

### Prerequisiti

- Le credenziali devono essere configurate (`npm run setup-encryption`)
- Il progetto deve essere compilato (`npm run build`)

### Strumenti Testati

| Test | Descrizione |
|------|-------------|
| `check_credentials` | Verifica configurazione credenziali |
| `get_logbook_entries (today)` | Voci diario di oggi |
| `get_logbook_entries (7days)` | Voci diario ultimi 7 giorni |
| `get_logbook_entries (date)` | Voci diario per data specifica |
| `get_glucose_statistics (7 days)` | Statistiche glicemia 7 giorni |
| `get_glucose_statistics (30 days)` | Statistiche glicemia 30 giorni |
| `get_insulin_analysis` | Analisi insulina e rapporti |
| `get_iob` | Calcolo Insulina Attiva (IOB) |
| `get_personal_metrics` | Metriche personali |
| `search_foods` | Ricerca cibi (database + diario) |
| `generate_health_report` | Generazione report salute |

### Output Esempio

```
═══════════════════════════════════════════════════════════
  Diabetes:M MCP Server - Test Suite
═══════════════════════════════════════════════════════════

▸ Prerequisites
  ✓ Credentials configured

▸ Credential Tools
  ✓ check_credentials (5ms)

▸ Data Tools
  ✓ get_logbook_entries (today) (2279ms)
  ✓ get_logbook_entries (7days) (147ms)
  ✓ get_glucose_statistics (7 days) (175ms)
  ✓ get_insulin_analysis (7 days) (1116ms)
  ✓ get_personal_metrics (105ms)
  ✓ search_foods ("pasta") (1265ms)
  ✓ generate_health_report (7 days) (1083ms)

═══════════════════════════════════════════════════════════
  Test Summary
═══════════════════════════════════════════════════════════

  Passed:  13
  Failed:  0

All tests passed! ✓
```

## 🔍 Risoluzione Problemi

### Errore "No credentials configured"

Esegui lo strumento setup_credentials:
```
"Configura le mie credenziali Diabetes:M"
```

### Autenticazione Fallita

1. Verifica che email/username e password siano corretti
2. Prova ad accedere manualmente a [analytics.diabetes-m.com](https://analytics.diabetes-m.com)
3. Riesegui setup_credentials con le credenziali corrette

### Problemi Keyring

Se il keyring di sistema non è disponibile:
- Il server usa automaticamente lo storage file criptato come fallback
- Le chiavi sono memorizzate in `<config-dir>/master.key.enc`
- La sicurezza è mantenuta attraverso crittografia specifica per macchina

### Rate Limiting

Il server implementa rate limiting (1 richiesta/secondo). Se vedi errori di rate limit:
- Attendi qualche secondo e riprova
- Evita chiamate successive rapide

### Ricerca Cibi Non Trova Risultati

La ricerca cibi dell'API Diabetes:M restituisce solo cibi dal database pubblico. Se cerchi i tuoi cibi personalizzati:
- Lo strumento cerca automaticamente nelle voci del tuo diario per i cibi personalizzati
- Assicurati di aver usato il cibo in una voce pasto negli ultimi 90 giorni

## 🔏 Privacy Policy

### Raccolta Dati
Questo server MCP raccoglie e tratta i seguenti dati:
- **Credenziali Diabetes:M** (username/password): Memorizzate localmente solo in forma criptata
- **Dati salute**: Letture glucosio, dosi insulina, log alimentari e metriche personali recuperate dal tuo account Diabetes:M
- **Log audit**: Log operazioni hashati per monitoraggio sicurezza (nessun dato salute grezzo)

### Archiviazione Dati
- Tutti i dati sono memorizzati **localmente sul tuo dispositivo** nella directory specifica del SO:
  - Windows: `%LOCALAPPDATA%\diabetes-m-mcp\`
  - macOS: `~/Library/Application Support/diabetes-m-mcp/`
  - Linux: `~/.config/diabetes-m-mcp/`
- Le credenziali sono criptate con crittografia **AES-256-GCM**
- La chiave master di crittografia è memorizzata nel tuo **keyring del SO** (Windows Credential Vault, macOS Keychain, o Linux Secret Service)
- Nessun dato memorizzato in file di configurazione o testo semplice

### Trasmissione Dati
- I dati sono trasmessi **solo ai server Diabetes:M** (analytics.diabetes-m.com)
- Tutte le connessioni usano crittografia **HTTPS/TLS**
- **Nessun dato inviato ad Anthropic, terze parti o altri server**

### Conservazione Dati
- I dati in cache scadono automaticamente (TTL 5 minuti per dati sensibili)
- I log audit sono conservati per 90 giorni di default
- Puoi eliminare tutti i dati memorizzati in qualsiasi momento usando lo strumento `clear_credentials`

### I Tuoi Diritti
- Hai pieno controllo sui tuoi dati
- Usa `clear_credentials` per rimuovere tutte le credenziali e token memorizzati
- Elimina la directory di configurazione del SO per rimuovere tutti i dati locali

### Servizi di Terze Parti
Questo server interagisce solo con:
- **Diabetes:M** (analytics.diabetes-m.com): Il tuo fornitore dati salute

## 📜 Licenza

MIT License - Vedi file [LICENSE](LICENSE)

## ⚠️ Disclaimer

Questo strumento è solo per gestione personale della salute e scopi informativi. Non fornisce consigli medici. Consulta sempre il tuo medico per decisioni mediche.

**Non affiliato, approvato o connesso a Diabetes:M o Sirma Medical Systems.**

## 🙏 Crediti

- API Diabetes:M reverse-engineered da [analytics.diabetes-m.com](https://analytics.diabetes-m.com)
- Costruito con [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- Ispirato da [garmin-mcp-ts](https://github.com/sedoglia/garmin-mcp-ts)

## ☕ Supporto

Se trovi questo progetto utile, considera di supportare lo sviluppo:

[![PayPal](https://img.shields.io/badge/PayPal-Dona-blue.svg)](https://paypal.me/sedoglia)
