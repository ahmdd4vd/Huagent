# huagent architecture

> A high-level map of the huagent v4.0.0 codebase. If you're new here, start
> with `src/cli.tsx` (entry point) and follow the imports.

## Bird's eye view

```
                    ┌──────────────────────────────────┐
                    │           bin/huagent.js         │  ← shebang, runs dist/
                    └──────────────┬───────────────────┘
                                   │
                    ┌──────────────▼───────────────────┐
                    │            src/cli.tsx           │  ← arg parsing, bootstrap
                    └──────────────┬───────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────▼──────┐   ┌─────────▼──────┐   ┌─────────▼──────┐
    │   tui/         │   │  engine/        │   │  providers/    │
    │  ModernApp    │   │  v4-runner     │   │  registry      │
    │  new-layout   │   │  v4/actor      │   │  models        │
    │  status       │   │  v4/critic     │   │  client        │
    │  activity-*   │   │  v4/speculative│   │                │
    └────────────────┘   └────────┬───────┘   └────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                 │
        ┌───────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
        │   tools/     │  │  memory/      │  │  wllm/        │
        │  bash, file, │  │  SQLite       │  │  wiki engine  │
        │  edit, read  │  │  facts, skills│  │  graph, evolve│
        └──────────────┘  └──────────────┘  └──────────────┘
```

## Core subsystems

### 1. CLI entry & argument parsing (`src/cli.tsx`)

- Parses flags (`--provider`, `--model`, `--api-key`, `--base-url`, `--perm`, `--tui`, `--engine`, etc.)
- Detects provider from env vars (22 supported, see `src/providers/registry.ts`)
- Loads config from disk (`~/.huagent/config.json`)
- Boots the TUI (modern) or runs one-shot (no-tui)
- Wires the engine + LLM client + tools

### 2. Providers (`src/providers/`)

The provider subsystem has two parts:

#### `registry.ts` — provider config

22 providers, each with:
- `baseUrl`, `apiKeyEnv`, `defaultModel`
- `apiFormat` (anthropic | openai-chat | openai-responses | gemini)
- `authScheme` (bearer | x-api-key | custom)
- Capability flags (`supportsTools`, `supportsStreaming`, `supportsPromptCaching`, `contextWindow`)

`detectProviderFromEnv()` walks 22 env vars in priority order and returns the first match.

#### `models.ts` — model registry

101 hardcoded models with:
- `id, label, family, context, output, cost, capabilities, tier, notes`
- Tier classification: `flagship | fast | reasoning | code | local | legacy`
- Capability flags: `toolCall, vision, reasoning, streaming, json`
- Pricing: per-1M-tokens USD

`getModelCost()` resolves any model id to its pricing (with provider-level fallback for unknown models).

#### `client.ts` — unified streaming client

`UnifiedClient` is the single LLM interface used by the engine. It:
- Auto-routes to Anthropic or OpenAI-compat streaming based on `provider.apiFormat`
- Emits `StreamEvent` discriminated union: `thinking | text_delta | tool_use | usage | message_stop | error`
- **Accumulates OpenAI tool_calls** across chunks (OpenAI sends fragments; we buffer)
- **Falls back** to a ~4-chars/token heuristic when streaming usage is missing
- **Recovers from `stream_options` rejections** (some providers reject it)
- Tracks per-session stats: `requests, totalRequests, inputTokens, outputTokens, totalInputTokens, totalOutputTokens, cost, totalCost`

### 3. TUI (`src/tui/`)

Modern React/Ink-based terminal UI. Width-adaptive (40–240+ cols).

```
tui/
├── theme.ts            # sakura/lavender/gold palette, no emoji
├── ModernApp.tsx       # adapter that wires NewLayout into the engine
├── new-layout.tsx      # orchestrator: header + activity feed + subagent panel + toasts + status bar + prompt
├── compact-header.tsx  # 3-line header (wordmark, chips, separator)
├── activity-store.ts   # singleton ring-buffer of activities (200 cap) + subagent tracking (32 cap)
├── activity-feed.tsx   # live stream of activities
├── activities.tsx      # 6 card components: Read, Write, Edit, Bash, Subagent, Verify
├── status.tsx          # ModeChips, SubagentPanel, StatusBar, Toasts
└── ...
```

Width adaptation: `CompactHeader` truncates chips at narrow widths; `StatusBar` uses a single `<Text>` with calculated left/right positions; `ModeChips` drops low-priority chips below 100 cols.

