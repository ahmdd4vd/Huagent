/**
 * v4/capability/types.ts
 *
 * Capability: a typed, streamable, permission-bound function.
 *
 * The capability model replaces RPC-style tool calls. Each capability
 * has:
 *   - Input/output types (validated at pipeline compile time)
 *   - Declared permissions (read_file, write_file, network, etc.)
 *   - Streaming interface (AsyncIterable, not Promise)
 *
 * Why AsyncIterable:
 *   - Stream output as it's computed (no need to wait for full result)
 *   - Compose with pipe: read | grep | replace | write
 *   - Type-check edges: pipe(A → B) requires A.output ≅ B.input
 *
 * Why capabilities (Unix-style) instead of plain functions:
 *   - Permission check at composition time, not runtime
 *   - Sandboxed: capabilities declare what they need, runtime grants
 *   - Composable: pipe/compose operators are typed
 *   - Optimizable: redundant reads elided, parallel fan-out
 */

export type Permission =
  | "read_file"
  | "write_file"
  | "read_dir"
  | "network"
  | "shell"
  | "process"
  | "env"
  | "llm_call";

/**
 * A capability: a typed, async-iterable function with declared permissions.
 */
export interface Capability<TIn, TOut> {
  /** Stable name */
  name: string;
  /** Human description */
  description: string;
  /** Required permissions (granted at composition time) */
  permissions: Permission[];
  /** Cost estimate (0-1, used for optimizer) */
  cost: number;
  /** Whether this capability can be safely retried on failure */
  retryable: boolean;
  /** Optional: pure function (no side effects, can be memoized) */
  pure?: boolean;
  /** The actual implementation */
  call: (input: TIn, ctx: CapabilityContext) => AsyncIterable<TOut>;
}

/**
 * Context passed to a capability: permissions, file system access, etc.
 */
export interface CapabilityContext {
  /** Granted permissions */
  granted: Set<Permission>;
  /** File system read */
  readFile: (path: string) => Promise<string>;
  /** File system write */
  writeFile: (path: string, content: string) => Promise<void>;
  /** Run shell command */
  runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** LLM call */
  llm: (prompt: string, opts?: { json?: boolean }) => Promise<string>;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * A pipeline node: either a capability call or another pipeline.
 */
export type PipelineNode<TIn, TOut> =
  | { kind: "cap"; cap: Capability<any, TOut> }
  | { kind: "pipe"; left: PipelineNode<any, any>; right: PipelineNode<any, TOut> }
  | { kind: "fanout"; branches: PipelineNode<any, TOut>[] }
  | { kind: "fanin"; source: PipelineNode<any, any> }
  | { kind: "conditional"; cond: (inp: any) => boolean; then: PipelineNode<any, TOut>; else?: PipelineNode<any, TOut> }
  | { kind: "source"; produce: (emit: (item: TIn) => Promise<void>) => Promise<void> };

/**
 * A pipeline: composition of capabilities.
 */
export type Pipeline<TIn, TOut> = PipelineNode<TIn, TOut>;

/**
 * Pipeline type info for compile-time type checking.
 */
export interface PipelineType {
  input: string;  // type name
  output: string;  // type name
}

/**
 * Optimization result.
 */
export interface OptimizedPipeline {
  original: Pipeline<any, any>;
  optimized: Pipeline<any, any>;
  removedCalls: string[];
  parallelizedCalls: string[];
  estimatedSpeedup: number;
}
