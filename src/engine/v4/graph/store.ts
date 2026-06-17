/**
 * v4/graph/store.ts
 *
 * The graph store: SQLite-shaped interface with bi-temporal validity.
 *
 * Implementation: In-process Map-based store for v4.0.
 * Trade-offs:
 * - No persistence: lost on restart. Add SQLite backend if needed.
 * - No FTS5: search is a simple substring match.
 * - Fast: O(1) lookup by id, O(n) for queries (acceptable for n<10K).
 *
 * Bi-temporal schema:
 *   nodes(id, kind, label, body, properties, valid_from, valid_to, recorded_at, confidence)
 *   edges(id, from_node, to_node, kind, weight, properties, valid_from, valid_to, recorded_at, confidence)
 *
 * Implementation detail for bi-temporal:
 *   - We keep ALL versions of a node, indexed by composite key `${id}@${validFrom}`.
 *   - `currentIdIndex` maps id → key of the currently valid version.
 *   - `versionIndex` maps id → sorted list of validFrom timestamps.
 *   - This way, time-travel queries find the right version, and history is preserved.
 */

import { randomUUID } from "node:crypto";
import type { GraphNode, GraphEdge, GraphQuery, GraphResult, GraphNodeKind } from "./types.js";
import type { CausalEdgeKind } from "../stream/cognitive-event.js";

/**
 * Minimal SQLite interface. We use the built-in `node:sqlite` if available
 * (Node 22+), otherwise the caller can pass better-sqlite3.
 */
export interface GraphStore {
  addNode(node: Omit<GraphNode, "id" | "recordedAt">): Promise<GraphNode>;
  addEdge(edge: Omit<GraphEdge, "id" | "recordedAt">): Promise<GraphEdge>;
  getNode(id: string, asOf?: number): Promise<GraphNode | null>;
  getEdge(id: string, asOf?: number): Promise<GraphEdge | null>;
  updateNode(id: string, patch: Partial<GraphNode>, newValidFrom?: number): Promise<GraphNode | null>;
  query(q: GraphQuery): Promise<GraphResult>;
  search(text: string, limit?: number): Promise<GraphNode[]>;
  count(): Promise<{ nodes: number; edges: number }>;
  clear(): Promise<void>;
}

/**
 * In-process Map-based graph store with proper bi-temporal support.
 */
export class InMemoryGraphStore implements GraphStore {
  /** All node versions, keyed by `${id}@${validFrom}` */
  private nodes = new Map<string, GraphNode>();
  /** All edge versions, keyed by `${id}@${validFrom}` */
  private edges = new Map<string, GraphEdge>();
  /** id → key of current (latest valid) version */
  private currentNodeIndex = new Map<string, string>();
  /** id → key of current (latest valid) version */
  private currentEdgeIndex = new Map<string, string>();
  /** id → sorted list of validFrom timestamps (ascending) */
  private nodeVersions = new Map<string, number[]>();
  /** id → sorted list of validFrom timestamps (ascending) */
  private edgeVersions = new Map<string, number[]>();
  /** Adjacency: nodeId → set of edge keys */
  private outAdj = new Map<string, Set<string>>();
  private inAdj = new Map<string, Set<string>>();

  private makeKey(id: string, validFrom: number): string {
    return `${id}@${validFrom}`;
  }

  async addNode(node: Omit<GraphNode, "id" | "recordedAt"> & { id?: string }): Promise<GraphNode> {
    const fullNode: GraphNode = {
      ...node,
      id: node.id || randomUUID(),
      recordedAt: Date.now(),
    };
    const key = this.makeKey(fullNode.id, fullNode.validFrom);
    this.nodes.set(key, fullNode);
    this.currentNodeIndex.set(fullNode.id, key);
    if (!this.nodeVersions.has(fullNode.id)) this.nodeVersions.set(fullNode.id, []);
    this.nodeVersions.get(fullNode.id)!.push(fullNode.validFrom);
    if (!this.outAdj.has(fullNode.id)) this.outAdj.set(fullNode.id, new Set());
    if (!this.inAdj.has(fullNode.id)) this.inAdj.set(fullNode.id, new Set());
    return fullNode;
  }

  async addEdge(edge: Omit<GraphEdge, "id" | "recordedAt"> & { id?: string }): Promise<GraphEdge> {
    // Validate nodes exist
    if (!this.currentNodeIndex.has(edge.fromNode)) {
      throw new Error(`Graph: cannot add edge, from-node ${edge.fromNode} does not exist`);
    }
    if (!this.currentNodeIndex.has(edge.toNode)) {
      throw new Error(`Graph: cannot add edge, to-node ${edge.toNode} does not exist`);
    }
    const fullEdge: GraphEdge = {
      ...edge,
      id: edge.id || randomUUID(),
      recordedAt: Date.now(),
    };
    const key = this.makeKey(fullEdge.id, fullEdge.validFrom);
    this.edges.set(key, fullEdge);
    this.currentEdgeIndex.set(fullEdge.id, key);
    if (!this.edgeVersions.has(fullEdge.id)) this.edgeVersions.set(fullEdge.id, []);
    this.edgeVersions.get(fullEdge.id)!.push(fullEdge.validFrom);
    this.outAdj.get(edge.fromNode)!.add(key);
    this.inAdj.get(edge.toNode)!.add(key);
    return fullEdge;
  }

