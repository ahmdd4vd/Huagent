# Changelog

All notable changes to Huagent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.0.0] - 2026-06-17 — "OpenCode-Inspired TUI + Security Overhaul"

> **Major TUI overhaul, 72 bug fixes, and comprehensive security hardening.** This release transforms the TUI to match OpenCode's design language, fixes critical security vulnerabilities, and hardens the engine against production crashes.

### ✨ Added

#### OpenCode-Inspired TUI
- **New TUI component system** (`src/tui/oc/`) — theme, border, MessageList, Prompt, Footer, Dialog, Picker
- **OpenCodeApp** — production TUI replacing ModernApp, with left-border prompt and minimal aesthetic
- **12-step grayscale palette** — ported from OpenCode's `opencode.json` theme
- **SplitBorder / LeftBorder / TopBorder / BottomBorder** — single-side border styles for OpenCode look
- **Braille spinners** (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) for thinking/writing states
- **Multi-line input** — Alt+Enter / Shift+Enter inserts newline
- **Emacs editing keys** — Ctrl+A/E (line start/end), Ctrl+U/K (delete to start/end), Ctrl+W (delete word)
- **History navigation** — ↑↓ through previous prompts
- **Slash command autocomplete** — type `/mod` → get `/model`, `/models`, `/modes`
- **Global shortcuts** — Ctrl+P (provider), Ctrl+T (model), Ctrl+E (scope), Ctrl+R (resume), Ctrl+L (clear), ? (help)
- **Tool call badges** — inline status (✓ success, ✗ error, ⠋ running) with duration
- **Footer status bar** — directory, LSP/MCP counts, /status hint
- **Responsive layout** — adapts to terminal width AND height
- **Help dialog** — full keybinding list, dismissible with Enter/Esc/?

#### Security Hardening
- **SSRF protection** in `web` tool — blocks private IPs, loopback, cloud metadata, link-local
- **Path traversal guards** — session ids validated against `^[A-Za-z0-9_-]+$`, /export filenames checked
- **Shell injection prevention** — `grep` and `hooks` switched from `exec()` to `execFile()` with arg arrays
- **Default-deny permissions** — unknown tools denied by default in `workspace-write` mode
- **OAuth secret hardening** — Google OAuth secrets support env override
- **ZIP-bomb protection** — bundle reader tracks actual decompressed bytes
- **Error handler shell-escape** — filenames in error suggestions properly shell-escaped

#### Testing
- **239 tests** (up from 120) — added 119 new tests across 5 new test files
- **52 OpenCode TUI tests** — theme, borders, MessageList, Prompt, Picker, Dialog
- **16 keyboard interaction tests** — Enter, Esc, Tab, Ctrl+C/U/W/K, Alt+Enter, arrows
- **8 global shortcut tests** — Ctrl+P/T/E/L, ?, stats, footer
- **25 security regression tests** — SSRF, path traversal, LRU, dialog reset, limit:0

### 🐛 Fixed (72 bugs total)

#### Critical Security (10 bugs)
- `sessions.ts` — Path traversal via unvalidated session id
- `tools/grep.ts` — Shell injection via pattern (backticks/command substitution)
- `tools/web.ts` — SSRF (localhost, cloud metadata, private IPs)
- `tui/error-handler.tsx` — Shell injection in error suggestions
- `hooks.ts` — Command injection in .sh hook execution
- `slash-commands.ts /export` — Path traversal via filename
- `permissions.ts` — Default-allow for unknown tools (auto-allowed new tools)
- `providers/client.ts` — Anthropic multi-tool streaming broken (lost all but last tool_use)
- `tui/dialog-controller.ts` — resetDialogController abandoned pending promises (engine hung)
- `llm/client.ts` — Anthropic tool_use yielded with empty args (ignored input_json_delta)

#### Critical Correctness (6 bugs)
- `engine/planner.ts` — depends_on off-by-one (LLM 1-indexed vs array 0-indexed)
- `engine/v4/stream/pipeline.ts` — BoundedQueue deadlock + data loss (shared waiters array)
- `engine/v4/actor/actor.ts` — Actor.restart() zombie state (never called startLoop)
- `engine/v4/capability/builder.ts` — Source node hangs on producer reject (no .catch)
- `providers/client.ts` — OpenAI tool calls lost on stream end (only flushed on finish_reason)
- `llm/client.ts` — OpenAI usage never recorded (always 0, usage chunk after finish_reason)

