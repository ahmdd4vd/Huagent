# Huagent Architecture

**Version:** 4.3.1  
**Last Updated:** 2026-06-15

---

## Overview

Huagent is a **terminal-native AI coding agent** with a unified 6-stage workflow engine, multi-provider LLM support, and intelligent memory system.

```
┌─────────────────────────────────────────────────────────────┐
│                        HUAGENT                              │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │   TUI    │  │  Engine  │  │ Providers│  │  Memory  │  │
│  │ (Ink+    │  │ (6-stage │  │ (26 LLM  │  │ (SQLite  │  │
│  │  React)  │  │ workflow)│  │  APIs)   │  │ + Wiki)  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│       │              │              │              │        │
│       └──────────────┴──────────────┴──────────────┘        │
│                           │                                 │
│                    ┌──────┴──────┐                          │
│                    │    Tools    │                          │
│                    │ (8 built-in)│                          │
│                    └─────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Engine (`src/engine/core.ts`)

The **6-stage workflow engine** that processes user messages:

```
User Message
    ↓
┌─────────────────────────────────────────┐
│ 1. UNDERSTAND                           │
│    - Task classification (regex + LLM) │
│    - Complexity detection               │
│    - Memory recall                      │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│ 2. PLAN                                 │
│    - Generate step-by-step plan         │
│    - Identify tools needed              │
│    - Set dependencies                   │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│ 3. EXECUTE                              │
│    - Run steps (sequential/parallel)    │
│    - Execute tools                      │
│    - Feed results back to LLM           │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│ 4. VERIFY                               │
│    - Critic scores (1-5 scale)          │
│    - Check correctness/completeness     │
│    - Verdict: pass/refine/fail          │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│ 5. REFINE                               │
│    - If verdict=refine, re-execute      │
│    - Max 3 iterations                   │
└──────────────┬──────────────────────────┘
               ↓
┌─────────────────────────────────────────┐
│ 6. REFLECT                              │
│    - Extract lessons                    │
│    - Save patterns to memory            │
└──────────────┬──────────────────────────┘
               ↓
         Response
```

#### Key Classes

- **`Engine`** — Main orchestrator
- **`Planner`** — Generates plans via LLM
- **`Critic`** — Scores results (5 dimensions)
- **`Reflector`** — Extracts lessons learned

#### Task Classification

Two-tier classification:

1. **Regex (fast path)**
   ```typescript
   "fix bug" → code_fix
   "read file" → code_read
   "refactor" → code_refactor
   "run tests" → action
   "what is" → question
   ```

2. **LLM fallback (for ambiguous messages)**
   ```typescript
   "hello there" → LLM classifier → code_write
   ```

#### Complexity Detection

```typescript
trivial  — short questions (< 30 chars)
simple   — short messages (< 8 words)
moderate — medium messages (8-25 words)
complex  — long messages (> 25 words)
```

**Trivial tasks skip planning** and go straight to chat.

---

### 2. Providers (`src/providers/`)

**26 LLM providers** with unified interface:

```
┌─────────────────────────────────────────┐
│         UnifiedClient                   │
│  - Unified API for all providers       │
│  - Automatic retry (3 attempts)        │
│  - Token/cost tracking                 │
│  - Tool-call accumulation              │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───┴────┐          ┌────┴─────┐
│Anthropic│          │OpenAI    │
│(Claude) │          │(GPT)     │
└──────────┘          └──────────┘
    │                     │
    └──────────┬──────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───┴────┐          ┌────┴─────┐
│Gemini  │          │Ollama    │
│        │          │(local)   │
└──────────┘          └──────────┘
               │
          (22 more...)
```

#### Provider Registry

```typescript
// src/providers/registry.ts
PROVIDERS = {
  anthropic: { baseUrl: '...', apiKeyEnv: 'ANTHROPIC_API_KEY', ... },
  openai: { baseUrl: '...', apiKeyEnv: 'OPENAI_API_KEY', ... },
  gemini: { baseUrl: '...', apiKeyEnv: 'GEMINI_API_KEY', ... },
  // ... 23 more
}
```

#### Supported Providers

| Category | Providers |
|----------|-----------|
| API-Based | Anthropic, OpenAI, Gemini, Mistral, Groq, DeepSeek, Perplexity, xAI, MiniMax, NVIDIA, Cerebras, OpenRouter, Together, Fireworks, HuggingFace |
| Cloud | GitHub Copilot, Azure OpenAI, AWS Bedrock, Google Vertex |
| Local | Ollama |
| Custom | Any OpenAI-compatible API |

---

### 3. Memory System (`src/memory/`)

**4 types of memory** stored in SQLite:

```
┌─────────────────────────────────────────┐
│         MemoryManager                   │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───┴────┐          ┌────┴─────┐
│Episodic│          │Semantic  │
│(events)│          │(facts)   │
└──────────┘          └──────────┘
    │                     │
