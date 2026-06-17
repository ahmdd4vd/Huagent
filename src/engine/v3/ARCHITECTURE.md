# 🧠 Engine v3.0 — Innovation Architecture

## Design Goals

Buat engine yang:
1. **Anti-halusinasi** — Verifikasi pakai fakta, bukan "are you sure"
2. **Cross-model persistence** — Ganti model, context tetap
3. **Makin pintar over time** — Belajar dari tiap interaksi (continuous learning)
4. **Kencang** — TTFT minimal, parallel di mana bisa
5. **Self-healing** — Stuck detection + recovery
6. **Spec-driven** — Spec dulu, baru code (bounded)

## Inspired By (Dengan Improvement)

| Source | Pattern | huagent v3.0 Improvement |
|---|---|---|
| **Claude Code (Pi-derived)** | Tree session, model-change tracked | + **Identity Context**: persona, principles, project state selalu ada |
| **ECC** | Continuous Learning v2 (instincts) | + **Auto-categorize**: code style, anti-patterns, recipes |
| **ECC GateGuard** | Fact-forcing before edit | + **Pre-flight check**: scan imports, callers, types |
| **Aider** | SEARCH/REPLACE edit format | + **Auto-detect**: file size decides format |
| **Aider** | Linter-after-edit | + **Syntax check via tool pool** |
| **Aider** | Git auto-commit | + **Snapshot + rollback** (without git overhead) |
| **OpenClaude** | Snip projection (non-destructive) | + **Snip + LRU cache** for instant restore |
| **OpenClaude** | TTFT profiling | + **Stage-level profiling** (per stage) |
| **OpenCode** | Doom-loop detection | + **3-level recovery**: hint → swap model → ask user |
| **Pi** | Two-loop (steer/followUp) | + **Steering queue** with priority |

## 7-Stage Workflow (V3.0)

```
User Input
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 0: 🌱 COLD-START CONTEXT (first run only)            │
│ - Scan project (package.json, CLAUDE.md, README, .git)     │
│ - Detect language, framework, conventions                   │
│ - Build persistent project context                          │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1: 🧠 UNDERSTAND                                      │
│ - Detect task type (code_write, fix, refactor, qa)         │
│ - Detect complexity (trivial → complex)                    │
│ - Recall relevant memories (semantic + episodic)           │
│ - Load project identity (persona, principles, scope)       │
│ - Decide: needs scout? needs architect? needs editor?       │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 1.5: 🔍 SCOUT (optional, for code_read/research)    │
│ - Spawn code-explorer subagent (parallel if needed)        │
│ - Map file dependencies, find patterns                     │
│ - Build code map (file → role → importance)                │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 2: 🏛️ ARCHITECT (cheap model)                         │
│ - Generate SPEC (not raw plan)                              │
│ - Spec includes: requirements, files affected, data flow,  │
│   acceptance criteria                                      │
│ - Reject specs that are vague or impossible                │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 3: 🗺️ PLANNER                                         │
│ - Decompose spec into plan with tools                       │
│ - Build dependency graph                                   │
│ - Group into parallel batches                               │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 4: ✏️ EDITOR (expensive model)                         │
│ - Execute plan in parallel batches                          │
│ - For file writes: use SEARCH/REPLACE (Aider)              │
│ - Auto-verify with file re-read                             │
│ - Linter/syntax check (if available)                        │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 5: ✅ VERIFY (Critic + GateGuard)                    │
│ - Critic: 5-dimension scoring                               │
│ - GateGuard: verify file was actually modified correctly   │
│   (re-read, check syntax, test imports)                    │
│ - VERDICT: pass | refine | fail                            │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 6: 🔄 REFINE (loop max 3x)                           │
│ - Doom-loop detection (same tool+args 3x)                  │
│ - Recovery: hint → swap model → ask user                  │
│ - Re-execute failed steps                                   │
└─────────────────────────────────────────────────────────────┘
   ↓
┌─────────────────────────────────────────────────────────────┐
│ STAGE 7: 💡 REFLECT (Continuous Learning)                  │
│ - Extract instinct (recipe/anti-pattern) from outcome      │
│ - Update memory (episodic + semantic + procedural)          │
│ - Record metrics (TTFT, tokens, duration)                  │
│ - Update identity (project facts discovered)               │
└─────────────────────────────────────────────────────────────┘
   ↓
Response + Memory Updated + Instincts Refined
```

## Innovations Beyond References

### Innovation 1: Identity Context (Cross-Model Persistence)
**Problem**: Ganti model → agent "lupa" persona, principles, project facts.

**Solution**: `IdentityContext` always injected ke system prompt:
- **Persona**: "Hua, anime-powered, sparkle ✦"
- **Principles**: "Always show work, ship working code, never break working code"
- **Project Facts**: Discovered from cold-start (language, framework, key files)
- **User Preferences**: Tone, language, terseness (from memory)

Berlaku cross-model. Ganti `MiniMax-M3` → `gpt-4o` → `claude-sonnet`, agent tetap sama.

### Innovation 2: Spec-Driven Generation
**Problem**: LLM ngarang "kode" yang ngga sesuai requirement.

**Solution**: Stage 2 (Architect) HARUS output spec dulu:
```yaml
spec:
  requirements: ["login with email+password", "session cookie", "rate limit 5/min"]
  files: ["src/auth/login.ts", "src/auth/session.ts"]
  data_flow: "POST /login → validate → bcrypt.compare → set cookie"
  acceptance:
    - "POST /login dengan valid creds returns 200 + Set-Cookie"
    - "POST /login dengan invalid returns 401"
    - "5 attempts/min returns 429"
  tests: ["login.test.ts"]
```