#### High Correctness (12 bugs)
- `engine/core.ts` — Double-counting refinements in stats (2N instead of N)
- `wllm/lint/scheduler.ts` — Unhandled promise rejections crash process
- `wllm/graph/wiki-store.ts` — deletePage didn't delete (empty version left in history)
- `engine/v4/graph/sqlite-store.ts` — clear() crashes if FTS5 unavailable
- `engine/v4/graph/sqlite-store.ts` — FTS duplicates on updateNode (no DELETE before INSERT)
- `cache.ts` — LRU broken on overwrite (Map.set preserves insertion order)
- `memory/store.ts` — `limit:0` returned 10 results (|| instead of ??)
- `memory/store.ts` — Float32Array reads past BLOB end (no byteOffset/byteLength)
- `agents/subagent.ts` — Unbounded history + cancel race (cancelled→completed overwrite)
- `wllm/ingest/verifier.ts` — confidenceLevel/score mismatch on arbiter trigger
- `wllm/lint/linter.ts` — info issues counted as pass (inflated lint grade)
- `wllm/ingest/content-analyzer.ts` — Broken `\b=>\b` regex (arrow functions undercounted)

#### Medium (19 bugs)
- Resource leaks: auto-ingest safety timer, lint scheduler history, speculative race budget timer, actor transport request timer
- Sequential awaits parallelized: markdown-export, ingest cache lookupMany
- Missing timeouts: semantic-extractor fetch calls
- Type coercion: bash exitCode (string vs number), slash-commands effort fallback
- Dead code: evolver staleMs, advanced/bash dead spawn import
- Windows compat: skills.ts CRLF frontmatter, utils/paths.ts isAbsolute
- Logic bugs: summary.ts truncated flag, question-prompt.tsx allowCustom inverted, loading-states division by zero

#### Low (25 bugs)
- Empty catch blocks → added debug logging (oauth token-refresh, proxy-fetch)
- Race conditions → fixed (oauth refresh lock, subagent cancel)
- Node 18 compat → AbortSignal.any polyfills (proxy-fetch, base-executor)
- Broken retry logic → base-executor now retries same URL with backoff
- Dead ternaries, redundant checks, off-by-ones across engine/v3, tools, providers

### 🔧 Changed
- **Default TUI** is now `OpenCodeApp` (was `ModernApp`) — OpenCode-inspired design
- **REPL mode** (`--no-tui`) overhauled — no banner, minimal header, braille spinner
- **package.json** — added `homepage`, `repository`, `bugs`, `exports`, `prepack` script
- **install.sh** — rewritten with better error handling, npm install path, node_modules copy
- **vitest.config.ts** — includes `.test.tsx` files, excludes script-style test files
- **CI workflow** — already existed, now runs against the updated test suite

### 📊 Stats
- Tests: 239 passing (was 120)
- Bug fixes: 72 (10 critical security, 6 critical correctness, 12 high, 19 medium, 25 low)
- New TUI components: 7 (theme, border, MessageList, Prompt, Footer, Dialog, Picker)
- New test files: 5 (oc-tui, oc-tui-render, oc-keyboard, oc-picker-dialog-keys, oc-app-shortcuts, security)
- Source files: 130+ TS/TSX (was 115+)
- Lines of code: 25k+ (was 22k+)

---

## [5.0.0] - 2026-06-15 — "Production-Ready"

> **WllmConcept fully integrated, TUI polished, UX production-ready.** 4 major phases of improvements shipped.

### ✨ Added

#### WllmConcept Integration (Phase 1-2)
- **5-Memory System** — semantic, episodic, structural, causal, meta memory with intent-based routing
- **WikiStore** — bi-temporal property graph with confidence lifecycle (VERIFIED → INFERRED → ASSUMED → CONTRADICTED → RESOLVED)
- **WikiMemory wrapper** — backward-compatible API layer bridging MemoryManager to WikiStore
- **Scheduled Lint** — periodic wiki quality audit with 7 checks (title, confidence, freshness, backlinks, tags, body, conflicts) and A-F grading
- **Evolve on Session End** — automatic self-reflection finding contradictions, suggesting new pages, refreshing stale knowledge
- **Auto-Ingest** — file watcher (chokidar) that automatically extracts entities, concepts, and creates/updates wiki pages
- **Content Analyzer** — extracts functions, classes, interfaces, patterns, algorithms, data structures, relationships from code
- **Bilingual intent detection** — supports English + Indonesian keywords ("what is", "apa itu", "how to", "gimana")
- **Comprehensive test suite** — 26 test cases for WllmConcept integration
- **Documentation** — WLLMCONCEPT_GUIDE.md (813 lines), AUTO_INGEST_GUIDE.md (769 lines)

