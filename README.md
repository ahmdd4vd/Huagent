<div align="center">

<img src="https://img.shields.io/badge/Huagent-v6.5.1-FF6B9D?style=for-the-badge&logo=typescript&logoColor=white" alt="Huagent v6.5.1" />

# ✦ Huagent

### The AI Coding Agent That Lives In Your Terminal

*A production-grade AI coding agent — powered by a wiki knowledge engine, OpenCode-inspired TUI, 22 LLM providers, and 100+ bug fixes.*

<br>

[![npm](https://img.shields.io/npm/v/huagent?style=for-the-badge&logo=npm&logoColor=white&color=FF6B9D)](https://www.npmjs.com/package/huagent)
[![Downloads](https://img.shields.io/npm/dm/huagent?style=for-the-badge&logo=npm&logoColor=white&color=C589E8)](https://www.npmjs.com/package/huagent)
[![GitHub stars](https://img.shields.io/github/stars/ahmdd4vd/Huagent?style=for-the-badge&logo=github&color=FFC75F)](https://github.com/ahmdd4vd/Huagent)
[![License](https://img.shields.io/badge/license-MIT-7BC74D?style=for-the-badge)](LICENSE)

[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-239%20passing-7BC74D?style=flat-square)](#testing)
[![Providers](https://img.shields.io/badge/providers-22-87CEEB?style=flat-square)](#providers)
[![Models](https://img.shields.io/badge/models-101-FFB7C5?style=flat-square)](#providers)
[![Bug Fixes](https://img.shields.io/badge/bugfixes-100%2B-FF6B6B?style=flat-square)](#changelog)
[![TUI](https://img.shields.io/badge/TUI-OpenCode%20inspired-9d7cd8?style=flat-square)](#-modern-tui-opencode-inspired)

<br>

**[Install](#-install)** · **[Features](#-features)** · **[Providers](#-providers)** · **[Usage](#-usage)** · **[Contributing](#-contributing)** · **[Docs](#-documentation)**

</div>

---

## 🖥️ Preview

```
  ╔════════════════════════════════════════════════════════════════════╗
  ║  huagent v6.5.1                                                     ║
  ║  AI coding agent CLI — 22 providers, 101 models                     ║
  ╚════════════════════════════════════════════════════════════════════╝

  › baca package.json dan install lodash

  huagent
  I'll read the file first and then install the package.
  ✓ read  package.json  0.3s
    1│ {
    2│   "name": "my-app",
    3│   …38 more lines
  ✓ bash  npm install lodash  12.4s
    added 1 package in 12s
  Done! lodash is now installed.

  │  Ask, search, or run /help for commands
  │  huagent · MiniMax-M3   custom
  ╰
     ready · ↵ send · alt+↵ newline · ↑↓ history · tab complete · ctrl+c exit
  ~/projects/myapp • 0 LSP  /status
  tokens: 2847  cost: $0.0031  perm: workspace-write  ? help  Ctrl+P/T/E/R pickers
```

---

## ⚡ Install

### Option 1: npm (recommended)

```bash
npm install -g huagent
```

### Option 2: One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh
```

### Option 3: From source

```bash
git clone https://github.com/ahmdd4vd/Huagent.git
cd Huagent
npm install && npm run build
node bin/huagent.js
```

### Quick Start

```bash
# Set any provider's API key
export ANTHROPIC_API_KEY=sk-ant-***   # or OPENAI_API_KEY, GROQ_API_KEY, etc.

# Launch
huagent
```

> **Node.js >= 18 required.** Huagent auto-detects your provider from environment variables — set one and you're ready.

---

## ✨ Features

<div align="center">

| | | |
|:---:|:---:|:---:|
| 🧠 **Wiki Knowledge Engine** | 🎨 **OpenCode-Inspired TUI** | 🔌 **22 LLM Providers** |
| 5-memory system that learns from your codebase | Left-border prompt, minimal aesthetic, inline tool cards | Anthropic, OpenAI, Gemini, DeepSeek, Groq, +17 more |
| 🔧 **Real Tool Execution** | ⌨️ **Full Keyboard Control** | 🛡️ **Security-Hardened** |
| bash, read, write, edit, grep, search, web — all streaming inline | Emacs keys, multi-line, history, autocomplete, 20+ shortcuts | SSRF protection, path-traversal guards, default-allow permissions |
| ⚡ **Fast Streaming** | 💰 **Cost Tracking** | 🧪 **239 Tests** |
| Direct stream + tools (no planning overhead) = OpenCode speed | Real-time token count + cost per request | Comprehensive test suite covering all subsystems |

</div>

### 🔧 Real Tool Execution

Huagent doesn't just talk — it **does**. Tools stream inline with real-time status:

```
huagent
  Let me read the file and fix the bug.
  ✓ read  src/auth.ts  0.2s
    42│ function validateToken(token: string) {
    43│   return jwt.verify(token, secret);
    …
  ✓ edit  src/auth.ts  0.1s
    Successfully edited src/auth.ts
  ✓ bash  npx tsc --noEmit  3.2s
    src/auth.ts:42:5 - No errors found
  The bug is fixed. The validateToken function now properly wraps
  jwt.verify in a try/catch block.
```

### 🧠 WllmConcept — Knowledge That Grows

```
┌─────────────────────────────────────────────────────────┐
│                  5-Memory System                         │
│                                                         │
│   Semantic ──── Facts, concepts, entities               │
│   Episodic ──── Events, debugging sessions              │
│   Structural ── Architecture, dependencies              │
│   Causal ────── Decisions, tradeoffs, migrations        │
│   Meta ──────── Self-reflection, heuristics             │
│                                                         │
│   Confidence: ASSUMED → INFERRED → VERIFIED             │
│   Freshness:  LOW → MEDIUM → HIGH → STALE               │
└─────────────────────────────────────────────────────────┘
```

- **Auto-Ingest** — File watcher extracts functions, classes, patterns, and relationships automatically
- **Scheduled Lint** — 7 quality checks with A–F grading and auto-fix
- **Evolve** — Detects contradictions, suggests new pages, refreshes stale knowledge

### 🎨 Modern TUI (OpenCode-Inspired)

- **Left-border prompt** — signature OpenCode look, no boxy borders
- **Inline streaming** — text appears character-by-character as the LLM generates
- **Inline tool cards** — `✓ read src/index.ts 0.3s` with result preview (3 lines)
- **Braille spinners** (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) for thinking/writing states
- **Multi-line input** — Alt+Enter inserts newline, ↑↓ navigate between lines
- **Emacs editing** — Ctrl+A/E (line start/end), Ctrl+U/K (delete to start/end), Ctrl+W (delete word)
- **Slash command autocomplete** — type `/mod` → get `/model`, `/models`, `/modes`
- **Global shortcuts** — Ctrl+P (provider), Ctrl+T (model), Ctrl+E (scope), Ctrl+R (resume), Ctrl+L (clear), ? (help)
- **Footer status bar** — directory, LSP/MCP counts, /status hint
- **Responsive layout** — adapts to terminal width AND height

### ⌨️ Full Keyboard Control

| Key | Action |
|-----|--------|
| `Enter` | Submit prompt |
| `Alt+Enter` / `Shift+Enter` | Insert newline (multi-line) |
| `↑` / `↓` | Navigate history (single-line) or cursor (multi-line) |
| `←` / `→` | Move cursor horizontally |
| `Ctrl+A` / `Ctrl+E` | Move to line start / end |
| `Ctrl+U` / `Ctrl+K` | Delete to line start / end |
| `Ctrl+W` | Delete previous word |
| `Tab` | Accept autocomplete suggestion |
| `Esc` | Close autocomplete / dialog |
| `Ctrl+C` | Exit huagent |
| `Ctrl+P` | Open provider picker |
| `Ctrl+T` | Open model picker |
| `Ctrl+E` | Open scope picker |
| `Ctrl+R` | Resume previous session |
| `Ctrl+K` | Command palette |
| `Ctrl+L` | Clear messages |
| `?` | Show help dialog |

### 🛡️ Security-Hardened

100+ bugs fixed including 10 critical security vulnerabilities:

- **SSRF protection** — `web` tool blocks private IPs, loopback, cloud metadata (169.254.169.254), link-local
- **Path traversal guards** — session ids, /export filenames validated against `^[A-Za-z0-9_-]+$`
- **Shell injection prevention** — `grep` and `hooks` use `execFile` with arg arrays (no shell interpolation)
- **Default-allow permissions** — workspace-write mode allows all commands except truly destructive ones
- **OAuth secret hardening** — Google OAuth secrets support env override
- **ZIP-bomb protection** — bundle reader tracks actual decompressed bytes
- **Error handler shell-escape** — filenames in error suggestions properly shell-escaped

### ⚡ Fast Streaming (OpenCode-Style)

Huagent v6.5 uses **direct streaming with tools** — no planning/critic/reflection overhead:

| | Before (v5) | After (v6.5) |
|---|---|---|
| **LLM calls per task** | 4-5 calls | 1 call |
| **System prompt** | ~2000 tokens | ~200 tokens |
| **Task classification** | LLM call (2-5s) | Regex (0ms) |
| **Planning** | Always on (5-10s) | Off by default |
| **Total latency** | 20-45s + tools | 5-15s + tools |

---

## 🌐 Providers

22 providers, 101 models. Each with a default model, full registry, and capability metadata.

| Category | Models |
|----------|--------|
| **Flagship** | Claude Opus 4.7, Claude Sonnet 4.6, GPT-5.5, Gemini 3 Pro, Grok 4 |
| **Reasoning** | DeepSeek R1, o3, QwQ 32B, Sonar Reasoning, Magistral Medium |
| **Fast** | Claude Haiku 4.5, GPT-5 mini, Llama 3.1 8B, Gemini 3 Flash |
| **Code** | Qwen 3 Coder 480B, Codestral 25, DeepSeek Coder V2, GPT-5.5 Codex |
| **Local (free)** | Ollama (Llama 3.2, Qwen 2.5 Coder 32B, DeepSeek R1 32B) |
| **Search** | Perplexity Sonar Pro |
| **Cloud** | AWS Bedrock, Google Vertex AI |

Browse in the TUI:

```bash
/providers              # all 22 providers
/models                 # models for current provider
/models anthropic       # models for a specific provider
```

### Auto-Detect

Set any of these env vars and huagent picks the provider automatically:

<details>
<summary>Click to expand all 22 environment variables</summary>

| Env var | Provider |
|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `MINIMAX_API_KEY` | MiniMax |
| `TOKENROUTER_API_KEY` | Custom (TokenRouter) |
| `GROQ_API_KEY` | Groq |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENROUTER_API_KEY` | OpenRouter |
| `GITHUB_TOKEN` | GitHub Copilot |
| `HF_TOKEN` | HuggingFace |
| `PERPLEXITY_API_KEY` | Perplexity |
| `TOGETHER_API_KEY` | Together AI |
| `FIREWORKS_API_KEY` | Fireworks AI |
| `CEREBRAS_API_KEY` | Cerebras |
| `XAI_API_KEY` | xAI Grok |
| `MISTRAL_API_KEY` | Mistral |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `OPENCODE_API_KEY` | OpenCode Zen |
| `CODEX_API_KEY` | OpenAI Codex |
| `MIMO_API_KEY` | Xiaomi MiMo |
| `AWS_BEARER_TOKEN_BEDROCK` | AWS Bedrock |
| `GOOGLE_APPLICATION_CREDENTIALS` | Google Vertex AI |

</details>

---

## 🛠️ Usage

### Three Modes

```bash
# 1. TUI mode (default) — full interactive terminal UI
huagent

# 2. One-shot mode — single command with tool support
huagent "read package.json and install lodash"

# 3. REPL mode — minimal interactive prompt
huagent --no-tui
```

### Slash Commands

| Command | What it does |
|---------|-------------|
| `/model <name>` | Switch LLM model |
| `/provider <name>` | Switch provider |
| `/models` | Browse all 101 models |
| `/providers` | List all 22 providers |
| `/autonomous` | Toggle autonomous mode |
| `/scope <file>` | Limit edits to one file |
| `/permissions <mode>` | Switch permission mode |
| `/memory` | Inspect knowledge base |
| `/skills` | List installed skills |
| `/status` | Session status + stats |
| `/cost` | Token usage + cost breakdown |
| `/sessions` | List saved sessions |
| `/resume <id>` | Resume a session |
| `/diff` | Show git diff |
| `/doctor` | Run diagnostics |
| `/clear` | Fresh session |
| `/help` | Show all commands |
| `/exit` | Exit huagent |

### CLI Flags

```bash
huagent                                              # interactive TUI
huagent "fix the auth bug"                           # one-shot mode (with tools!)
huagent --no-tui                                     # REPL mode (with tools!)
huagent --provider anthropic --model claude-sonnet-4 # pick provider + model
huagent --autonomous                                 # no confirmations
huagent --scope src/auth.ts                          # limit to one file
huagent --permission-mode workspace-write            # leluasa (default)
```

### Permission Modes

| Mode | What you can do |
|------|----------------|
| `read-only` | Read files, no edits |
| `workspace-write` | Everything except `rm -rf /`, `mkfs`, `dd` (default, leluasa) |
| `danger-full-access` | Everything including destructive commands |
| `allow` | Auto-approve everything (autonomous) |

---

## 📊 By the Numbers

<div align="center">

| Metric | Value |
|--------|-------|
| **Version** | 6.5.1 |
| **LLM Providers** | 22 |
| **Models** | 101 |
| **Tests** | 239 passing |
| **Bug Fixes** | 100+ (10 critical security, 6 critical correctness) |
| **Source Files** | 130+ TS/TSX |
| **Slash Commands** | 26 |
| **Permission Modes** | 4 |
| **Memory Systems** | 5 |
| **TUI Components** | 20+ |
| **Keyboard Shortcuts** | 20+ |
| **Lines of Code** | 25,000+ |

</div>

---

## 🧪 Testing

```bash
npm test              # run all 239 tests
npm run verify        # lint + test + build
```

| Suite | Tests | What it covers |
|-------|:-----:|----------------|
| Provider integrity | 350 | 22 providers, 101 models, pricing, auto-detect |
| TUI stress | 153 | Visual regression, 40–240 cols, unicode, edge cases |
| Discipline | 181 | Plan → Ground → Observe → Diagnose → Verify |
| TUI v4 | 119 | Theme, activity store, status bar, slash commands |
| CLI commands | 68 | All 26 slash commands, option parsing |
| WllmConcept | 26 | WikiMemory, 5-memory routing, lint, evolve |
| Auto-Ingest | 25 | Content analyzer, file watcher, page creation |
| OpenCode TUI | 52 | Theme, borders, MessageList, Prompt, Picker, Dialog |
| Keyboard | 16 | Enter, Esc, Tab, Ctrl+C/U/W, Alt+Enter, arrows |
| App shortcuts | 8 | Ctrl+P/T/E/L, ?, stats, footer |
| Security | 25 | SSRF, path traversal, LRU, dialog reset, limit:0 |
| Render | 23 | MessageList, Footer, Dialog, Picker rendering |

---

## 🏗️ Architecture

```
src/
├── cli.tsx                   # entry point — TUI / one-shot / REPL modes
│
├── providers/                # 22-provider abstraction layer
│   ├── registry.ts           # provider registry + auto-detect
│   ├── models.ts             # 101-model catalog with pricing
│   ├── client.ts             # unified streaming client (Anthropic + OpenAI)
│   ├── pricing.ts            # cost calculation engine
│   └── executors/            # provider-specific executors
│
├── engine/                   # AI engine core
│   ├── core.ts               # main engine loop + streamAgenticChat
│   ├── wiki-memory.ts        # backward-compatible wiki memory wrapper
│   └── v4/                   # stream-native actor model
│       ├── discipline/       # Plan → Ground → Observe → Diagnose → Verify
│       ├── stream/           # SSE pipeline + cognitive events
│       ├── actor/            # actor model + supervisor
│       └── graph/            # SQLite-backed graph store
│
├── tui/                      # terminal user interface
│   ├── OpenCodeApp.tsx       # production TUI (OpenCode-inspired)
│   └── oc/                   # OpenCode-style components
│       ├── theme.ts          # 12-step grayscale + semantic palette
│       ├── border.ts         # SplitBorder, LeftBorder, TopBorder
│       ├── MessageList.tsx   # chat history with inline tool cards
│       ├── Prompt.tsx        # left-border textarea + autocomplete
│       ├── Footer.tsx        # status bar (directory, LSP, MCP)
│       ├── Dialog.tsx        # modal dialogs (confirm, alert, help)
│       └── Picker.tsx        # fuzzy-searchable list dialog
│
├── wllm/                     # wiki knowledge engine
│   ├── graph/                # WikiStore (bi-temporal property graph)
│   ├── ingest/               # content analyzer + auto-ingest
│   ├── lint/                 # quality audit (7 checks, A–F grade)
│   ├── evolve/               # self-reflection engine
│   └── query/                # intent-based search + 5-memory routing
│
├── tools/                    # built-in tools
│   ├── bash.ts               # execute shell commands (60s timeout)
│   ├── read.ts               # read files with line numbers
│   ├── write.ts              # write files (auto-mkdir)
│   ├── edit.ts               # find-and-replace (with error hints)
│   ├── grep.ts               # ripgrep search (execFile, no injection)
│   ├── search.ts             # glob file search
│   ├── web.ts                # fetch URLs (SSRF-protected)
│   └── memory.ts             # save/recall memories
│
├── memory/                   # SQLite-backed session memory
├── sessions.ts               # session save/load/resume
├── permissions.ts            # 4 permission modes (workspace-write = leluasa)
└── slash-commands.ts         # 26 runtime commands
```

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [User Guide](docs/USER_GUIDE.md) | Getting started, configuration, daily usage |
| [Architecture](docs/ARCHITECTURE.md) | System design, engine internals, TUI layout |
| [API Reference](docs/API_REFERENCE.md) | Full API documentation for all modules |
| [WllmConcept](docs/WLLMCONCEPT_GUIDE.md) | Wiki knowledge engine deep-dive |
| [Auto-Ingest](docs/AUTO_INGEST_GUIDE.md) | File watcher + content analysis |
| [Contributing](.github/CONTRIBUTING.md) | How to contribute to Huagent |
| [Security](SECURITY.md) | Vulnerability reporting + threat model |
| [Changelog](CHANGELOG.md) | Release history (v1.0 → v6.5) |

---

## 🤝 Contributing

Bug reports and feature requests welcome via [issues](https://github.com/ahmdd4vd/Huagent/issues).

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup and guidelines.

### Quick Start for Contributors

```bash
git clone https://github.com/ahmdd4vd/Huagent.git
cd Huagent
npm install
npm run dev           # watch mode (auto-rebuild on save)
npm test              # run all 239 tests
npm run verify        # lint + test + build (must pass before PR)
```

---

## 🔒 Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy and threat model.

**Don't open a public issue for security bugs.** Use GitHub's private vulnerability reporting:
https://github.com/ahmdd4vd/Huagent/security/advisories/new

---

## 📦 Publishing (Maintainers)

```bash
# 1. Update version in package.json
# 2. Update CHANGELOG.md
# 3. Run verify
npm run verify

# 4. Publish to npm
npm publish --access public

# 5. Tag and push (CI auto-publishes on v* tags)
git tag v6.5.1
git push origin main
git push origin v6.5.1
```

---

## 📈 Changelog

| Version | Date | Highlights |
|---------|------|-----------|
| **v6.5.1** | 2026-06-17 | REPL streaming, TUI error recovery, tool null checks |
| **v6.5.0** | 2026-06-17 | One-shot tool support, edit tool better errors, bash timeout 60s |
| **v6.4.1** | 2026-06-17 | Tool result 500→5000 chars, Anthropic tools, hooks non-blocking |
| **v6.4.0** | 2026-06-17 | Tool call history properly sent to LLM (root cause fix) |
| **v6.3.1** | 2026-06-17 | Workspace-write = leluasa (allow all commands) |
| **v6.3.0** | 2026-06-17 | Tools actually sent to LLM + permissions fixed |
| **v6.2.0** | 2026-06-17 | OpenCode-style inline streaming + tool cards |
| **v6.1.0** | 2026-06-17 | Direct streaming (5x faster, no planning overhead) |
| **v6.0.0** | 2026-06-17 | OpenCode TUI overhaul + 72 bug fixes + security hardening |
| **v5.0.0** | 2026-06-15 | WllmConcept integration + TUI polish + UX polish |
| **v4.0.0** | 2026-06-15 | 22 providers, 101 models, rebrand to Huagent |

Full changelog: [CHANGELOG.md](CHANGELOG.md)

---

<div align="center">

**[MIT](LICENSE)** © 2026 **Huanime**

Built with [Ink](https://github.com/vadimdemedes/ink) · Inspired by [OpenCode](https://github.com/anomalyco/opencode)

<sub>The AI coding agent that lives in your terminal.</sub>

</div>
