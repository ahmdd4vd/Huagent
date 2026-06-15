# Changelog

All notable changes to Huagent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[4.0.0]: https://github.com/d4vdxm/huagent/releases/tag/v4.0.0
[3.0.0]: https://github.com/d4vdxm/huagent/releases/tag/v3.0.0
[2.0.0]: https://github.com/d4vdxm/huagent/releases/tag/v2.0.0
[1.0.0]: https://github.com/d4vdxm/huagent/releases/tag/v1.0.0