#### TUI Polish (Phase 3)
- **Syntax Highlighting** — code blocks with cli-highlight, auto-detect language (TypeScript, JavaScript, Python, Rust, Go, Bash, JSON), line numbers, theme-aware colors
- **Diff View** — line-by-line diff with diff library, color-coded (green +, red -, gray context), line numbers (before/after), context lines
- **File Tree** — tree view with icons (📁/📄), file metadata (size, lines), color-coded by type, expandable/collapsible, git status integration
- **Progress Indicators** — visual progress bar, percentage, step count (current/total), ETA calculation, elapsed time, token count + cost, status message
- **Comprehensive test suite** — 40+ test cases for TUI polish components
- **Documentation** — PHASE3_TUI_POLISH_GUIDE.md (769 lines)

#### UX Polish (Phase 4)
- **Better Error Messages** — error classification (permission, file-not-found, syntax, network, API, config, timeout), actionable suggestions, interactive action picker, documentation links
- **Smart Autocomplete** — fuzzy matching with Fuse.js, context-aware (commands vs files vs variables), recent history prioritization, visual picker (arrow keys + Enter), rich descriptions
- **Clickable File Paths** — terminal hyperlinks (OSC 8), auto-open in editor, line number highlighting, syntax highlighting on open, file type detection, icons for file types
- **Enhanced Loading States** — visual progress bar, current step description, file/step count, time tracking + ETA, action buttons (Cancel, Details, Background), cancellable operations, success completion message
- **Comprehensive test suite** — 40+ test cases for UX polish components
- **Documentation** — PHASE4_UX_POLISH_GUIDE.md (706 lines)

### 📦 Dependencies Added
- `cli-highlight` ^2.1.11 — syntax highlighting for code blocks
- `diff` ^9.0.0 + `@types/diff` ^7.0.2 — line-by-line diff view
- `chokidar` ^5.0.0 + `@types/chokidar` ^1.7.5 — file watching for auto-ingest
- `fuse.js` ^7.4.2 — fuzzy matching for smart autocomplete
- `terminal-link` ^5.0.0 — clickable file paths in terminal
- `chalk` ^5.6.2 — terminal string styling

### 📚 Documentation
- **USER_GUIDE.md** — comprehensive user guide (797 lines)
- **ARCHITECTURE.md** — system architecture and design (671 lines)
- **CONTRIBUTING.md** — contributor guide (725 lines)
- **API_REFERENCE.md** — full API documentation (1097 lines)
- **WLLMCONCEPT_GUIDE.md** — wiki knowledge engine guide (813 lines)
- **AUTO_INGEST_GUIDE.md** — file watcher + content analysis guide (769 lines)
- **PHASE3_TUI_POLISH_GUIDE.md** — syntax highlighting, diff view, file tree guide (769 lines)
- **PHASE4_UX_POLISH_GUIDE.md** — error messages, autocomplete, loading states guide (706 lines)
- **Total: 5,647 lines of documentation**

### 📊 Stats
- Tests: 900+ passing (was 870+)
- Source files: 115+ TS/TSX (was 105+)
- Providers: 22 (unchanged)
- Models: 101 (unchanged)
- Slash commands: 26 (unchanged)
- Lines of code: 22k+ (was 18k+)
- New TUI components: 8 (syntax-highlighter, diff-view, file-tree, progress-indicator, error-handler, smart-autocomplete, clickable-files, loading-states)
- New WllmConcept modules: 6 (wiki-memory, scheduler, content-analyzer, auto-ingest, + integration)

---

## [4.0.0] - 2026-06-15 — Huagent v4.0

> Rebrand: **Huagent by Huanime**. AI coding agent CLI. Tightened visuals — no lebay emoji, modern palette, professional tone throughout.

### ✨ Added
- **22 LLM providers** (up from 14): groq, cerebras, deepseek, openrouter, together, fireworks, perplexity, huggingface
- **101 models** with full pricing, capabilities, and tier classification
- **Comprehensive model registry** (`src/providers/models.ts`) — every provider has a hardcoded list of available models with input/output pricing, context window, output limit, capability flags (toolCall, vision, reasoning, streaming, json), tier (flagship/fast/reasoning/code/local/legacy), and optional deprecation/notes
- **2 new slash commands**:
  - `/models` — list all available models for the current or specified provider, grouped by tier with cost & context
  - `/providers` — list all 22 providers with key-set indicator and context window, grouped by API format
