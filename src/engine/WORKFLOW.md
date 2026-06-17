# ✦ Smart Engine Workflow ✦

Engine huagent v2.0 pakai **6-stage workflow** yang bikin model "b aja" jadi pintar.

## Visual Map

```
User Input
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 1: 🧠 UNDERSTAND                                 │
│ - Parse apa yang user beneran mau                      │
│ - Deteksi tipe task (code, qa, research, action)       │
│ - Recall memory yang relevan                            │
│ - Decide: perlu gak subagent explore dulu?              │
└─────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 2: 🗺️ PLAN                                       │
│ - Generate structured plan (JSON)                      │
│ - Pilih tools yang tepat                                │
│ - Detect dependencies antar step                        │
│ - Group independent steps buat parallelism              │
└─────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 3: ⚡ EXECUTE                                     │
│ - Run steps (parallel kalo bisa)                        │
│ - Hooks fire di setiap step (PreTool, PostTool)         │
│ - Permission check sebelum eksekusi                    │
│ - Stream output real-time                               │
└─────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 4: ✅ VERIFY (Critic)                            │
│ - Cek hasil vs goal                                     │
│ - 5 dimensi: correctness, completeness, quality,       │
│   safety, efficiency                                    │
│ - VERDICT: pass | refine | fail                         │
└─────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 5: 🔄 REFINE (jika VERDICT = refine)            │
│ - Looping max 3x                                       │
│ - Perbaiki step yang gagal                              │
│ - Re-execute step spesifik                              │
│ - Re-verify                                             │
└─────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────┐
│ STAGE 6: 💡 REFLECT & LEARN                            │
│ - Catat episode ke memory                               │
│ - Extract lessons learned                               │
│ - Update semantic memory kalo ada insight baru          │
│ - Simpan procedural pattern kalo reusable               │
│ - Emit response final ke user                            │
└─────────────────────────────────────────────────────────┘
   │
   ▼
Final Response
```

## Kenapa Workflow Ini Bikin Model Pintar?

### 1. **Decomposition** (Pecah masalah)
Model kecil sering gagal karena ngerjain semua sekaligus. Kita pecah jadi step kecil yang manageable.

### 2. **Tool-Awareness** (Tau tools apa aja)
Planner kasih JSON yang reference tool names yang exist. Jadi gak ngarang tool yang gak ada.

### 3. **Self-Critique** (Koreksi sendiri)
Critic punya 5-dimension rubric. Kalo pass = ship. Kalo refine = loop. Kalo fail = minta klarifikasi.

### 4. **Memory Recall** (Gak mulai dari nol)
Tiap interaksi recall memory yang relevan. Lama-lama makin kenal style lo.

### 5. **Reflective Learning** (Belajar dari error)
Episode yang gagal disimpan, biar next time gak ngulang mistake yang sama.

### 6. **Parallel Execution** (Cepat)
Independent steps jalan bareng, hemat waktu.

## Stage Details

### Stage 1: UNDERSTAND
```typescript
TaskType = 'code_write' | 'code_read' | 'code_fix' | 'question' | 'research' | 'action' | 'unknown'
```

### Stage 2: PLAN
Output JSON schema:
```json
{
  "goal": "the actual goal",
  "complexity": "trivial" | "simple" | "moderate" | "complex",
  "steps": [
    {
      "id": 1,
      "description": "what to do",
      "tool": "tool_name",
      "args": { ... },
      "depends_on": [],
      "parallel_group": 0
    }
  ]
}
```

### Stage 4: CRITIC
5-dimension scoring (1-5 each):
- **Correctness** — kode bener gak?
- **Completeness** — semua requirement ke-cover gak?
- **Quality** — clean, maintainable, secure?
- **Safety** — gak ngehancurin apa-apa?
- **Efficiency** — gak boros resource?

### Stage 5: REFINE
Loop max 3x. Per step yang failed/refine:
1. Diagnose root cause
2. Generate alternative approach
3. Re-execute
4. Re-verify
