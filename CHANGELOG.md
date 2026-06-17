# Changelog

All notable changes to Huagent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[5.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v5.0.0
[4.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v4.0.0
[3.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v3.0.0
[2.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v2.0.0
[1.0.0]: https://github.com/ahmdd4vd/Huagent/releases/tag/v1.0.0
