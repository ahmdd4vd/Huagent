# 🧠 Engine v2.0 — Smart Workflow Guide

## Apa Bedanya Sama Engine Biasa?

**Engine biasa (single-pass):**
```
User Input → LLM → Output
```
Masalah: LLM "b aja" sering:
- Lupa context
- Output ngalor-ngidul
- Gak tau tools apa aja
- Gak bisa koreksi diri
- Ngulang kesalahan yang sama

**Engine huagent v2.0 (6-stage):**
```
User Input
   ↓
1. 🧠 UNDERSTAND (parse intent)
   ↓
2. 🗺️ PLAN (decompose + plan with tools)
   ↓
3. ⚡ EXECUTE (run with hooks)
   ↓
4. ✅ VERIFY (5-dimension critic)
   ↓
5. 🔄 REFINE (loop max 3x kalau ada issue)
   ↓
6. 💡 REFLECT (learn from outcome)
   ↓
Output + Memory Updated
```

## Penjelasan Tiap Stage

### Stage 1: 🧠 UNDERSTAND (Ngertiin)
**Tujuan:** Tau user beneran mau apa.

Output:
```typescript
{
  taskType: 'code_write' | 'code_read' | 'code_fix' | 'code_refactor' | 'question' | 'research' | 'action',
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex',
  needsSubagent: boolean
}
```

Cara kerja:
- Deteksi keyword (`fix` → code_fix, `buat` → code_write, dll)
- Estimate complexity dari panjang & keyword
- Decide perlu subagent atau enggak
- Recall memory yang relevan

**Contoh:**
- "halo" → taskType=question, complexity=trivial, needsSubagent=false
- "fix bug di login" → taskType=code_fix, complexity=moderate, needsSubagent=false
- "research best practices untuk authentication" → taskType=research, complexity=complex, needsSubagent=true

### Stage 2: 🗺️ PLAN (Ngepecah)
**Tujuan:** Bikin step-by-step plan yang jelas.

Output JSON:
```json
{
  "goal": "Fix the login bug in auth.ts",
  "complexity": "moderate",
  "taskType": "code_fix",
  "steps": [
    { "id": 1, "tool": "search_files", "args": {"pattern": "login"}, "parallel_group": 0 },
    { "id": 2, "tool": "read", "args": {"path": "auth.ts"}, "parallel_group": 1, "depends_on": [1] },
    { "id": 3, "tool": null, "args": {}, "parallel_group": 2, "depends_on": [2] },
    { "id": 4, "tool": "edit", "args": { "path": "auth.ts", ... }, "parallel_group": 3, "depends_on": [3] },
    { "id": 5, "tool": "bash", "args": { "command": "npm test" }, "parallel_group": 4, "depends_on": [4] }
  ]
}
```

Cara kerja:
- Kirim list available tools ke planner LLM
- Planner ngeluarin JSON strict
- Kami parse & validate
- Steps yang independent dikasih `parallel_group` sama → jalan bareng

**Kenapa powerful:**
- Tools eksplisit (gak ngarang tool yang gak ada)
- Args realistis (path exist, command valid)
- Bisa parallel (hemat waktu)
- Minimal untuk task trivial (gak over-decompose)

### Stage 3: ⚡ EXECUTE (Jalanin)
**Tujuan:** Run plan dengan safety & visibility.

Cara kerja:
1. Group steps by `parallel_group`
2. Steps dalam 1 group jalan paralel
3. Tiap step:
   - Fire `PreToolUse` hook
   - Permission check (sesuai mode: read-only, workspace-write, dll)
   - Run tool
   - Fire `PostToolUse` hook
   - Stream result ke UI

**Hooks yang fire:**
- `PreToolUse` — sebelum tool jalan
- `PostToolUse` — setelah tool selesai
- Subagent events kalau ada parallel agent

### Stage 4: ✅ VERIFY (Koreksi)
**Tujuan:** Cek hasil, kasih verdict.

5-dimension scoring (1-5 each):
- **Correctness** — Apakah hasilnya bener? Ada bug?
- **Completeness** — Semua requirement ke-cover?
- **Quality** — Clean code? Maintainable?
- **Safety** — Gak ngehancurin apa-apa? No security issue?
- **Efficiency** — Gak boros?