┌───┴────┐          ┌────┴─────┐
│Procedur│          │Project   │
│(how-to)│          │(facts)   │
└──────────┘          └──────────┘
```

#### Memory Types

| Type | Example | Use Case |
|------|---------|----------|
| **Episodic** | "Fixed login bug yesterday" | Past events |
| **Semantic** | "React is a UI framework" | World knowledge |
| **Procedural** | "How to fix login bugs" | How-to guides |
| **Project** | "Project uses TypeScript" | Project facts |

#### Memory Recall

When searching for memories, Huagent uses:

```typescript
score = importance * 0.6 + recency * 0.4

where:
  importance = 0.0 - 1.0 (how critical)
  recency = exponential decay (24h half-life)
```

#### SQLite Schema

```sql
-- Memories table
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT,           -- episodic/semantic/procedural/project
  content TEXT,
  metadata JSON,
  importance REAL,     -- 0.0 - 1.0
  last_accessed INTEGER,
  created_at INTEGER
);

-- Project facts table
CREATE TABLE project_facts (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);

-- Skills table
CREATE TABLE skills (
  name TEXT PRIMARY KEY,
  pattern TEXT,
  created_at INTEGER
);
```

---

### 4. Tools (`src/tools/`)

**8 built-in tools** the agent can use:

```
┌─────────────────────────────────────────┐
│           ToolRegistry                  │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───┴────┐          ┌────┴─────┐
│  read  │          │  write   │
│(file)  │          │(file)    │
└──────────┘          └──────────┘
    │                     │
┌───┴────┐          ┌────┴─────┐
│  edit  │          │  bash    │
│(file)  │          │(command) │
└──────────┘          └──────────┘
    │                     │
┌───┴────┐          ┌────┴─────┐
│ search │          │  grep    │
│(files) │          │(content) │
└──────────┘          └──────────┘
    │                     │
┌───┴────┐          ┌────┴─────┐
│  web   │          │  memory  │
│(fetch) │          │(save/load)│
└──────────┘          └──────────┘
```

#### Tool Descriptions

| Tool | Description | Example |
|------|-------------|---------|
| **read** | Read a file | `read("src/auth.ts")` |
| **write** | Write a file | `write("src/new.ts", "content")` |
| **edit** | Edit a file (search/replace) | `edit("src/auth.ts", "old", "new")` |
| **bash** | Run bash command | `bash("npm test")` |
| **search** | Search files by name | `search("*.test.ts")` |
| **grep** | Search file contents | `grep("TODO", "src/")` |
| **web** | Fetch web content | `web("https://example.com")` |
| **memory** | Save/load memories | `memory.save("fact")` |

#### Permission Modes

Tools respect permission modes:

```typescript
type PermissionMode = 
  | 'read-only'          // Only read files
  | 'workspace-write'    // Read + write in workspace (default)
  | 'danger-full-access' // Full access (⚠️ dangerous)
  | 'prompt'             // Ask before each action
  | 'allow'              // Allow everything
```

---

### 5. TUI (`src/tui/`)

**Terminal User Interface** built with Ink + React:

```
┌─────────────────────────────────────────┐
│              Header                     │
│  ✦ huagent v4.3.1                     │
│  Connected to Anthropic/claude-4.6     │
├─────────────────────────────────────────┤
│                                         │
│  Chat Messages                          │
│  > user message                         │
│  ✧ agent response                       │
│                                         │
├─────────────────────────────────────────┤
│  Input Box                              │
│  > _                                    │
├─────────────────────────────────────────┤
│  Status Bar                             │
│  tokens: 1234 | cost: $0.0045          │
└─────────────────────────────────────────┘
```

#### TUI Components

| Component | File | Description |
|-----------|------|-------------|
| **ModernApp** | `ModernApp.tsx` | Main TUI component |
| **Header** | `new-layout.tsx` | Header with provider/model |
| **StatusBar** | `status.tsx` | Token/cost display |
| **Picker** | `picker.tsx` | Model/provider selector |
| **Dialogs** | `dialog-controller.ts` | Question/permission dialogs |

---

### 6. Hooks (`src/hooks.ts`)

**Lifecycle hooks** for extensibility:

```
User Message
    ↓
  UserPrompt hook
    ↓
  PreLLMCall hook
    ↓
  (LLM call)
    ↓
  PostLLMCall hook
    ↓
  PreToolUse hook
    ↓
  (Tool execution)
    ↓
  PostToolUse hook
    ↓
  PreCompact hook
    ↓
  (Memory compaction)
    ↓
  PostCompact hook
    ↓
  AssistantReply hook
    ↓
  SessionEnd hook