### 4. Engine v4 (`src/engine/v4/`)

Stream-native actor model with:

```
v4/
├── engine-v4.ts        # top-level orchestrator
├── actor/              # message-passing between actors
├── critic/             # 3-critic mesh for code review
├── speculative/        # race N candidate strategies, pick winner
├── capability/         # dynamic capability building
├── graph/              # graph of dependencies between tasks
├── discipline/         # 5-beat cycle: Plan → Ground → Observe → Diagnose → Verify
├── stream/             # streaming pipeline + cognitive events
└── ...
```

The discipline layer is the safety net: every task goes through 5 beats, and any failure triggers a retry with more context. No silent failures.

### 5. Tools (`src/tools/`)

- `bash` — execute shell commands (with permission classifier)
- `read` — read files
- `edit` — patch files
- `write` — create/overwrite files
- `search` — grep across the workspace
- `git` — diff, status, commit

Each tool has a `risk` classification (low/medium/high/critical) that feeds the permission system.

### 6. Memory (`src/memory/`)

SQLite-backed persistent memory. Stores:
- **Memories** — key facts about the user/project
- **Skills** — learned procedures (auto-loaded by name)
- **Sessions** — saved conversation history
- **Wllm wiki** — bundle import/export

### 7. WllmConcept (`src/wllm/`)

Wiki knowledge engine:
- `ingest/` — parse markdown, extract semantic + structural data
- `graph/` — store the wiki as a queryable graph
- `query/` — full-text + graph search
- `evolve/` — improve the wiki via lint cycles
- `lint/` — check for stale/redundant content
- `provenance/` — track origin of every fact
- `bundle/` — package wikis for distribution
- `sync/` — round-trip markdown ↔ graph

### 8. Slash commands (`src/slash-commands.ts`)

26 commands. Each is a function that takes `(args, ctx)` and returns a `SlashCommandResult`. The dispatcher is a single `switch` statement in `executeSlashCommand()`. Adding a new command is:
1. Add to `SLASH_COMMANDS` array
2. Add a `case` in the switch
3. Implement the function
4. Add tests in `tests/cli-commands.test.ts`
5. Update README

## Permissions (`src/permissions.ts`)

5 modes:
- `read-only` — no writes, no bash
- `workspace-write` — edit project files only
- `sandboxed` — edits go to a temp dir
- `danger-full-access` — no confirmations
- `custom` — user-defined ruleset

Each bash command is classified via `classifyBashCommand()` (e.g. `rm -rf /` → critical). Critical commands always ask for confirmation.

## Sessions (`src/sessions.ts`)

Save/load conversation state to disk. JSON format. Saved on `/exit`, `/save`, or `--exit-after`. Loaded with `/resume <id>`.

## Testing

5 test suites, all runnable via `npm test` (vitest wrapper):

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `tests/tui-v4.test.ts` | 119 | theme tokens, activity-store, status, activity-feed, slash commands |
| `tests/discipline.test.ts` | 181 | Plan/Ground/Observe/Diagnose/Verify cycle |
| `tests/cli-commands.test.ts` | 68 | parseOptions, /provider, /model, /scope, /autonomous, /models, /providers |
| `tests/test-tui-stress.ts` | 153 | visual regression at 40-240 cols, 1000+ activities, unicode |
| `tests/test-providers.ts` | 350 | 22-provider integrity, 101-model pricing/capabilities, auto-detect |

Total: **870+ tests, 0 failures**.

## Design principles

1. **Honest errors** — every failure path emits a meaningful event. No silent crashes.
2. **Width-adaptive UI** — works at 40 cols and 240+ cols without re-layout.
3. **Type safety** — strict TypeScript everywhere, no `any` in public APIs.
4. **Zero-config** — set an env var, it works. No mandatory setup wizard.
5. **Boring infrastructure** — SQLite for memory, JSON for sessions, no exotic deps.
6. **Multi-provider from day one** — Anthropic-format vs OpenAI-compat is the only split.

## Where to look next

- `src/cli.tsx` — entry point
- `src/providers/registry.ts` — provider config
- `src/providers/models.ts` — model registry
- `src/providers/client.ts` — streaming client
- `src/tui/new-layout.tsx` — TUI orchestrator
- `src/engine/v4/engine-v4.ts` — engine entry
- `src/slash-commands.ts` — 26 commands
- `install.sh` — one-liner installer
- `.github/workflows/ci.yml` — CI matrix

---

— © 2026 huanime
