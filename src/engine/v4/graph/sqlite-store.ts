/**
 * v4/graph/sqlite-store.ts
 *
 * SQLite-backed implementation of GraphStore.
 * Uses better-sqlite3 for stability (synchronous API).
 *
 * Schema:
 *   nodes(id, kind, label, body, properties, valid_from, valid_to, recorded_at, confidence, search_text)
 *   edges(id, from_node, to_node, kind, weight, properties, valid_from, valid_to, recorded_at, confidence)
 *   nodes_search(node_id, search_text)  -- FTS5 virtual table for full-text search
 *
 * Bi-temporal preservation: we keep ALL versions of a node/edge.
 * The "current" version is the one with valid_to IS NULL.
 * Time-travel queries use valid_from <= asOf AND (valid_to IS NULL OR valid_to > asOf).
 */

import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GraphStore } from "./store.js";
import type { GraphNode, GraphEdge, GraphQuery, GraphResult } from "./types.js";
import type { CausalEdgeKind } from "../stream/cognitive-event.js";

export interface SqliteStoreOptions {
  /** File path for the SQLite database. Use ':memory:' for in-memory. */
  path: string;
  /** Whether to enable WAL mode (faster writes, better concurrency). Default: true */
  wal?: boolean;
}

/**
 * SQLite-backed graph store.
 */
export class SqliteGraphStore implements GraphStore {
  private db: Database.Database;
  /** Tracks whether FTS5 virtual table was successfully created. */
  private ftsAvailable: boolean = false;

  constructor(opts: SqliteStoreOptions) {
    if (opts.path !== ":memory:") {
      const dir = dirname(opts.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(opts.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  private init() {
    // Main tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        body TEXT,
        properties TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        recorded_at INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (id, valid_from)
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT NOT NULL,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        kind TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        properties TEXT,
        valid_from INTEGER NOT NULL,
        valid_to INTEGER,
        recorded_at INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (id, valid_from)
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
      CREATE INDEX IF NOT EXISTS idx_nodes_label ON nodes(label);
      CREATE INDEX IF NOT EXISTS idx_nodes_valid ON nodes(valid_from, valid_to);
      CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node);
      CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node);
      CREATE INDEX IF NOT EXISTS idx_edges_valid ON edges(valid_from, valid_to);
    `);

    // FTS5 for full-text search (if available)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          node_id UNINDEXED,
          label,
          body
        );
      `);
      this.ftsAvailable = true;
    } catch (e) {
      // FTS5 not available, fallback to LIKE search
      this.ftsAvailable = false;
      console.warn("FTS5 not available, using LIKE fallback");
    }
  }

  async addNode(node: Omit<GraphNode, "id" | "recordedAt"> & { id?: string }): Promise<GraphNode> {
    const fullNode: GraphNode = {
      ...node,
      id: node.id || randomUUID(),
      recordedAt: Date.now(),
    };
    this.insertNode(fullNode);
    return fullNode;
  }

