/**
 * v4/index.ts
 * Public API for Huagent v4.0.
 */
export * from "./stream/index.js";
export * from "./htn/index.js";
export * from "./speculative/index.js";
export * from "./critic/index.js";
export * from "./graph/index.js";
export * from "./actor/index.js";
// Capability exports PipelineBuilder too; re-export with rename
export { pipe as capPipe, source as capSource, execute as capExecute, optimize as capOptimize, memoize as capMemoize } from "./capability/index.js";
export type { Capability, CapabilityContext, Permission, Pipeline, PipelineNode, OptimizedPipeline } from "./capability/index.js";
// Discipline layer (Fable-5 mindset): opt-in via EngineV4Config.discipline
export * from "./discipline/index.js";
export { EngineV4 } from "./engine-v4.js";
export type { EngineV4Config, EngineV4Result, LLMProvider } from "./engine-v4.js";
