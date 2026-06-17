# Huagent

> AI coding agent CLI by Huanime. 22 LLM providers, 101 models, MIT-licensed.

[![npm](https://img.shields.io/npm/v/huagent?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/huagent)
[![Downloads](https://img.shields.io/npm/dm/huagent?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/huagent)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-FF6B9D?style=flat-square)](LICENSE)
[![Providers](https://img.shields.io/badge/providers-22-7B61FF?style=flat-square)](#providers)
[![Models](https://img.shields.io/badge/models-101-FFA500?style=flat-square)](#providers)
[![Tests](https://img.shields.io/badge/tests-900%2B-4CAF50?style=flat-square)](#testing)

A production-grade AI coding agent in your terminal. Stream-native engine, modern TUI, type-safe multi-provider abstraction. Built for developers who want Claude-Code-class capabilities with full provider flexibility.

```
huagent ·                                                                 claude-sonnet-4-6
 autonomous off  scope src/middleware/jwt.ts  perm workspace-write
──────────────────────────────────────────────────────────────────────────

> add jwt auth to our express app, replace the old session thing
✓ Got it. Let me first scope the existing auth, then design a JWT middleware

✓ PLAN    add jwt auth to our express app          1.0s
✓ READ    src/middleware/auth.ts                    0.8s
✓ WRITE   src/middleware/jwt.ts                     2.0s
✓ TEST    src/middleware/jwt.ts: passed             2.3s

╭─ subagents (1 running) ─╮  ╭─ Tests passed: 12/12 in 2.3s ─╮
│ reviewer   Check ... 65%│  ╰───────────────────────────────╯
╰─────────────────────────╯

╭─ v4 │ tok 4.2k ($0.0127) │ steps 8 │ perm workspace-write ─╮
╰─────────────────────────────────────────────────────────────╯
```

## Install

**One-liner** (recommended):

```bash
curl -fsSL https://raw.githubusercontent.com/ahmdd4vd/Huagent/main/install.sh | sh
```

**npm**:

```bash
npm install -g huagent
```

**From source**:

```bash
git clone https://github.com/ahmdd4vd/Huagent.git
cd Huagent
npm install
npm run build
node bin/huagent.js
```

## Quick start

```bash
export ANTHROPIC_API_KEY=***      # or any other provider
huagent
```

huagent auto-detects your provider from environment variables:

| Env var | Provider |
|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `MINIMAX_API_KEY` | MiniMax |
| `TOKENROUTER_API_KEY` | Custom (TokenRouter) |
| `GROQ_API_KEY` | Groq (ultra-fast inference) |
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

## Providers

22 LLM providers, 101 models. Each provider ships with a default model, full model registry, and capability metadata.

**Flagship**: Claude Opus 4.7, Claude Sonnet 4.6, GPT-5.5, Gemini 3 Pro, Grok 4, Llama 3.3 70B (via Groq/Cerebras/Together/Fireworks/OpenRouter)

**Reasoning**: DeepSeek R1, o3, QwQ 32B, Sonar Reasoning, Magistral Medium

**Fast**: Claude Haiku 4.5, GPT-5 mini, Llama 3.1 8B Instant, Gemini 3 Flash, Grok 3 mini

**Code**: Qwen 3 Coder 480B, Codestral 25, DeepSeek Coder V2, GPT-5.5 Codex

**Local (free)**: Ollama (Llama 3.2, Qwen 2.5 Coder 32B, DeepSeek R1 32B)

**Search-augmented**: Perplexity Sonar Pro

**Cloud**: AWS Bedrock (Claude 4.7, Nova Pro/Lite, Llama 3.3 70B), Google Vertex AI (Claude 4.6, Gemini 3 Pro)

Browse all in the TUI:

```bash
huagent             # then type:
/providers          # list all 22 providers
/models             # models for current provider
/models anthropic   # models for a specific provider
/models openai gpt-5.5  # switch model
```

## Features

- **22 LLM providers** out of the box, 101 models with pricing + capabilities
- **Stream-native engine** — type-safe SSE, automatic tool-call accumulation, accurate cost tracking
- **WllmConcept** — wiki knowledge engine with 5-memory system (semantic, episodic, structural, causal, meta)
- **Auto-Ingest** — file watcher that automatically extracts entities, concepts, and creates wiki pages
- **Scheduled Lint** — periodic wiki quality audit with 7 checks and auto-fix
- **Evolve** — self-reflection engine that finds contradictions, suggests new pages, and refreshes stale knowledge
- **Modern TUI** — width-adaptive (40–240+ cols), syntax highlighting, diff view, file tree, progress indicators
- **UX Polish** — user-friendly error messages, smart autocomplete, clickable file paths, enhanced loading states
- **Discipline layer** — every task goes through Plan → Ground → Observe → Diagnose → Verify
- **26 slash commands** — full runtime control over model, provider, mode, scope, memory
- **5 permission modes** — read-only, workspace-write, sandboxed, danger-full-access, custom
- **Auto-detect** — set an env var, huagent figures out the provider
- **MIT licensed** — free forever

## Usage

### Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch model |
| `/models` | List models for current provider |
| `/models <provider>` | List models for a specific provider |
| `/provider <name>` | Switch LLM provider |
| `/providers` | List all 22 providers |
| `/autonomous` | Toggle autonomous mode (no confirmations) |
| `/scope <file>` | Limit edits to one file |
| `/permissions <mode>` | Switch permission mode |
| `/modes` | Show all current modes |
| `/memory` | Inspect loaded memory |
| `/skills` | List installed skills |
| `/agents` | List subagent types |
| `/marketplace` | Browse wiki bundles |
| `/init` | Create starter HUAAGENT.md |
| `/status` | Show session status |
| `/cost` | Show token usage + cost |
| `/doctor` | Run diagnostic checks |
| `/sessions` | List saved sessions |
| `/resume <id>` | Load a saved session |
| `/export <file>` | Export conversation |
| `/diff` | Show git diff |
| `/undo` | Show how to undo last edit |
| `/theme` | Show or switch theme |
| `/clear` | Fresh local session |
| `/exit` | Exit huagent |

### Permission modes

| Mode | Behavior |
|------|----------|
| `read-only` | No edits, no commands |
| `workspace-write` | Edit project files only (default) |
| `sandboxed` | Edits go to a temp dir |
| `danger-full-access` | No confirmations |
| `custom` | User-defined ruleset |

### Flags

```bash
huagent                                            # interactive TUI
huagent "fix the auth bug"                         # one-shot, no TUI
huagent --provider anthropic --model claude-sonnet-4-6
huagent --autonomous                               # start in autonomous mode
huagent --scope src/auth.ts                        # limit to one file
huagent --permission-mode sandboxed
huagent --tui=modern                               # default TUI
huagent --tui=legacy                               # original TUI
huagent --version
```

## Testing

900+ tests across 8 suites:

```bash
npm test
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| `tests/test-providers.ts` | 350 | 22-provider integrity, 101-model pricing, auto-detect, cross-provider |
| `tests/test-tui-stress.ts` | 153 | Visual regression at 40–240 cols, 1000+ activities, unicode, edge cases |
| `tests/tui-v4.test.ts` | 119 | Theme, activity store, status, activity feed, slash commands |
| `tests/discipline.test.ts` | 181 | Plan/Ground/Observe/Diagnose/Verify cycle |
| `tests/cli-commands.test.ts` | 68 | parseOptions, all 26 slash commands |
| `tests/wllm-integration.test.ts` | 26 | WikiMemory, 5-memory routing, lint, evolve |
| `tests/auto-ingest.test.ts` | 40 | Content analyzer, file watcher, auto page creation |
| `tests/tui-polish.test.ts` | 40 | Syntax highlighting, diff view, file tree, progress |
| `tests/ux-polish.test.ts` | 40 | Error handler, autocomplete, clickable paths, loading |

```bash
npm run verify     # lint + test + build
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a high-level map of the codebase.

```
src/
├── cli.tsx              # entry point, arg parsing, bootstrap
├── providers/           # 22-provider registry, 101-model list, unified client
├── engine/v4/           # stream-native actor model, discipline layer
├── tui/                 # modern TUI with syntax highlighting, diff view, progress
├── tools/               # bash, file ops, git, search
├── memory/              # SQLite-backed memory
├── wllm/                # wiki concept engine (5-memory system)
│   ├── graph/           # WikiStore (bi-temporal property graph)
│   ├── ingest/          # content analyzer + auto-ingest service
│   ├── lint/            # scheduled lint (7 checks, A-F grading)
│   └── evolve/          # self-reflection (contradictions, suggestions, refresh)
├── sessions.ts          # session save/load
└── slash-commands.ts    # 26 slash commands
```

## Documentation

- [User Guide](docs/USER_GUIDE.md) — Getting started, configuration, usage
- [Architecture](docs/ARCHITECTURE.md) — System design, engine, TUI
- [Contributing](.github/CONTRIBUTING.md) — How to contribute
- [API Reference](docs/API_REFERENCE.md) — Full API documentation
- [WllmConcept Guide](docs/WLLMCONCEPT_GUIDE.md) — Wiki knowledge engine
- [Auto-Ingest Guide](docs/AUTO_INGEST_GUIDE.md) — File watcher + content analysis
- [TUI Polish Guide](docs/PHASE3_TUI_POLISH_GUIDE.md) — Syntax highlighting, diff view
- [UX Polish Guide](docs/PHASE4_UX_POLISH_GUIDE.md) — Error messages, autocomplete

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md). Bug reports and feature requests welcome via [issues](https://github.com/ahmdd4vd/Huagent/issues).

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability reporting policy and threat model.

## License

[MIT](LICENSE) © 2026 Huanime. All rights reserved.

---

Inspired by [claw-code](https://github.com/ultraworkers/claw-code), [OpenClaude](https://github.com/Gitlawb/openclaude), and [ECC](https://github.com/affaan-m/ECC). Built with [Ink](https://github.com/vadimdemedes/ink).
