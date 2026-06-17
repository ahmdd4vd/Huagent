/**
 * v4/graph/types.ts
 *
 * Property graph data model with bi-temporal validity.
 *
 * Bi-temporal means: every node/edge has
 *   - valid_from: when the fact became true
 *   - valid_to: when it stopped being true (null = current)
 *   - recorded_at: when we added it to the graph
 *
 * Why bi-temporal:
 * - Time-travel queries: "what did the graph look like at 12:34?"
 * - We never delete; we supersede (close valid_to, add new version).
 * - Causal reasoning: "editing A caused bug B" requires temporal ordering.
 *
 * Node kinds (extensible):
 *   - episode: a user task we executed
 *   - file: a project file
 *   - function: a function in a file
 *   - error: an error message
 *   - insight: a learned pattern (recipe or anti-pattern)
 *   - strategy: a candidate from speculative race
 *   - user: user identity / preferences
 *   - project: project metadata
 *
 * Edge kinds (CausalEdgeKind from stream):
 *   - edited, caused, fixedBy, derived, dependsOn, related
 */
import type { CausalEdgeKind } from "../stream/cognitive-event.js";

export type GraphNodeKind =
  | "episode"
  | "file"
  | "function"
  | "error"
  | "insight"
  | "strategy"
  | "user"
  | "project";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Short label (used for display) */
  label: string;
  /** Long-form text (used for search) */
  body?: string;
  /** Properties (JSON-serializable) */
  properties: Record<string, unknown>;
  /** Bi-temporal */
  validFrom: number;  // ms since epoch
  validTo: number | null;  // null = still valid
  recordedAt: number;  // when added to graph
  /** Confidence 0-1 (for LLM-extracted nodes) */
  confidence: number;
}

export interface GraphEdge {
  id: string;
  fromNode: string;
  toNode: string;
  kind: CausalEdgeKind;
  /** Optional weight (for ranked queries) */
  weight: number;
  properties: Record<string, unknown>;
  validFrom: number;
  validTo: number | null;
  recordedAt: number;
  confidence: number;
}

/**
 * A graph query: traversal from a starting node.
 */
export interface GraphQuery {
  /** Starting node id(s). Empty = all. */
  from?: string[];
  /** Edge kind(s) to follow. Empty = all. */
  via?: CausalEdgeKind[];
  /** Direction: outgoing, incoming, both. Default: both. */
  direction?: "out" | "in" | "both";
  /** Max depth. Default: 3. */
  maxDepth?: number;
  /** Filter by node kind. */
  nodeKind?: GraphNodeKind[];
  /** Time point: only return nodes/edges valid at this ms. Default: now. */
  asOf?: number;
  /** Limit results. */
  limit?: number;
}

export interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Path representations (for multi-hop queries) */
  paths: Array<{ from: string; to: string; hops: string[]; edgeKinds: CausalEdgeKind[] }>;
}