Spec di-review oleh critic SEBELUM code ditulis. Reject kalo vague.

### Innovation 3: Edit-Format Auto-Detection
**Problem**: Write file utuh = boros token, error-prone buat dumb model.

**Solution**: Pilih format otomatis:
- **File < 50 bar**: Write full (gampang verify)
- **File 50-300 bar**: SEARCH/REPLACE (Aider pattern)
- **File > 300 bar**: Multiple SEARCH/REPLACE (patch-style)
- **File gak exist**: Write full

Engine nentuin format terbaik. Editor pakai format itu.

### Innovation 4: Two-Model Consensus
**Problem**: Single model = single point of hallucination.

**Solution (optional)**: Kalo task critical, run 2 model parallel, compare, pick best.
- Cheap model (architect) bikin spec
- Expensive model (editor) bikin implementation
- Critic bandingin, kasih skor
- Kalo score beda > 1, escalate ke 3rd model (verifier)

Default OFF, ON untuk task `complex` + `code_write`.

### Innovation 5: Continuous Learning dengan Instinct Synthesis
**Problem**: Reflection save generic episodes, gak actionable.

**Solution**: Instinct synthesizer:
- After 3+ similar successful episodes → extract "instinct" (reusable pattern)
- After 2+ similar failures → extract "anti-pattern"
- Instincts are project-scoped (ECC pattern) + global
- Auto-applied di future tasks sebagai guidance

### Innovation 6: Pre-Flight Fact Check (Anti-Hallucination)
**Problem**: LLM edit file tanpa cek dulu.

**Solution**: Sebelum edit file, engine HARUS:
1. **Read file** (kalo exist) untuk konteks
2. **Check imports**: siapa yang import file ini?
3. **Check public API**: apa yang di-export?
4. **Check types**: type definitions terkait?
5. **Quote user instruction**: apa exact request user?

Kalo salah satu missing, tanya user (atau auto-gather kalo simple).

### Innovation 7: Snapshot + Rollback
**Problem**: Edit salah, gak bisa undo tanpa git.

**Solution**: Pre-write snapshot (sha256 hash) di memory. Post-write, kalau lint/syntax fail, otomatis restore dari snapshot.

## Speed Optimizations

| Optimization | Impact |
|---|---|
| **Parallel stages** (Scout + Recall) | -30% latency |
| **Spec first, code later** | -20% retries |
| **SEARCH/REPLACE** for medium files | -40% tokens |
| **Snip projection** (don't re-summarize) | -50% memory pressure |
| **Two-model consensus** (optional) | +100% quality, -0% latency (parallel) |
| **Cache warming** (system+identity) | 10x faster repeat prompts |

## Memory Schema (V3.0)

```sql
-- 4 jenis memory
episodic    -- events: "user asked X, we did Y, score Z"
semantic    -- facts: "this project uses TypeScript + Ink"
procedural  -- how-to: "to add a slash command: 1) add to list, 2) handle in dispatcher"
project     -- codebase: "auth.ts uses bcrypt, depends on db"

-- + Instincts (synthesized from episodic)
instincts   -- "when user says 'fix bug', always read file first"
anti_patterns -- "don't edit file without reading it first"
```

## Cold-Start Context (Stage 0)

First run, engine scan:
1. `package.json` / `Cargo.toml` / `pyproject.toml` → language + dependencies
2. `README.md` → project purpose
3. `CLAUDE.md` / `AGENTS.md` → user/agent rules
4. `.gitignore` → excluded paths
5. File tree (top-level) → structure

Hasil di-cache di `project_context.json` di `.huagent/`. Invalidate kalo:
- `package.json` berubah
- User explicit `/reindex`

## Doom-Loop Detection

```typescript
// Same tool+args fired 3x in 60s = doom loop
const doomKey = `${tool.name}:${JSON.stringify(tool.args)}`;
const recent = executionHistory.filter(e => e.key === doomKey && e.timestamp > Date.now() - 60000);
if (recent.length >= 3) {
  // Recovery ladder
  if (model !== 'opus' && hasBiggerModel) {
    escalateToBiggerModel();
  } else if (canAskUser) {
    askUserClarification();
  } else {
    return PartialResult(error: "doom loop detected, please rephrase");
  }
}
```

## Metrics Tracking

- **TTFT** (Time To First Token) per query
- **Stage timings** (per stage duration)
- **Token usage** (per model, per call)
- **Refinement count** (how often we refine)
- **Success rate** (pass / total)
- **Instinct hit rate** (how often instincts helped)

Tampilin di `/status` + TUI status bar.

## File Structure

```
src/engine/
├── core.ts           — main orchestrator (7 stages)
├── identity.ts       — IdentityContext (cross-model persistence)
├── coldstart.ts      — Stage 0 cold-start project scanner
├── planner.ts        — Stage 3 plan decomposition
├── architect.ts      — Stage 2 spec generation
├── editor.ts         — Stage 4 file editing (SEARCH/REPLACE aware)
├── critic.ts         — Stage 5 verification
├── reflector.ts      — Stage 7 continuous learning
├── instinct.ts       — Instinct synthesis (learn over time)
├── doomloop.ts       — Doom loop detection + recovery
├── snapshot.ts       — File snapshot + rollback
├── metrics.ts        — TTFT + stage profiling
├── profiler.ts       — Performance profiler
├── WORKFLOW.md       — This file
└── ENGINE_GUIDE.md   — User-facing explanation
```
