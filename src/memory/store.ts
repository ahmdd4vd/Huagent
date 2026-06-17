// Persistent memory store using SQLite
// Hierarchical: hot (recent) → warm (summaries) → cold (archive)
// Types: episodic (events), semantic (facts), procedural (how-to), project (codebase)

import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MemoryEntry } from '../types/index.js';

export class MemoryStore {
  private db: Database.Database;
  private path: string;

  constructor(path: string) {
    this.path = path;
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding BLOB,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        importance REAL NOT NULL DEFAULT 0.5
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        pattern TEXT NOT NULL,
        examples TEXT NOT NULL DEFAULT '[]',
        use_count INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        source TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // Save a memory
  save(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessed' | 'accessCount'>): string {
    const id = nanoid();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, metadata, embedding, created_at, last_accessed, access_count, importance)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        entry.type,
        entry.content,
        JSON.stringify(entry.metadata),
        entry.embedding ? Buffer.from(new Float32Array(entry.embedding).buffer) : null,
        now,
        now,
        entry.importance
      );

    return id;
  }

  // Retrieve by ID
  get(id: string): MemoryEntry | null {
    const row = this.db
      .prepare('SELECT * FROM memories WHERE id = ?')
      .get(id) as any;

    if (!row) return null;

    // Update access stats
    this.db
      .prepare('UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?')
      .run(Date.now(), id);

    return this.rowToEntry(row);
  }

  // Search by content (simple LIKE for now, upgrade to FTS5/embeddings later)
  search(query: string, options: { type?: string; limit?: number } = {}): MemoryEntry[] {
    // Use ?? instead of || so that `limit: 0` is respected (returns 0
    // results instead of falling back to 10). The previous code treated
    // `limit: 0` as falsy and returned 10 results.
    const limit = options.limit ?? 10;
    const type = options.type;

    let sql = `SELECT * FROM memories WHERE content LIKE ?`;
    const params: any[] = [`%${query}%`];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY importance DESC, last_accessed DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  // Get most important recent memories
  recent(limit = 20): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories ORDER BY last_accessed DESC, importance DESC LIMIT ?`
      )
      .all(limit) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  // Get by type
  byType(type: string, limit = 20): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories WHERE type = ? ORDER BY importance DESC, created_at DESC LIMIT ?`
      )
      .all(type, limit) as any[];
    return rows.map((r) => this.rowToEntry(r));
  }

  // Save a project fact (e.g., "uses TypeScript", "tests in vitest")
  saveFact(key: string, value: string, source = 'user', confidence = 1.0): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO facts (id, key, value, source, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           source = excluded.source,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at`
      )
      .run(nanoid(), key, value, source, confidence, now, now);
  }

  // Get all facts (project context)
  getFacts(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM facts').all() as any[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // Save a learned skill/pattern
  saveSkill(name: string, description: string, pattern: string, examples: any[] = []): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, pattern, examples, use_count, success_rate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 1.0, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           description = excluded.description,
           pattern = excluded.pattern,
           examples = excluded.examples,
           updated_at = excluded.updated_at`
      )
      .run(nanoid(), name, description, pattern, JSON.stringify(examples), now, now);
  }

  // Get a skill
  getSkill(name: string): { name: string; description: string; pattern: string; examples: any[] } | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as any;
    if (!row) return null;

    // Increment use count
    this.db.prepare('UPDATE skills SET use_count = use_count + 1 WHERE name = ?').run(name);

    return {
      name: row.name,
      description: row.description,
      pattern: row.pattern,
      examples: JSON.parse(row.examples),
    };
  }

  // List all skills
  listSkills(): Array<{ name: string; description: string; useCount: number; successRate: number }> {
    const rows = this.db
      .prepare('SELECT name, description, use_count, success_rate FROM skills ORDER BY use_count DESC')
      .all() as any[];
    return rows.map((r) => ({
      name: r.name,
      description: r.description,
      useCount: r.use_count,
      successRate: r.success_rate,
    }));
  }

  // Record a session
  startSession(projectPath: string): string {
    const id = nanoid();
    this.db
      .prepare('INSERT INTO sessions (id, project_path, start_time) VALUES (?, ?, ?)')
      .run(id, projectPath, Date.now());
    return id;
  }

  endSession(id: string, summary: string): void {
    this.db
      .prepare('UPDATE sessions SET end_time = ?, summary = ? WHERE id = ?')
      .run(Date.now(), summary, id);
  }

  // Get session history
  getSessions(limit = 10): Array<{ id: string; projectPath: string; startTime: number; summary?: string }> {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectPath: r.project_path,
      startTime: r.start_time,
      summary: r.summary,
    }));
  }

  // Stats
  stats() {
    const memCount = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c;
    const factCount = (this.db.prepare('SELECT COUNT(*) as c FROM facts').get() as any).c;
    const skillCount = (this.db.prepare('SELECT COUNT(*) as c FROM skills').get() as any).c;
    const sessionCount = (this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c;

    return {
      memories: memCount,
      facts: factCount,
      skills: skillCount,
      sessions: sessionCount,
    };
  }

  // Compress old memories into summaries
  compress(olderThan: number): number {
    // Archive old, low-importance memories
    const cutoff = Date.now() - olderThan;
    const result = this.db
      .prepare('DELETE FROM memories WHERE last_accessed < ? AND importance < 0.3')
      .run(cutoff);
    return result.changes;
  }

  close() {
    this.db.close();
  }

  private rowToEntry(row: any): MemoryEntry {
    // CRITICAL: better-sqlite3 may return a Buffer that is a view into a
    // larger pool ArrayBuffer. Using `new Float32Array(buf.buffer)` reads
    // the ENTIRE underlying ArrayBuffer, not just the Buffer's bytes —
    // producing garbage past the BLOB's end. We must respect byteOffset
    // and byteLength.
    let embedding: number[] | undefined;
    if (row.embedding) {
      const buf = row.embedding as Buffer;
      embedding = Array.from(
        new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)),
      );
    }
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      embedding,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      importance: row.importance,
    };
  }
}