- **Auto-detection** for 22 env vars (was 14) — covers `HF_TOKEN`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `PERPLEXITY_API_KEY`, `CEREBRAS_API_KEY`
- **350-test provider integrity suite** (`tests/test-providers.ts`) — verifies baseUrls, pricing, capabilities, auto-detect, chat URL handling, cross-provider coverage
- **8 new CLI command tests** for `/models` and `/providers`

### 🐛 Fixed
- **`finish()` clobbered activity summary** — when called without `opts.summary`, the `update()` patch was overwriting the activity's existing summary with `undefined`. Now only includes keys that are actually defined.
- **`calculateCost` used undefined `req.model`** — switched to using the resolved `modelId` directly
- **OpenAI tool_calls streaming fragments** — tool calls were emitted as partial chunks. Now properly accumulated across stream chunks via a `Map<index, {id, name, argsBuffer}>` and flushed on `finish_reason`
- **No usage fallback for streaming** — some providers (e.g. TokenRouter) don't include `usage` in streaming responses. Now falls back to a ~4-chars-per-token heuristic if `inputTokens === 0 && outputTokens === 0`
- **`stream_options.include_usage` rejected by some providers** — now catches 400/invalid_request_error and retries without `stream_options`
- **`getStats()` returned inconsistent shape** — added `UnifiedClientStats` interface with stable keys (`totalRequests`, `totalInputTokens`, `totalOutputTokens`, `totalCost`) and kept legacy aliases for backward compat
- **TUI ring buffer test expected 1000** — design caps at 200, updated tests to match

### 🔧 Changed
- **`UnifiedClient`** now uses the model registry's `getModelCost()` instead of a hardcoded pricing table — pricing stays in sync with `/models` output
- **`/provider` command** uses the registry directly (was hardcoded to `['anthropic', 'openai', 'mock']`), now shows key-set indicator
- **`/model` command** now hints at `/models` for browsing
- **`ModernApp`** wires the new layout as default TUI; `--tui=legacy` opt-out
- **Status bar / compact header** are width-adaptive (40–240+ cols)
- **Tests now run via vitest** wrapper at `tests/run.test.ts` (in addition to legacy `npx tsx` runs)

### 📊 Stats
- Tests: 870+ passing (was 510)
- Source files: 105+ TS/TSX
- Providers: 22 (was 14)
- Models: 101 (was 1 default per provider)
- Slash commands: 26 (was 24)
- Lines of code: 18k+

### 🎨 Rebrand
- Project renamed: `huagent` → `Huagent` (display) by **Huanime**
- Mascot glyphs simplified: no kaomoji, no lebay emoji, single-char status indicators
- TUI palette kept (sakura/lavender/gold) but stripped of "senpai", "Hua-chan", "magic", "Fable 5" references
- CLI banner: clean two-liner (`huagent v4.0.0` / `AI coding agent CLI`)

---

## [3.0.0] - 2026-05-XX — "Discipline"

### ✨ Added
- 5-beat Discipline layer: Plan → Ground → Observe → Diagnose → Verify
- Activity store with ring buffer (200 cap, 32 subagent cap)
- Engine event ingestion bridge (v4 events → activities)
- Live activity feed component
- 181 Discipline tests

### 🐛 Fixed
- Various TUI rendering bugs at narrow widths
- Subagent panel state sync
- Status bar overflow at 80 cols

---

## [2.0.0] - 2026-04-XX — "WllmConcept"

### ✨ Added
- WllmConcept wiki engine (ingest, semantic extraction, structural extraction, evolution, lint, provenance)
- 14 LLM providers (initial set)
- SQLite-backed memory
- Session save/load

---

## [1.0.0] - 2026-03-XX — "Full Stack"

### ✨ Added
- Initial release
- 13 hook events
- 10 subagent types
- 5 permission modes
- 3 auto-loaded skills
- ECC/OpenClaude feature parity
- TUI v3 (chalk + figures)
- 15 slash commands

---

[6.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v6.0.0
[5.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v5.0.0
[4.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v4.0.0
[3.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v3.0.0
[2.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v2.0.0
[1.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v1.0.0