```

#### Built-in Hooks

```typescript
// Log tool usage
hooks.on('PostToolUse', (ctx) => {
  console.log(`Tool ${ctx.tool} executed`);
});

// Auto-save after each reply
hooks.on('AssistantReply', (ctx) => {
  saveSession(ctx.sessionId);
});
```

---

## Data Flow

### Complete Request Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        USER                                 │
│                      (types message)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                        TUI                                  │
│              (ModernApp.tsx)                                │
│  - Render input box                                         │
│  - Capture user input                                       │
│  - Call engine.process()                                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                      ENGINE                                 │
│                  (core.ts)                                  │
│                                                             │
│  1. UNDERSTAND                                              │
│     ├─ detectTaskType("fix bug") → code_fix                │
│     ├─ detectComplexity(msg) → moderate                    │
│     └─ memory.recall("fix bug") → [past memories]          │
│                                                             │
│  2. PLAN                                                    │
│     └─ planner.plan(msg) → { steps: [...] }                │
│                                                             │
│  3. EXECUTE                                                 │
│     ├─ for each step:                                       │
│     │   └─ tools.execute(step.tool, step.args)             │
│     └─ feed results back to LLM                            │
│                                                             │
│  4. VERIFY                                                  │
│     └─ critic.score(plan) → { score: 4.5, verdict: pass } │
│                                                             │
│  5. REFINE                                                  │
│     └─ (skip if verdict=pass)                               │
│                                                             │
│  6. REFLECT                                                 │
│     └─ memory.save("Fixed login bug")                      │
│                                                             │
│  Return response                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                     PROVIDER                                │
│                (client.ts)                                  │
│  - UnifiedClient.stream()                                   │
│  - Send to Anthropic/OpenAI/Gemini/etc                      │
│  - Receive streaming response                               │
│  - Track tokens/cost                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                     LLM API                                 │
│            (Anthropic/OpenAI/etc)                           │
│  - Process request                                          │
│  - Generate response                                        │
│  - Return streaming chunks                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                      TUI                                    │
│  - Render streaming response                                │
│  - Update token/cost display                                │
│  - Save to conversation history                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                        USER                                 │
│                    (sees response)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
huagent/
├── src/
│   ├── engine/              # 6-stage workflow engine
│   │   ├── core.ts          # Main engine (781 lines)
│   │   ├── planner.ts       # Plan generation
│   │   ├── critic.ts        # Result scoring
│   │   └── reflector.ts     # Lesson extraction
│   │
│   ├── providers/           # 26 LLM providers
│   │   ├── client.ts        # UnifiedClient (368 lines)
│   │   ├── registry.ts      # Provider registry
│   │   ├── models.ts        # Model definitions
│   │   ├── capabilities.ts  # Pattern-based capabilities
│   │   ├── pricing.ts       # Pattern-based pricing
│   │   └── proxy-fetch.ts   # Proxy support
│   │
│   ├── memory/              # Memory system
│   │   ├── store.ts         # SQLite storage (296 lines)
│   │   ├── manager.ts       # Memory manager (172 lines)
│   │   └── pressure.ts      # Memory pressure detection
│   │
│   ├── tools/               # 8 built-in tools
│   │   ├── index.ts         # Tool registry
│   │   ├── read.ts          # Read file
│   │   ├── write.ts         # Write file
│   │   ├── edit.ts          # Edit file
│   │   ├── bash.ts          # Bash command
│   │   ├── search.ts        # Search files
│   │   ├── grep.ts          # Grep content
│   │   ├── web.ts           # Web fetch
│   │   └── memory.ts        # Memory tool
│   │
│   ├── tui/                 # Terminal UI
│   │   ├── ModernApp.tsx    # Main TUI (725 lines)
│   │   ├── new-layout.tsx   # Layout components
│   │   ├── status.tsx       # Status bar
│   │   ├── picker.tsx       # Model/provider picker
│   │   └── dialog-controller.ts  # Dialogs
│   │
│   ├── hooks.ts             # Lifecycle hooks (188 lines)
│   ├── sessions.ts          # Session management
│   ├── permissions.ts       # Permission system
│   ├── slash-commands.ts    # 28 slash commands
│   ├── skills.ts            # Skill system
│   ├── summary.ts           # Conversation summarization
│   └── cli.tsx              # CLI entry point (477 lines)
│
├── tests/                   # Test files
│   ├── engine/
│   │   └── core.test.ts     # Engine tests
│   └── integration/
│       └── e2e.test.ts      # End-to-end tests
│
├── docs/                    # Documentation
│   ├── USER_GUIDE.md        # User guide (797 lines)
│   ├── ARCHITECTURE.md      # This file
│   └── CONTRIBUTING.md      # Contributor guide
│
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
└── README.md                # Project README
```

