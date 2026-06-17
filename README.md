<div align="center">

<img src="https://img.shields.io/badge/Huagent-v5.0.0-FF6B9D?style=for-the-badge&logo=typescript&logoColor=white" />

# Huagent

### The AI Coding Agent That Learns

*A production-grade AI coding agent in your terminal — powered by a wiki knowledge engine, modern TUI, and 22 LLM providers.*

[![npm](https://img.shields.io/npm/v/huagent?style=flat-square&logo=npm&logoColor=white&color=FF6B9D)](https://www.npmjs.com/package/huagent)
[![Downloads](https://img.shields.io/npm/dm/huagent?style=flat-square&logo=npm&logoColor=white&color=C589E8)](https://www.npmjs.com/package/huagent)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-FFC75F?style=flat-square)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-900%2B-7BC74D?style=flat-square)](#testing)
[![Providers](https://img.shields.io/badge/providers-22-87CEEB?style=flat-square)](#providers)
[![Models](https://img.shields.io/badge/models-101-FFB7C5?style=flat-square)](#providers)

[Install](#-install) • [Features](#-features) • [Providers](#-providers) • [Docs](#-documentation) • [Contributing](#-contributing)

</div>

---

## 🖥️ Preview

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  huagent v5.0                                                                │
│  ● autonomous off  ● scope none  ○ perm workspace-write     claude-sonnet-4 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  > add jwt auth to our express app, replace the old session thing            │
│                                                                              │
│  ✓ PLAN   add jwt auth to our express app                 1.0s               │
│  ✓ READ   src/middleware/auth.ts                          0.8s               │
│  ✓ WRITE  src/middleware/jwt.ts                           2.0s               │
│  ✓ TEST   src/middleware/jwt.ts: 12/12 passed             2.3s               │
│                                                                              │
│  ┌─ Diff: src/middleware/jwt.ts ──────────────────────────────────┐          │
│  │  42  42   function validateToken(token: string): boolean {     │          │
│  │  43     -   return jwt.verify(token, secret);                  │          │
│  │      43 +   try { jwt.verify(token, secret); return true; }    │          │
│  │      44 +   catch (e) { return false; }                        │          │
│  └────────────────────────────────────────────────────────────────┘          │
│                                                                              │
│  [█████████████████████████] 100% (4/4 steps) ✓                              │
│  Elapsed: 6.1s │ Tokens: 4.2k │ Cost: $0.0127                               │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

---

## ⚡ Install

```bash
# One-liner (recommended)
curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh

# npm
npm install -g huagent

# From source
git clone https://github.com/ahmdd4vd/Huagent.git && cd Huagent
npm install && npm run build && node bin/huagent.js
```

### Quick Start

```bash
export ANTHROPIC_API_KEY=***   # or any provider key
huagent
```

---

## ✨ Features

<div align="center">

| | | |
|:---:|:---:|:---:|
| 🧠 **Wiki Knowledge Engine** | 🔄 **Auto-Ingest** | 🧬 **Self-Evolution** |
| 5-memory system that learns from your codebase | Watches files & auto-creates wiki pages | Finds contradictions & suggests improvements |
| 🔍 **Smart Autocomplete** | 🎨 **Syntax Highlighting** | 📊 **Progress Tracking** |
| Fuzzy matching with context-aware suggestions | Auto-detect language, themed colors | Real-time bar, ETA, token count, cost |
| 🔗 **Clickable Paths** | ❌ **Smart Errors** | 📁 **File Tree** |
| Terminal hyperlinks, auto-open in editor | User-friendly messages with actionable fixes | Interactive tree with icons & metadata |

</div>

### 🧠 WllmConcept — Knowledge That Grows

Huagent ships with a **wiki knowledge engine** that makes your agent smarter over time.

```
┌─────────────────────────────────────────────────────────┐
│                  5-Memory System                         │
│                                                         │
│   Semantic ──── Facts, concepts, entities               │
│   Episodic ──── Events, debugging sessions              │
│   Structural ─── Architecture, dependencies             │
│   Causal ────── Decisions, tradeoffs, migrations        │
│   Meta ──────── Self-reflection, heuristics             │
│                                                         │
│   Confidence: ASSUMED → INFERRED → VERIFIED             │
│   Freshness:  LOW → MEDIUM → HIGH → STALE               │
└─────────────────────────────────────────────────────────┘
```

- **Auto-Ingest** — File watcher extracts functions, classes, patterns, and relationships automatically
- **Scheduled Lint** — 7 quality checks with A–F grading and auto-fix
- **Evolve** — Detects contradictions, suggests new pages, refreshes stale knowledge at session end
- **Intent-Based Routing** — "what is", "how to", "why", "when", "compare", "pattern", "history"

### 🎨 Modern TUI

- **Syntax Highlighting** — Code blocks with auto-detected language (TS, JS, Python, Rust, Go, Bash, JSON)
- **Diff View** — Line-by-line diffs with color-coded changes (`+` green, `-` red, context gray)
- **File Tree** — Interactive tree with 📁/📄 icons, file metadata, expandable directories
- **Progress Indicators** — Visual progress bar, step count, ETA, elapsed time, tokens, cost

### 🎯 UX Polish

- **Smart Errors** — Errors are classified (permission, file-not-found, syntax, network, API, config) with actionable copy-paste suggestions
- **Fuzzy Autocomplete** — Type `/mod` and get `/model`, `/models`, `/modes` ranked by relevance
- **Clickable Paths** — File paths are terminal hyperlinks (OSC 8) that auto-open in your editor
- **Enhanced Loading** — Progress bar + current step + ETA + action buttons (Cancel, Details, Background)

### ⚙️ Engine

- **22 LLM providers** out of the box, 101 models with pricing + capabilities
- **Stream-native** — Type-safe SSE, automatic tool-call accumulation, accurate cost tracking
- **Discipline layer** — Every task: Plan → Ground → Observe → Diagnose → Verify
- **26 slash commands** — Full runtime control over model, provider, mode, scope, memory
- **5 permission modes** — read-only, workspace-write, sandboxed, danger-full-access, custom
- **Auto-detect** — Set an env var, huagent figures out the provider
- **MIT licensed** — Free forever

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

## 📊 By the Numbers

<div align="center">

| Metric | Value |
|--------|-------|
| **LLM Providers** | 22 |
| **Models** | 101 |
| **Tests** | 900+ |
| **Source Files** | 115+ |
| **Slash Commands** | 26 |
| **Permission Modes** | 5 |
| **Memory Systems** | 5 |
| **TUI Components** | 12 |
| **Documentation** | 5,600+ lines |
| **Lines of Code** | 22,000+ |

</div>

---

## 🧪 Testing

```bash
npm test              # run all tests
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
| Auto-Ingest | 40 | Content analyzer, file watcher, page creation |
| TUI polish | 40 | Syntax highlighting, diff view, file tree, progress |
| UX polish | 40 | Error handler, autocomplete, clickable paths, loading |

---

## 🏗️ Architecture

```
src/
├── cli.tsx                   # entry point, bootstrap, arg parsing
│
├── providers/                # 22-provider abstraction layer
│   ├── registry.ts           # provider registry + auto-detect
│   ├── models.ts             # 101-model catalog with pricing
│   ├── client.ts             # unified streaming client
│   ├── capabilities.ts       # model capability metadata
│   ├── pricing.ts            # cost calculation engine
│   └── executors/            # provider-specific executors
│
├── engine/                   # AI engine core
│   ├── core.ts               # main engine loop + WikiStore integration
│   ├── wiki-memory.ts        # backward-compatible wiki memory wrapper
│   └── v4/                   # stream-native actor model
│       ├── discipline/       # Plan → Ground → Observe → Diagnose → Verify
│       ├── stream/           # SSE pipeline + cognitive events
│       ├── actor/            # actor model + supervisor
│       ├── htn/              # hierarchical task network planner
│       └── graph/            # SQLite-backed graph store
│
├── tui/                      # terminal user interface
│   ├── ModernApp.tsx         # production TUI (use this)
│   ├── new-layout.tsx        # responsive layout system
│   ├── syntax-highlighter.tsx # code syntax highlighting
│   ├── diff-view.tsx         # line-by-line diff rendering
│   ├── file-tree.tsx         # interactive file tree
│   ├── progress-indicator.tsx # progress bars + ETA
│   ├── error-handler.tsx     # user-friendly error messages
│   ├── smart-autocomplete.tsx # fuzzy command/file completion
│   ├── clickable-files.tsx   # terminal hyperlinks
│   └── loading-states.tsx    # enhanced loading UI
│
├── wllm/                     # wiki knowledge engine
│   ├── graph/                # WikiStore (bi-temporal property graph)
│   ├── ingest/               # content analyzer + auto-ingest
│   ├── lint/                 # quality audit (7 checks, A–F grade)
│   ├── evolve/               # self-reflection engine
│   └── query/                # intent-based search + 5-memory routing
│
├── tools/                    # built-in tools (bash, file ops, search, git)
├── memory/                   # SQLite-backed session memory
├── sessions.ts               # session save/load/resume
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
| [TUI Polish](docs/PHASE3_TUI_POLISH_GUIDE.md) | Syntax highlighting, diff view, file tree |
| [UX Polish](docs/PHASE4_UX_POLISH_GUIDE.md) | Error messages, autocomplete, loading states |
| [Contributing](.github/CONTRIBUTING.md) | How to contribute to Huagent |

---

## 🛠️ Usage

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

### CLI Flags

```bash
huagent                                              # interactive TUI
huagent "fix the auth bug"                           # one-shot mode
huagent --provider anthropic --model claude-sonnet-4-6  # pick provider + model
huagent --autonomous                                 # no confirmations
huagent --scope src/auth.ts                          # limit to one file
huagent --permission-mode sandboxed                   # sandboxed edits
```

### Permission Modes

| Mode | What you can do |
|------|----------------|
| `read-only` | Read files, no edits |
| `workspace-write` | Edit project files (default) |
| `sandboxed` | Edits go to a temp directory |
| `danger-full-access` | No confirmations at all |
| `custom` | Your own ruleset |

---

## 🤝 Contributing

Bug reports and feature requests welcome via [issues](https://github.com/ahmdd4vd/Huagent/issues).

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup and guidelines.

---

## 🔒 Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy and threat model.

---

<div align="center">

**[MIT](LICENSE)** © 2026 **Huanime**

Built with [Ink](https://github.com/vadimdemedes/ink) • Inspired by [claw-code](https://github.com/ultraworkers/claw-code), [OpenClaude](https://github.com/Gitlawb/openclaude), and [ECC](https://github.com/affaan-m/ECC)

<sub>The AI coding agent that learns from your codebase.</sub>

</div>