Verdict logic:
- **PASS** (overall ≥ 4.0) → lanjut
- **REFINE** (overall 2.5-4.0) → masuk Stage 5
- **FAIL** (overall < 2.5) → kasih tau user

**Output:**
```json
{
  "scores": { "correctness": 5, "completeness": 5, "quality": 5, "safety": 5, "efficiency": 5 },
  "overall": 5.0,
  "verdict": "pass",
  "issues": [],
  "suggestions": [],
  "feedback": "The implementation is clean and complete..."
}
```

### Stage 5: 🔄 REFINE (Perbaiki)
**Tujuan:** Fix yang gagal/refine.

Loop max 3x:
1. Cari step yang status=failed atau ada issue dari critic
2. Re-execute step itu
3. Re-verify
4. Kalo masih fail, loop lagi (max 3x)

Kalo max retries → kasih tau user masalahnya.

### Stage 6: 💡 REFLECT (Belajar)
**Tujuan:** Update memory biar makin pintar.

Yang disimpan:
- Episode (event): "User minta X, gw jawab Y, score Z"
- Procedural pattern (kalo score ≥ 4.5): "Pattern buat code_write: 1) think, 2) write, 3) verify"
- Anti-pattern (kalo fail): "Avoid: ..."

Next time user minta hal yang sama, agent bisa recall lesson-nya.

## Kenapa Bikin Model "B aja" Jadi Pintar?

| Problem | Solution |
|---|---|
| **Ngaco output** | Stage 2 PLAN → decompose jadi step kecil |
| **Lupa context** | Stage 6 REFLECT → save ke memory |
| **Gak tau tools** | Stage 2 kirim list tools ke planner |
| **Gak bisa koreksi diri** | Stage 4 CRITIC kasih verdict |
| **Ngulang mistake** | Stage 6 save anti-pattern |
| **Lambat** | Parallel groups di Stage 3 |
| **Over-engineering** | Complexity detection → trivial tasks skip planning |

## Visual Stage Tracking

Di TUI, tiap stage nampilin box:
```
[⏳ 🧠 UNDERSTAND]    [✓ 🧠 UNDERSTAND]
[⏳ 🗺️ PLAN: 5 steps]  [✓ 🗺️ PLAN]
[⏳ ⚡ EXECUTE]       [✓ ⚡ EXECUTE]
[⏳ ✅ VERIFY]        [✓ ✅ VERIFY: PASS 4.5/5]
                      [✓ 💡 REFLECT]
```

Lo bisa **track progress real-time** dan **liat verdict tiap task**.

## Real Test Result

```
═══ Testing 6-Stage Engine ═══

  🧠 UNDERSTAND [start]
  🧠 Task: code_write | Complexity: moderate | Subagent: no | Memories: 0
  🧠 UNDERSTAND [end]
  🗺️ PLAN [start]
  Plan: 1 steps, moderate
  🗺️ Plan: 1 steps | moderate | code_write
  🗺️ PLAN [end]: 1 steps
  ⚡ EXECUTE [start]
  ✓ Write the file /tmp/hello.txt with the specified content (2ms)
  ⚡ EXECUTE [end]
  ✅ VERIFY [start]
  Verdict: PASS (5.0/5)
  ✅ Verify: PASS (score 5.0/5)
  ✅ VERIFY [end]
  💡 REFLECT [start]
  💡 Extracted pattern for code_write
  💡 REFLECT [end]

✨ Plan executed: Create a file /tmp/hello.txt with content "Hello from huagent engine"
✓ 1. Write the file /tmp/hello.txt with the specified content (2ms)
✨ Score: 5.0/5 (pass)
```

## File Locations

- `src/engine/core.ts` — orchestrator utama
- `src/engine/planner.ts` — specialized planner
- `src/engine/critic.ts` — specialized critic
- `src/engine/reflector.ts` — self-learning
- `src/engine/WORKFLOW.md` — dokumentasi ini
- `src/tui/App.tsx` — visual display untuk tiap stage

## Tuning Options

```typescript
new Engine(client, memory, tools, sessions, {
  maxRefinements: 3,      // max retry loop
  enableCritic: true,     // ON/OFF verification
  enablePlanning: true,   // ON/OFF planning stage
  enableSubagents: true,  // ON/OFF subagent
  enableReflection: true, // ON/OFF learning
  maxSteps: 15,           // max steps per plan
});
```