---

## Design Principles

### 1. **Unified Engine**
- No V3/V4 split — one engine for all use cases
- 6-stage workflow for complex tasks
- Simple chat for trivial questions

### 2. **Provider Flexibility**
- 26 providers with unified interface
- Easy to add new providers
- Automatic retry and fallback

### 3. **Intelligent Memory**
- 4 types of memory (episodic, semantic, procedural, project)
- Exponential decay for recency
- Automatic memory compaction

### 4. **Safety First**
- 5 permission modes
- Tool execution sandboxing
- Dangerous command blocking

### 5. **Extensibility**
- Lifecycle hooks for customization
- Custom tools support
- Custom system prompts

### 6. **Cost Awareness**
- Real-time token/cost tracking
- Pattern-based pricing
- Effort level control

---

## Performance

### Latency Breakdown

| Stage | Typical Latency | Notes |
|-------|----------------|-------|
| Understand | 10-50ms | Regex + memory recall |
| Plan | 500-2000ms | LLM call |
| Execute | 100-5000ms | Depends on tools |
| Verify | 500-1500ms | LLM call |
| Refine | 0-3000ms | 0-3 iterations |
| Reflect | 50-200ms | Memory save |

**Total:** 1-10 seconds for complex tasks, <1 second for trivial questions.

### Memory Usage

- **SQLite database:** ~1-10 MB (depends on conversation history)
- **In-memory:** ~50-100 MB (depends on conversation length)
- **Node.js process:** ~100-200 MB total

### Token Usage

| Task Type | Typical Tokens | Cost (Claude Sonnet) |
|-----------|---------------|---------------------|
| Trivial question | 100-300 | $0.0003-0.001 |
| Simple task | 500-1500 | $0.002-0.005 |
| Moderate task | 2000-5000 | $0.006-0.015 |
| Complex task | 5000-15000 | $0.015-0.045 |

---

## Security

### API Key Storage

- Stored in `~/.huagent/config.json`
- File permissions: `600` (owner read/write only)
- Never logged or exposed in TUI

### Tool Execution

- **Permission modes** restrict tool access
- **Workspace boundary** prevents writes outside project
- **Dangerous command blocking** prevents `rm -rf /`, etc.

### Network Security

- HTTPS only for API calls
- Certificate validation enabled
- Proxy support for corporate networks

---

## Future Work

### Phase 2: WllmConcept Integration (Q2 2026)
- Wire WikiStore to engine
- 5-memory routing
- Auto-ingest on file change
- Scheduled lint

### Phase 3: TUI Polish (Q3 2026)
- Syntax highlighting
- Diff view
- File tree visualization
- Progress indicators

### Phase 4: UX Polish (Q3 2026)
- Better error messages
- Smart autocomplete
- Clickable file paths
- Loading states

### Phase 5: Observability (Q4 2026)
- Structured logging
- Prometheus metrics
- Grafana dashboards
- Health checks

---

## References

- [User Guide](./USER_GUIDE.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [CHANGELOG](../CHANGELOG.md)
- [LICENSE](../LICENSE)

---

**Architecture designed for extensibility, safety, and intelligence. 🧠✨**