  private insertNode(n: GraphNode) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (id, kind, label, body, properties, valid_from, valid_to, recorded_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      n.id,
      n.kind,
      n.label,
      n.body ?? null,
      JSON.stringify(n.properties ?? {}),
      n.validFrom,
      n.validTo,
      n.recordedAt,
      n.confidence
    );
    // Update FTS (only if FTS5 is available — otherwise this is a no-op
    // and search falls back to LIKE).
    if (this.ftsAvailable) {
      try {
        const fts = this.db.prepare(`
          INSERT INTO nodes_fts (node_id, label, body) VALUES (?, ?, ?)
        `);
        fts.run(n.id, n.label, n.body ?? "");
      } catch (e) {
        // ignore FTS errors
      }
    }
  }

  async addEdge(edge: Omit<GraphEdge, "id" | "recordedAt"> & { id?: string }): Promise<GraphEdge> {
    // Validate nodes exist (current versions)
    const fromExists = this.db.prepare(`SELECT 1 FROM nodes WHERE id = ? AND valid_to IS NULL LIMIT 1`).get(edge.fromNode);
    if (!fromExists) throw new Error(`Graph: cannot add edge, from-node ${edge.fromNode} does not exist`);
    const toExists = this.db.prepare(`SELECT 1 FROM nodes WHERE id = ? AND valid_to IS NULL LIMIT 1`).get(edge.toNode);
    if (!toExists) throw new Error(`Graph: cannot add edge, to-node ${edge.toNode} does not exist`);

    const fullEdge: GraphEdge = {
      ...edge,
      id: edge.id || randomUUID(),
      recordedAt: Date.now(),
    };
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (id, from_node, to_node, kind, weight, properties, valid_from, valid_to, recorded_at, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      fullEdge.id,
      fullEdge.fromNode,
      fullEdge.toNode,
      fullEdge.kind,
      fullEdge.weight,
      JSON.stringify(fullEdge.properties ?? {}),
      fullEdge.validFrom,
      fullEdge.validTo,
      fullEdge.recordedAt,
      fullEdge.confidence
    );
    return fullEdge;
  }

  async getNode(id: string, asOf?: number): Promise<GraphNode | null> {
    let row: any;
    if (asOf !== undefined) {
      row = this.db.prepare(`
        SELECT * FROM nodes WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        ORDER BY valid_from DESC LIMIT 1
      `).get(id, asOf, asOf);
    } else {
      row = this.db.prepare(`SELECT * FROM nodes WHERE id = ? AND valid_to IS NULL`).get(id);
    }
    if (!row) return null;
    return this.rowToNode(row);
  }

  async getEdge(id: string, asOf?: number): Promise<GraphEdge | null> {
    let row: any;
    if (asOf !== undefined) {
      row = this.db.prepare(`
        SELECT * FROM edges WHERE id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        ORDER BY valid_from DESC LIMIT 1
      `).get(id, asOf, asOf);
    } else {
      row = this.db.prepare(`SELECT * FROM edges WHERE id = ? AND valid_to IS NULL`).get(id);
    }
    if (!row) return null;
    return this.rowToEdge(row);
  }

  async updateNode(id: string, patch: Partial<GraphNode>, newValidFrom: number = Date.now()): Promise<GraphNode | null> {
    const current = await this.getNode(id);
    if (!current) return null;

    // Close current version
    this.db.prepare(`UPDATE nodes SET valid_to = ? WHERE id = ? AND valid_to IS NULL`).run(newValidFrom, id);

    // Create new version
    const next: GraphNode = {
      ...current,
      ...patch,
      id: current.id,
      validFrom: newValidFrom,
      validTo: null,
      recordedAt: Date.now(),
    };
    this.insertNode(next);
    return next;
  }

  async query(q: GraphQuery): Promise<GraphResult> {
    const asOf = q.asOf ?? Date.now();
    const maxDepth = q.maxDepth ?? 3;
    const direction = q.direction ?? "both";
    const limit = q.limit ?? 100;

    // BFS
    const visitedNodes = new Map<string, GraphNode>();
    const visitedEdges = new Map<string, GraphEdge>();
    const paths: GraphResult["paths"] = [];
    const queue: Array<{ nodeId: string; path: string[]; edgeKinds: CausalEdgeKind[] }> = [];

    // Seed
    if (q.from && q.from.length > 0) {
      for (const startId of q.from) {
        const startNode = await this.getNode(startId, asOf);
        if (startNode) {
          visitedNodes.set(startId, startNode);
          queue.push({ nodeId: startId, path: [startId], edgeKinds: [] });
        }
      }
    } else {
      // Start from all current nodes
      const rows = this.db.prepare(`
        SELECT * FROM nodes WHERE valid_to IS NULL
        LIMIT ?
      `).all(limit);
      for (const row of rows) {
        const n = this.rowToNode(row);
        visitedNodes.set(n.id, n);
      }
    }

    // BFS
    while (queue.length > 0 && visitedNodes.size < limit) {
      const { nodeId, path, edgeKinds } = queue.shift()!;
      if (path.length > maxDepth) continue;

      let edgeRows: any[] = [];
      if (direction === "out" || direction === "both") {
        const rows = this.db.prepare(`
          SELECT * FROM edges WHERE from_node = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        `).all(nodeId, asOf, asOf);
        edgeRows = edgeRows.concat(rows);
      }
      if (direction === "in" || direction === "both") {
        const rows = this.db.prepare(`
          SELECT * FROM edges WHERE to_node = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
        `).all(nodeId, asOf, asOf);
        edgeRows = edgeRows.concat(rows);
      }

      for (const row of edgeRows) {
        const e = this.rowToEdge(row);
        if (q.via && q.via.length > 0 && !q.via.includes(e.kind)) continue;
        visitedEdges.set(e.id, e);
        const nextId = e.fromNode === nodeId ? e.toNode : e.fromNode;
        if (visitedNodes.has(nextId)) continue;
        const nextNode = await this.getNode(nextId, asOf);
        if (!nextNode) continue;
        if (q.nodeKind && !q.nodeKind.includes(nextNode.kind)) continue;
        visitedNodes.set(nextId, nextNode);
        paths.push({ from: path[0], to: nextId, hops: [...path, nextId], edgeKinds: [...edgeKinds, e.kind] });
        queue.push({ nodeId: nextId, path: [...path, nextId], edgeKinds: [...edgeKinds, e.kind] });
      }
    }

    return {
      nodes: Array.from(visitedNodes.values()),
      edges: Array.from(visitedEdges.values()),
      paths,
    };
  }

  async search(text: string, limit: number = 20): Promise<GraphNode[]> {
    const t = text.toLowerCase();
    // Try FTS5 first (only if available — the previous code always
    // tried FTS, which threw `no such table: nodes_fts` on systems
    // where FTS5 wasn't compiled into better-sqlite3).
    if (this.ftsAvailable) {
      try {
        const ftsRows = this.db.prepare(`
          SELECT n.* FROM nodes n
          JOIN nodes_fts f ON f.node_id = n.id
          WHERE nodes_fts MATCH ? AND n.valid_to IS NULL
          LIMIT ?
        `).all(text + "*", limit);
        if (ftsRows.length > 0) {
          return ftsRows.map(r => this.rowToNode(r));
        }
      } catch (e) {
        // FTS query failed (e.g. malformed MATCH syntax) — fall through to LIKE.
      }
    }

    // LIKE fallback
    const like = `%${t}%`;
    const rows = this.db.prepare(`
      SELECT * FROM nodes
      WHERE valid_to IS NULL
        AND (LOWER(label) LIKE ? OR LOWER(COALESCE(body, '')) LIKE ?)
      LIMIT ?
    `).all(like, like, limit);
    return rows.map(r => this.rowToNode(r));
  }

  async count(): Promise<{ nodes: number; edges: number }> {
    const nodes = (this.db.prepare(`SELECT COUNT(*) as c FROM nodes WHERE valid_to IS NULL`).get() as any).c;
    const edges = (this.db.prepare(`SELECT COUNT(*) as c FROM edges WHERE valid_to IS NULL`).get() as any).c;
    return { nodes, edges };
  }

  async clear(): Promise<void> {
    // CRITICAL: Only delete from nodes_fts if FTS5 was successfully
    // created at init time. If FTS5 was unavailable, the nodes_fts
    // table doesn't exist and `DELETE FROM nodes_fts` throws
    // `SQLITE_ERROR: no such table: nodes_fts`, crashing the caller.
    if (this.ftsAvailable) {
      this.db.exec(`DELETE FROM nodes_fts; DELETE FROM nodes; DELETE FROM edges;`);
    } else {
      this.db.exec(`DELETE FROM nodes; DELETE FROM edges;`);
    }
  }

  /** Close the database. Call this when done. */
  close(): void {
    this.db.close();
  }

  /** Get the raw database handle (for tests/inspection). */
  get rawDb(): Database.Database {
    return this.db;
  }

  private rowToNode(row: any): GraphNode {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      body: row.body ?? undefined,
      properties: JSON.parse(row.properties ?? "{}"),
      validFrom: row.valid_from,
      validTo: row.valid_to,
      recordedAt: row.recorded_at,
      confidence: row.confidence,
    };
  }

  private rowToEdge(row: any): GraphEdge {
    return {
      id: row.id,
      fromNode: row.from_node,
      toNode: row.to_node,
      kind: row.kind,
      weight: row.weight,
      properties: JSON.parse(row.properties ?? "{}"),
      validFrom: row.valid_from,
      validTo: row.valid_to,
      recordedAt: row.recorded_at,
      confidence: row.confidence,
    };
  }
}
