# ✦ huagent v4.0.0 "HuaEngine"

> **The cutest, smartest, most production-ready AI coding agent in your terminal** ✧

An anime-powered AI coding agent CLI by **huanime**. 22 LLM providers. 101 models. WllmConcept wiki engine. Discipline layer. Modern TUI. MIT-licensed. Free forever.

```
╭──────────────────────────────────────────────────────────────╮
│  ✦ huagent v4.0.0 ✦  HuaEngine                              │
│  the cutest, smartest coding agent — in your terminal       │
│  by huanime ✦ anime-powered AI                               │
╰──────────────────────────────────────────────────────────────╯

         ✦
        /\\     ♡
       /  \\   /
      / ✦  \\ / ✧
     /______\\
    /  ◕   ◕  \\      Hua
   /     ▽      \\   "Code is
  /_____________\\    my magic!"

  ✧･ﾟ: *✧･ﾟ:*  Halo senpai!  *:･ﾟ✧*:･ﾟ✧
  Hua di sini! ✦ Magical coding companion-mu siap membantu hari ini.
```

[![npm](https://img.shields.io/npm/v/huagent.svg)](https://www.npmjs.com/package/huagent)
[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-18%2B-lavender.svg)](https://nodejs.org)
[![Providers: 22](https://img.shields.io/badge/providers-22-gold.svg)](#-supported-providers)
[![Models: 101](https://img.shields.io/badge/models-101-sakura.svg)](#-supported-providers)
[![Tests: 870+](https://img.shields.io/badge/tests-870%2B-success.svg)](#-testing)

---

## ✨ Features

- **22 LLM providers** out of the box — Anthropic, OpenAI, Gemini, Mistral, GitHub Copilot, AWS Bedrock, Google Vertex, NVIDIA NIM, MiniMax, xAI Grok, Ollama, OpenCode Zen, Codex, Xiaomi MiMo, Groq, Cerebras, DeepSeek, OpenRouter, Together, Fireworks, Perplexity, HuggingFace
- **101+ models** with full pricing, capabilities, and tier classification (flagship, fast, reasoning, code, local, legacy)
- **WllmConcept** — wiki knowledge engine with semantic search, evolution tracking, and provenance
- **Discipline layer** — Plan → Ground → Observe → Diagnose → Verify cycle for every task
- **Modern TUI v4** — width-adaptive, no-emoji, modern palette, live activity feed, subagent panel, toasts
- **26 slash commands** — `/help`, `/model`, `/models`, `/provider`, `/providers`, `/modes`, `/agents`, `/marketplace`, `/scope`, `/autonomous`, etc.
- **5 permission modes** — read-only, workspace-write, sandboxed, danger-full-access, custom
- **Streaming everything** — type-safe SSE for all providers, automatic tool-call accumulation, cost tracking
- **Zero-config** — just set an API key, huagent detects the provider automatically
- **Anime aesthetic** — sakura pink, lavender, gold theme, custom mascots

## 🚀 Quick Start

### Option 1: curl one-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/d4vdxm/huagent/main/install.sh | sh
```

### Option 2: npm

```bash
npm install -g huagent
```

### Option 3: from source

```bash
git clone https://github.com/d4vdxm/huagent.git
cd huagent
npm install
npm run build
node bin/huagent.js
```

### First run

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # or any other provider's key
huagent
```

huagent auto-detects your provider from the first matching env var:

| Env var | Provider |
|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `MINIMAX_API_KEY` | MiniMax |
| `TOKENROUTER_API_KEY` | Custom (TokenRouter) |
| `GROQ_API_KEY` | Groq (ultra-fast) |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENROUTER_API_KEY` | OpenRouter |
| `GITHUB_TOKEN` | GitHub Copilot |
| ... 12 more | See [Supported Providers](#-supported-providers) |

## 🌸 Supported Providers

huagent ships with **22 providers** and **101 models** baked in. Run `/providers` in the TUI to see them all, or browse with `/models <provider>`.

### Anthropic (claude)
- Claude Opus 4.7 / 4.6 / 4.5 — flagship, 200k ctx, tool calls + vision + reasoning
- Claude Sonnet 4.6 / 4.5 / 4.0 — flagship, 200k ctx, full features
- Claude Haiku 4.5 — fast, 200k ctx
- Claude 3.5 Sonnet/Haiku, Claude 3 Opus — legacy (deprecated)

### OpenAI
- GPT-5.5 / GPT-5 — flagship, 400k ctx, reasoning
- GPT-5 mini — fast, 200k ctx
- GPT-4o / GPT-4o mini — flagship/fast, 128k ctx, vision
- o3 / o3-mini / o4-mini — reasoning tier
- GPT-4 Turbo — legacy

### Google
- Gemini 3 Pro / 3 Flash (preview) — flagship/fast, up to 2M ctx
- Gemini 2.5 Pro / 2.5 Flash — flagship/fast, 2M ctx

### Fast inference
- **Groq** — Llama 3.3 70B Versatile, Llama 3.1 8B Instant, Mixtral 8x7B, DeepSeek R1 distill
- **Cerebras** — Llama 3.3 70B, Llama 3.1 8B (ultra-fast)

### Reasoning
- **DeepSeek** — V3, R1, Coder V2
- **Together AI** — Llama 3.3 70B, Qwen 2.5 Coder, DeepSeek R1
- **Fireworks** — Llama 3.3 70B, DeepSeek R1, Qwen 2.5 Coder
- **OpenRouter** — gateway to all major providers

### Local
- **Ollama** — Llama 3.2, Qwen 2.5 Coder 32B, DeepSeek R1 32B (free, runs on your machine)

### Specialty
- **Perplexity** — Sonar Pro / Sonar / Sonar Reasoning (search-augmented)
- **HuggingFace** — Llama 3.3 70B, Mistral 7B (free tier)
- **OpenCode Zen** — Qwen 3 Coder, GPT-5, Claude Sonnet 4.6
- **Codex (ChatGPT)** — GPT-5.5 Codex, o3

### Cloud
- **AWS Bedrock** — Claude 4.7, Claude 4.6, Amazon Nova Pro/Lite, Llama 3.3 70B
- **Google Vertex AI** — Claude 4.6, Gemini 3 Pro, Gemini 2.5 Pro

### Other
- **GitHub Copilot** — GPT-5.5, Claude 4.6, Gemini 3 Pro, o3 (free for Copilot subs)
- **MiniMax** — MiniMax-M3, MiniMax Text 01
- **xAI Grok** — Grok 4, Grok 3, Grok 3 mini
- **Xiaomi MiMo** — MiMo v2.5 Pro, MiMo v2
- **NVIDIA NIM** — Llama 3.1 70B/405B, Qwen 3, QwQ 32B, DeepSeek R1, Codestral
- **Custom (TokenRouter)** — proxy to MiniMax-M3 with unified API

## 🎯 Usage

### Interactive mode

```bash
huagent
```

The TUI opens with:
- Compact header (provider, model, mode chips, scope)
- Live activity feed (read, write, edit, bash, subagent, verify)
- Subagent panel (running + recent)
- Status bar (tokens, cost, requests, permission mode)
- Toasts (success, info, warning, error)
- Prompt with autocomplete

### Slash commands (26 total)

```bash
/help            show all commands
/model <name>    switch model
/models          list all models for current provider
/models <id>     list models for a specific provider
/provider <id>   switch LLM provider
/providers       list all 22 providers
/modes           show current modes
/autonomous      toggle autonomous (no confirmations)
/scope <file>    limit edits to one file
/permissions     switch permission mode
/memory          inspect loaded memory
/skills          list installed skills
/init            create starter HUAAGENT.md
/agents          list subagent types
/marketplace     browse, search, install wiki bundles
/doctor          run diagnostic checks
/status          show session status
/cost            show token usage
/clear           fresh local session
/compact         compact local history
/sessions        list saved sessions
/resume <id>     load a saved session
/export <file>   export conversation
/diff            show git diff
/undo            show how to undo last edit
/theme           show or switch color theme
/version         show CLI version
/exit            exit huagent
```

### Permission modes

- `read-only` — no edits, no commands
- `workspace-write` — edit project files
- `sandboxed` — edits go to a temp dir
- `danger-full-access` — no confirmations
- `custom` — user-defined ruleset

Switch with `/permissions <mode>` or `huagent --permission-mode <mode>`.

### Flags

```bash
huagent --help
huagent --provider anthropic --model claude-sonnet-4-6
huagent --autonomous           # start in autonomous mode
huagent --scope src/auth.ts    # limit to one file
huagent --permission-mode sandboxed
huagent --tui=modern           # default TUI
huagent --tui=legacy           # original TUI
huagent --version
```

## 🏯 WllmConcept — wiki engine

huagent includes a wiki knowledge engine that:
- ingests markdown/text/URL bundles
- extracts semantic + structural data
- builds a queryable graph
- evolves via lint + improvement cycles
- tracks provenance for every fact

```bash
huagent wiki import ./docs
huagent wiki search "jwt auth"
huagent wiki evolve --all
huagent wiki lint
```

Browse and install community bundles with `/marketplace`.

## 🎌 Discipline layer

Every task goes through a 5-beat cycle:

1. **Plan** — decompose the task into steps
2. **Ground** — gather context (files, memories, skills)
3. **Observe** — execute the plan, track state
4. **Diagnose** — detect failures, propose fixes
5. **Verify** — run tests, capture evidence

If a beat fails, huagent retries with more context. No silent failures.

## 🎨 TUI design

huagent v4 TUI is width-adaptive and works at any terminal width (40–240+ cols). The aesthetic is **modern anime**: sakura pink, lavender, gold, with a custom mascot (Hua).

```
 huagent ·                                                                     MiniMax-M3
 ○ autonomous off  ● scope src/middleware/jwt.ts  ○ perm workspace-write  ○ model MiniMax-M3
 ──────────────────────────────────────────────────────────────────────────────

 ❯ add jwt auth to our express app, replace the old session thing
 ✧ Got it. Let me first scope the existing auth, then design a JWT middleware

 ✓ PLAN   add jwt auth to our express app  02:38:10    1.0s
 ✓ READ   src/middleware/auth.ts          02:38:13   800ms
 ✓ WRITE  src/middleware/jwt.ts           02:38:19    2.0s
 ✓ TEST   src/middleware/jwt.ts: passed   02:38:35    2.3s

 ╭─ subagents (1 running) ─╮  ╭─ ✓ Tests passed: 12/12 in 2.3s ─╮
 │ ⠋ reviewer  Check ... 65%│  ╰───────────────────────────────╯
 ╰─────────────────────────╯

 ╭─ v4 │ tok 4.2k ($0.0127) │ steps 8 │ perm workspace-write  ctrl+l... ─╮
 ╰───────────────────────────────────────────────────────────────────────╯
```

## 🧪 Testing

870+ tests across 5 test suites, all passing:

```bash
npm test
```

| Suite | Tests | Covers |
|-------|-------|--------|
| `tests/tui-v4.test.ts` | 119 | theme, activity-store, status, activity-feed, slash commands |
| `tests/discipline.test.ts` | 181 | plan/ground/observe/diagnose/verify cycle |
| `tests/cli-commands.test.ts` | 68 | parseOptions, /provider, /model, /scope, /autonomous, /models, /providers |
| `tests/test-tui-stress.ts` | 153 | visual regression at 40-240 cols, 1000+ activities, unicode, special chars |
| `tests/test-providers.ts` | 350 | 22-provider integrity, 101-model pricing/capabilities, auto-detect, chat URLs |

## 🛠 Development

```bash
git clone https://github.com/d4vdxm/huagent.git
cd huagent
npm install
npm run dev         # watch mode
npm test            # full test suite
npm run verify      # lint + test + build
npm run build       # produce dist/
```

Project layout:

```
huagent/
├── bin/huagent.js          # CLI entry point
├── src/
│   ├── cli.tsx             # CLI args + bootstrap
│   ├── engine/             # v4 runner, actor, discipline, graph
│   ├── providers/          # 22-provider registry + 101-model list
│   ├── tui/                # Modern TUI v4 (theme, activity store, status, etc.)
│   ├── tools/              # file ops, bash, git, search
│   ├── memory/             # SQLite-backed memory
│   ├── wllm/               # wiki concept engine
│   ├── sessions.ts         # session save/load
│   ├── slash-commands.ts   # 26 slash commands
│   └── ...
├── tests/                  # 870+ tests
├── docs/                   # design docs
├── install.sh              # curl | bash installer
└── package.json
```

## 📜 License

MIT — see [LICENSE](LICENSE).

## 🙏 Credits

Inspired by:
- [claw-code](https://github.com/ultraworkers/claw-code) — Rust CLI patterns
- [OpenClaude](https://github.com/Gitlawb/openclaude) — provider architecture
- [ECC](https://github.com/affaan-m/ECC) — every-claude-code
- [opencode](https://github.com/anomalyco/opencode) — modern TUI design

Built with [Ink](https://github.com/vadimdemedes/ink) (React for CLIs).

---

✧･ﾟ: *✧･ﾟ:*  Made with ♡ by huanime  *:･ﾟ✧*:･ﾟ✧
