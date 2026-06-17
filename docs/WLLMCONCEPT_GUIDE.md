# WllmConcept Guide

**Version:** 2.0 (Phase 2 Complete)  
**Last Updated:** 2026-01-15

---

## 📋 Daftar Isi

1. [Apa itu WllmConcept?](#apa-itu-wllmconcept)
2. [5 Sistem Memori](#5-sistem-memori)
3. [WikiStore API](#wikistore-api)
4. [WikiMemory Wrapper](#wikimemory-wrapper)
5. [Cara Pakai](#cara-pakai)
6. [Scheduled Lint](#scheduled-lint)
7. [Evolve on Session End](#evolve-on-session-end)
8. [Best Practices](#best-practices)
9. [Contoh Penggunaan](#contoh-penggunaan)
10. [Troubleshooting](#troubleshooting)

---

## 🧠 Apa itu WllmConcept?

**WllmConcept** adalah sistem manajemen pengetahuan berbasis wiki yang membuat Huagent **makin pinter seiring waktu**.

### Fitur Utama

✅ **5 Sistem Memori** — Semantic, Episodic, Structural, Causal, Meta  
✅ **WikiStore** — Bi-temporal property graph (in-memory)  
✅ **Confidence Levels** — VERIFIED, INFERRED, ASSUMED, CONTRADICTED, RESOLVED  
✅ **Freshness Tracking** — LOW, MEDIUM, HIGH, STALE  
✅ **5-Memory Routing** — Intent-based search (what, how, why, when, compare, pattern, history)  
✅ **Scheduled Lint** — Audit wiki secara berkala (7 checks)  
✅ **Evolve on Session End** — Self-reflection (contradictions, suggestions, refreshes)  

### Arsitektur

```
┌─────────────────────────────────────────────────────────┐
│                    WllmConcept                          │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  WikiStore   │  │  WikiMemory  │  │   Linter     │ │
│  │  (Graph DB)  │  │  (Wrapper)   │  │  (7 checks)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         │                   │                   │       │
│         └───────────────────┴───────────────────┘       │
│                             │                           │
│                    ┌────────┴────────┐                  │
│                    │    Evolver      │                  │
│                    │ (Self-reflect)  │                  │
│                    └─────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

---

## 🗂️ 5 Sistem Memori

WllmConcept punya **5 jenis memori** yang berbeda:

### 1. **Semantic Memory** (Fakta & Konsep)

**Apa itu:** Fakta, konsep, entitas, sumber  
**Page Types:** `entity`, `concept`, `source`, `comparison`  
**Contoh:**
```
Entity: "JWT Token"
  Body: "JSON Web Token for authentication"
  Tags: ["jwt", "auth"]
  Confidence: VERIFIED

Concept: "JWT Authentication Pattern"
  Body: "How to implement JWT authentication"
  Tags: ["jwt", "pattern"]
  Confidence: INFERRED
```

### 2. **Episodic Memory** (Kejadian)

**Apa itu:** Debugging sessions, keputusan, kegagalan  
**Page Types:** `episode`, `failure`  
**Contoh:**
```
Episode: "JWT Bug Fix"
  Body: "Fixed JWT validation bug in auth.ts"
  Tags: ["jwt", "bugfix"]
  EpisodeDate: 2026-01-15
  EpisodeOutcome: RESOLVED
  EpisodeDifficulty: MEDIUM
```

### 3. **Structural Memory** (Struktur Kode)

**Apa itu:** Architecture, call-graph, dependencies  
**Page Types:** `structure`  
**Contoh:**
```
Structure: "Auth Module Architecture"
  Body: "Auth module uses JWT + middleware"
  Subtype: "architecture"
  Tags: ["auth", "architecture"]
```

### 4. **Causal Memory** (Alasan & Keputusan)

**Apa itu:** Design decisions, tradeoffs, migrations  
**Page Types:** `decision`, `tradeoff`, `migration`  
**Contoh:**
```
Decision: "Use PostgreSQL"
  Body: "We chose PostgreSQL because..."
  DecisionStatus: ACTIVE
  DecisionStakeholders: ["David", "Alice"]
  Tags: ["database", "decision"]
```

### 5. **Meta Memory** (Self-Reflection)

**Apa itu:** Self-reflection, heuristics, learning patterns  
**Page Types:** `meta`  
**Contoh:**
```
Meta: "Debugging Heuristics"
  Body: "Always check edge cases first"
  Subtype: "debugging-heuristics"
  Tags: ["heuristics", "debugging"]
```

---

## 📚 WikiStore API

**WikiStore** adalah database graph yang nyimpan semua wiki pages.

### Constructor

```typescript
const wikiStore = new WikiStore();
```

### Methods

#### `createPage(opts: CreatePageOptions): Promise<WikiPage>`

Bikin halaman wiki baru.

```typescript
const page = await wikiStore.createPage({
  pageType: 'episode',
  label: 'JWT Bug Fix',
  body: 'Fixed JWT validation bug',
  tags: ['jwt', 'bugfix'],
  confidenceLevel: 'VERIFIED',
  episodeDate: Date.now(),
  episodeOutcome: 'RESOLVED',
});
```

#### `getPage(id: string): Promise<WikiPage | null>`

Ambil halaman berdasarkan ID.

```typescript
const page = await wikiStore.getPage('ep-1234567890-abc123');
```

#### `listAll(): Promise<WikiPage[]>`

Ambil semua halaman.

```typescript
const pages = await wikiStore.listAll();
```

#### `listByType(pageType: PageType): Promise<WikiPage[]>`

Ambil halaman berdasarkan tipe.

```typescript
const episodes = await wikiStore.listByType('episode');
const concepts = await wikiStore.listByType('concept');
```

#### `listByMemory(memory: MemorySystem): Promise<WikiPage[]>`

Ambil halaman berdasarkan sistem memori.

```typescript
const semantic = await wikiStore.listByMemory('semantic');
const episodic = await wikiStore.listByMemory('episodic');
```

#### `search(query: string, limit?: number, intent?: QueryIntent): Promise<SearchHit[]>`

Cari halaman dengan 5-memory routing.

```typescript
// "what is" query (prefer semantic memory)
const results = await wikiStore.search('what is JWT', 5, 'what');

// "how to" query (prefer structural memory)
const results = await wikiStore.search('how to implement JWT', 5, 'how');

// "why" query (prefer causal memory)
const results = await wikiStore.search('why use JWT', 5, 'why');
```

#### `refreshFreshness(id: string): Promise<void>`

Refresh freshness halaman.

```typescript
await wikiStore.refreshFreshness('ep-1234567890-abc123');
```

#### `getStalePages(): Promise<WikiPage[]>`

Ambil halaman yang stale (belum di-check lama).

```typescript
const stalePages = await wikiStore.getStalePages();
```

#### `clear(): Promise<void>`

Hapus semua data (buat testing).

```typescript
await wikiStore.clear();
```

---

## 🔧 WikiMemory Wrapper

**WikiMemory** adalah wrapper yang bikin WikiStore compatible dengan API lama (MemoryManager).

### Constructor

```typescript
const wikiMemory = new WikiMemory(wikiStore);
```

### Methods

#### `getStore(): WikiStore`

Ambil WikiStore yang ada di dalam.

```typescript
const store = wikiMemory.getStore();
```

#### `recordEpisode(content, metadata?, importance?): string`

Rekam episode (kejadian).

```typescript
const id = wikiMemory.recordEpisode(
  'Fixed JWT authentication bug',
  { tags: ['jwt', 'auth', 'bugfix'] },
  0.8  // importance (0-1)
);
```

**Mapping:**
- `recordEpisode()` → `createPage({ pageType: 'episode' })`
- `importance` → `confidenceLevel` (0.9+ = VERIFIED, 0.7+ = INFERRED, <0.7 = ASSUMED)

#### `recordPattern(name, description, pattern, examples?): void`

Rekam pattern (cara melakukan sesuatu).

```typescript
wikiMemory.recordPattern(
  'JWT Authentication Pattern',
  'How to implement JWT authentication',
  '1. Generate token\n2. Validate token\n3. Refresh token',
  ['Example 1', 'Example 2']
);
```

**Mapping:**
- `recordPattern()` → `createPage({ pageType: 'concept' })`

#### `saveProjectFact(key, value): void`

Simpan fakta project.

```typescript
wikiMemory.saveProjectFact('Tech Stack', 'TypeScript + Node.js + Express');
```

**Mapping:**
- `saveProjectFact()` → `createPage({ pageType: 'entity' })`

#### `recall(query, limit?): Promise<MemoryEntry[]>`

Ingat memories yang relevan dengan query.

```typescript
const memories = await wikiMemory.recall('what is JWT', 5);
```

**5-Memory Routing:**
- `"what is X"` → `intent: 'what'` → prefer **semantic** memory
- `"how to X"` → `intent: 'how'` → prefer **structural** memory
- `"why X"` → `intent: 'why'` → prefer **causal** memory
- `"when X"` → `intent: 'when'` → prefer **episodic** memory
- `"compare X vs Y"` → `intent: 'compare'` → prefer **semantic** memory
- `"pattern X"` → `intent: 'pattern'` → prefer **meta** memory
- `"history X"` → `intent: 'history'` → prefer **episodic** memory
- Default → `intent: 'unknown'` → all memories equally

**Support bilingual:**
- English: "what is", "how to", "why", "when", "compare", "pattern", "history"
- Indonesian: "apa itu", "gimana", "kenapa", "kapan", "bandingin", "pola", "riwayat"

---

## 🚀 Cara Pakai

### Basic Usage

```typescript
import { WikiStore } from './wllm/graph/wiki-store.js';
import { WikiMemory } from './engine/wiki-memory.js';

// Create WikiStore
const wikiStore = new WikiStore();

// Create WikiMemory wrapper
const wikiMemory = new WikiMemory(wikiStore);

// Record episode
wikiMemory.recordEpisode(
  'Fixed JWT authentication bug',
  { tags: ['jwt', 'auth', 'bugfix'] },
  0.8
);

// Record pattern
wikiMemory.recordPattern(
  'JWT Authentication Pattern',
  'How to implement JWT authentication',
  '1. Generate token\n2. Validate token\n3. Refresh token'
);

// Save project fact
wikiMemory.saveProjectFact('Tech Stack', 'TypeScript + Node.js + Express');

// Recall memories
const memories = await wikiMemory.recall('what is JWT', 5);
console.log(memories);
```

### Integrate with Engine

```typescript
import { Engine } from './engine/core.js';
import { WikiStore } from './wllm/graph/wiki-store.js';

// Create WikiStore
const wikiStore = new WikiStore();

// Create Engine with WikiStore (instead of MemoryManager)
const engine = new Engine(client, wikiStore, tools, sessions);

// Use engine normally
const response = await engine.process('fix the JWT bug');

// End session (triggers Evolve)
await engine.end();
```

---

## 🔍 Scheduled Lint

**LintScheduler** jalanin linter secara berkala untuk audit wiki.

### Features

✅ Configurable interval (default: 24 jam)  
✅ 7 checks: title, confidence, freshness, backlinks, tags, body, conflicts  
✅ Auto-fix issues yang bisa di-fix otomatis  
✅ Generate report card (grade A-F)  
✅ Track lint history  

### Usage

```typescript
import { WikiStore } from './wllm/graph/wiki-store.js';
import { LintScheduler } from './wllm/lint/scheduler.js';

// Create WikiStore
const wikiStore = new WikiStore();

// Create LintScheduler
const scheduler = new LintScheduler(wikiStore, {
  intervalMs: 24 * 60 * 60 * 1000,  // 24 jam
  autoFix: true,  // Auto-fix issues
  onLintComplete: (report) => {
    console.log(`Lint completed: ${report.summary.grade}`);
  },
});

// Start scheduler
scheduler.start();

// Run lint manually (optional)
const report = await scheduler.runLint();
console.log(`Grade: ${report.summary.grade}`);
console.log(`Issues: ${report.summary.totalIssues}`);

// Get lint history
const history = scheduler.getHistory(10);  // Last 10 runs

// Get latest report
const latestReport = scheduler.getLatestReport();

// Stop scheduler
scheduler.stop();
```

### 7 Lint Checks

1. **title** — Is the page label descriptive and non-empty?
2. **confidence** — Is the page's confidence level high enough?
3. **freshness** — Is the page still fresh, or has it gone stale?
4. **backlinks** — Does the page have incoming links from others?
5. **tags** — Does the page have at least one tag?
6. **body** — Is the body non-empty and meaningful?
7. **conflicts** — Does the page contradict another?

### Report Card

```typescript
const report = await scheduler.runLint();

console.log(report.summary);
// {
//   totalPages: 150,
//   totalIssues: 12,
//   bySeverity: { error: 2, warning: 5, info: 5 },
//   grade: 'B',  // A/B/C/D/F
//   score: 85,   // 0-100
// }
```

---

## 🧬 Evolve on Session End

**Evolver** jalan otomatis di akhir session untuk self-reflection.

### Features

✅ Find contradictions (halaman yang konflik)  
✅ Suggest new pages (coverage gaps)  
✅ Refresh stale pages (re-verification)  
✅ Auto-apply refresh (optional)  

### Usage

```typescript
import { WikiStore } from './wllm/graph/wiki-store.js';
import { Evolver } from './wllm/evolve/evolver.js';

// Create WikiStore
const wikiStore = new WikiStore();

// Create Evolver
const evolver = new Evolver(wikiStore);

// Run evolve
const report = await evolver.evolve({
  staleDays: 30,  // Pages older than 30 days are stale
  popularTagThreshold: 3,  // Tags with 3+ pages suggest new page
  autoApply: false,  // Auto-mark recheck suggestions
});

console.log(report.summary);
// {
//   totalPages: 150,
//   contradictionCount: 2,
//   suggestionCount: 5,
//   refreshCount: 3,
// }

// Check contradictions
for (const contradiction of report.contradictions) {
  console.log(`${contradiction.pageA.label} vs ${contradiction.pageB.label}`);
  console.log(`Reason: ${contradiction.reason}`);
  console.log(`Severity: ${contradiction.severity}`);
}

// Check suggestions
for (const suggestion of report.suggestions) {
  console.log(`Suggested page: ${suggestion.title}`);
  console.log(`Reason: ${suggestion.reason}`);
}

// Check refreshes
for (const refresh of report.refreshes) {
  console.log(`Stale page: ${refresh.page.label}`);
  console.log(`Days since check: ${refresh.daysSinceCheck}`);
}
```

### Automatic Evolve

Evolver jalan otomatis di `Engine.end()`:

```typescript
import { Engine } from './engine/core.js';
import { WikiStore } from './wllm/graph/wiki-store.js';

const wikiStore = new WikiStore();
const engine = new Engine(client, wikiStore, tools, sessions);

// Use engine...
await engine.process('fix the bug');

// End session (Evolver runs automatically)
await engine.end();
// [Engine] Running Evolver (self-reflection)...
// [Engine] Evolve completed:
//   Contradictions: 2
//   Suggestions: 5
//   Refreshes: 3
```

---

## 💡 Best Practices

### 1. Use Appropriate Confidence Levels

```typescript
// VERIFIED (0.9+) — Confirmed by tests or user
wikiMemory.recordEpisode('Tested JWT fix', {}, 0.95);

// INFERRED (0.7-0.9) — Deduced from patterns
wikiMemory.recordEpisode('Likely JWT issue', {}, 0.8);

// ASSUMED (<0.7) — Educated guess
wikiMemory.recordEpisode('Might be JWT problem', {}, 0.5);
```

### 2. Tag Everything

```typescript
wikiMemory.recordEpisode(
  'Fixed JWT bug',
  { 
    tags: ['jwt', 'auth', 'bugfix', 'backend'],  // Multiple tags
  },
  0.8
);
```

### 3. Use Descriptive Labels

```typescript
// ✅ Good
wikiMemory.saveProjectFact('JWT Authentication Flow', '...');

// ❌ Bad
wikiMemory.saveProjectFact('Auth', '...');
```

### 4. Refresh Pages Regularly

```typescript
// After verifying something works
await wikiStore.refreshFreshness(pageId);
```

### 5. Run Lint Periodically

```typescript
const scheduler = new LintScheduler(wikiStore, {
  intervalMs: 24 * 60 * 60 * 1000,  // Daily
  autoFix: true,
});
scheduler.start();
```

### 6. Resolve Contradictions

```typescript
const report = await evolver.evolve();

for (const contradiction of report.contradictions) {
  if (contradiction.severity === 'high') {
    // Resolve high-severity contradictions immediately
    await resolveContradiction(contradiction);
  }
}
```

---

## 📖 Contoh Penggunaan

### Example 1: Debugging Session

```typescript
import { Engine } from './engine/core.js';
import { WikiStore } from './wllm/graph/wiki-store.js';

const wikiStore = new WikiStore();
const engine = new Engine(client, wikiStore, tools, sessions);

// User asks to fix bug
await engine.process('fix the JWT authentication bug');

// Engine records episode automatically
// End session (triggers Evolve)
await engine.end();

// Later, ask about the fix
const memories = await wikiMemory.recall('how did we fix JWT', 5);
console.log(memories);  // Returns the debugging episode
```

### Example 2: Learning Patterns

```typescript
// After fixing multiple JWT bugs
wikiMemory.recordPattern(
  'JWT Authentication Debugging Pattern',
  'Common issues with JWT authentication',
  '1. Check token validation\n2. Verify expiration\n3. Check signature algorithm',
  ['JWT bug 1', 'JWT bug 2']
);

// Later, when facing similar bug
const memories = await wikiMemory.recall('pattern for JWT debugging', 5);
console.log(memories);  // Returns the pattern
```

### Example 3: Project Knowledge Base

```typescript
// Save project facts
wikiMemory.saveProjectFact('Tech Stack', 'TypeScript + Node.js + Express + PostgreSQL');
wikiMemory.saveProjectFact('Testing Framework', 'Vitest + Playwright');
wikiMemory.saveProjectFact('Deployment', 'Docker + Kubernetes');

// Later, ask about project
const memories = await wikiMemory.recall('what tech stack do we use', 5);
console.log(memories);  // Returns project facts
```

### Example 4: Decision Tracking

```typescript
// Record architectural decisions
await wikiStore.createPage({
  pageType: 'decision',
  label: 'Use PostgreSQL over MongoDB',
  body: 'We chose PostgreSQL because of ACID compliance and JSON support',
  tags: ['database', 'decision'],
  decisionStatus: 'ACTIVE',
  decisionStakeholders: ['David', 'Alice'],
  decisionTradeoffsAccepted: ['Less flexible schema'],
});

// Later, ask why
const memories = await wikiMemory.recall('why did we choose PostgreSQL', 5);
console.log(memories);  // Returns the decision
```

---

## 🔧 Troubleshooting

### Issue: "WikiStore not found"

**Solution:** Make sure you're passing WikiStore to Engine, not MemoryManager.

```typescript
// ❌ Wrong
const engine = new Engine(client, memoryManager, tools, sessions);

// ✅ Correct
const wikiStore = new WikiStore();
const engine = new Engine(client, wikiStore, tools, sessions);
```

### Issue: "5-memory routing not working"

**Solution:** Make sure you're using the right intent keywords.

```typescript
// ❌ Wrong
const results = await wikiMemory.recall('tell me about JWT', 5);

// ✅ Correct
const results = await wikiMemory.recall('what is JWT', 5);  // "what is" triggers intent detection
```

### Issue: "Evolver not running"

**Solution:** Make sure you're calling `engine.end()` at the end of the session.

```typescript
// ❌ Wrong
await engine.process('fix bug');
// Forgot to call end()

// ✅ Correct
await engine.process('fix bug');
await engine.end();  // Triggers Evolver
```

### Issue: "LintScheduler not starting"

**Solution:** Make sure you're calling `scheduler.start()`.

```typescript
// ❌ Wrong
const scheduler = new LintScheduler(wikiStore);
// Forgot to start

// ✅ Correct
const scheduler = new LintScheduler(wikiStore);
scheduler.start();
```

### Issue: "Pages not being created"

**Solution:** WikiMemory methods are async. Wait for them.

```typescript
// ❌ Wrong
wikiMemory.recordEpisode('Test', {}, 0.8);
const page = await wikiStore.getPage(id);  // Page not created yet

// ✅ Correct
wikiMemory.recordEpisode('Test', {}, 0.8);
await new Promise(resolve => setTimeout(resolve, 100));  // Wait for async creation
const page = await wikiStore.getPage(id);
```

---

## 📊 Phase 2 Completion Summary

### ✅ Completed (6/7)

1. ✅ **WikiStore Wired to Engine** — Backward compatible integration
2. ✅ **5-Memory Routing** — Intent-based search (what, how, why, when, compare, pattern, history)
3. ✅ **Scheduled Lint** — LintScheduler with 7 checks
4. ✅ **Evolve on Session End** — Automatic self-reflection
5. ✅ **Testing** — Comprehensive test suite (300+ lines)
6. ✅ **Documentation** — This guide (WLLMCONCEPT_GUIDE.md)

### ⏳ Remaining (1/7)

7. ⏳ **Auto-Ingest** — File watcher + content analysis (~2 weeks)

---

## 🎯 Next Steps

### Option 1: Complete Phase 2 (Auto-Ingest)

```
Auto-Ingest (~2 weeks):
├─ File watcher (chokidar)
├─ Content analyzer (extract entities/concepts)
├─ Automatic page creation/update
└─ Testing + documentation
```

### Option 2: Skip to Phase 3 (TUI Polish)

```
Phase 3: TUI Polish (2-3 weeks):
├─ Syntax highlighting
├─ Diff view (before/after)
├─ File tree visualization
└─ Progress indicators
```

### Option 3: Skip to Phase 4 (UX Polish)

```
Phase 4: UX Polish (2-3 weeks):
├─ Better error messages
├─ Smart autocomplete
├─ Clickable file paths
└─ Loading states
```

---

## 📚 Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md) — System architecture
- [USER_GUIDE.md](./USER_GUIDE.md) — User guide
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contributor guide
- [API_REFERENCE.md](./API_REFERENCE.md) — API reference

---

**WllmConcept: Making Huagent smarter over time! 🧠✨**