  async getNode(id: string, asOf?: number): Promise<GraphNode | null> {
    if (asOf !== undefined) {
      // Find version valid at asOf
      const versions = this.nodeVersions.get(id);
      if (!versions || versions.length === 0) return null;
      // Iterate from latest to earliest, find first that isValidAt
      const sortedDesc = [...versions].sort((a, b) => b - a);
      for (const vf of sortedDesc) {
        const v = this.nodes.get(this.makeKey(id, vf));
        if (v && this.isValidAt(v, asOf)) return v;
      }
      return null;
    }
    // Get current
    const key = this.currentNodeIndex.get(id);
    if (!key) return null;
    return this.nodes.get(key) ?? null;
  }

  async getEdge(id: string, asOf?: number): Promise<GraphEdge | null> {
    if (asOf !== undefined) {
      const versions = this.edgeVersions.get(id);
      if (!versions || versions.length === 0) return null;
      const sortedDesc = [...versions].sort((a, b) => b - a);
      for (const vf of sortedDesc) {
        const v = this.edges.get(this.makeKey(id, vf));
        if (v && this.isValidAt(v, asOf)) return v;
      }
      return null;
    }
    const key = this.currentEdgeIndex.get(id);
    if (!key) return null;
    return this.edges.get(key) ?? null;
  }

  /**
   * Update a node: close current version (set validTo), insert new version.
   * Preserves history (old version remains in the store).
   */
  async updateNode(id: string, patch: Partial<GraphNode>, newValidFrom: number = Date.now()): Promise<GraphNode | null> {
    const currentKey = this.currentNodeIndex.get(id);
    if (!currentKey) return null;
    const current = this.nodes.get(currentKey);
    if (!current) return null;

    // Close current version
    const closed: GraphNode = { ...current, validTo: newValidFrom };
    this.nodes.set(currentKey, closed);

    // Create new version
    const next: GraphNode = {
      ...current,
      ...patch,
      id: current.id,
      validFrom: newValidFrom,
      validTo: null,
      recordedAt: Date.now(),
    };
    const newKey = this.makeKey(current.id, newValidFrom);
    this.nodes.set(newKey, next);
    this.currentNodeIndex.set(current.id, newKey);
    this.nodeVersions.get(current.id)!.push(newValidFrom);

    return next;
  }

  async query(q: GraphQuery): Promise<GraphResult> {
    const asOf = q.asOf ?? Date.now();
    const maxDepth = q.maxDepth ?? 3;
    const direction = q.direction ?? "both";
    const limit = q.limit ?? 100;

    // BFS from starting nodes
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
      // Start from all current nodes (limited)
      for (const [id, key] of this.currentNodeIndex) {
        const n = this.nodes.get(key);
        if (n && this.isValidAt(n, asOf)) {
          visitedNodes.set(id, n);
          if (visitedNodes.size >= limit) break;
        }
      }
    }

    // BFS
    while (queue.length > 0 && visitedNodes.size < limit) {
      const { nodeId, path, edgeKinds } = queue.shift()!;
      if (path.length > maxDepth) continue;

      const candidates: GraphEdge[] = [];
      if (direction === "out" || direction === "both") {
        for (const ekey of this.outAdj.get(nodeId) ?? []) {
          const e = this.edges.get(ekey);
          if (e && this.isValidAt(e, asOf)) candidates.push(e);
        }
      }
      if (direction === "in" || direction === "both") {
        for (const ekey of this.inAdj.get(nodeId) ?? []) {
          const e = this.edges.get(ekey);
          if (e && this.isValidAt(e, asOf)) candidates.push(e);
        }
      }

      for (const e of candidates) {
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
    const matches: GraphNode[] = [];
    // Iterate current versions only
    for (const [, key] of this.currentNodeIndex) {
      const n = this.nodes.get(key);
      if (!n) continue;
      if (n.validTo !== null) continue;  // skip superseded (shouldn't happen for current)
      if (
        n.label.toLowerCase().includes(t) ||
        (n.body?.toLowerCase().includes(t) ?? false) ||
        JSON.stringify(n.properties).toLowerCase().includes(t)
      ) {
        matches.push(n);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  async count(): Promise<{ nodes: number; edges: number }> {
    // Count only current (validTo=null) versions
    let validNodes = 0;
    for (const [, key] of this.currentNodeIndex) {
      const n = this.nodes.get(key);
      if (n && n.validTo === null) validNodes++;
    }
    let validEdges = 0;
    for (const [, key] of this.currentEdgeIndex) {
      const e = this.edges.get(key);
      if (e && e.validTo === null) validEdges++;
    }
    return { nodes: validNodes, edges: validEdges };
  }

  async clear(): Promise<void> {
    this.nodes.clear();
    this.edges.clear();
    this.currentNodeIndex.clear();
    this.currentEdgeIndex.clear();
    this.nodeVersions.clear();
    this.edgeVersions.clear();
    this.outAdj.clear();
    this.inAdj.clear();
  }

  private isValidAt(n: { validFrom: number; validTo: number | null }, asOf: number): boolean {
    return n.validFrom <= asOf && (n.validTo === null || n.validTo > asOf);
  }
}
