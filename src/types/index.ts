// Core type definitions for huagent

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** For role='tool' messages: the ID of the tool call this result belongs to. */
  toolCallId?: string;
  metadata?: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  error?: string;
  duration: number;
}

export interface Tool {
  name: string;
  description: string;
  schema: any;
  execute: (args: any) => Promise<any>;
  requiresConfirmation?: boolean;
  dangerous?: boolean;
  workdir?: string;
}

export interface ToolSchema {
  type: string;
  properties: Record<string, any>;
  required?: string[];
}

export type TaskType =
  | 'code_write'   // bikin kode baru
  | 'code_read'    // baca/eksplorasi
  | 'code_fix'     // debug/fix bug
  | 'code_refactor' // improve struktur
  | 'question'     // tanya jawab
  | 'research'     // cari info
  | 'action'       // eksekusi perintah (run, build, deploy)
  | 'unknown';

export type ComplexityLevel = 'trivial' | 'simple' | 'moderate' | 'complex';

export interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  args?: Record<string, any>;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  duration?: number;
  critique?: string;
  depends_on?: number[];      // step ids this step depends on
  parallel_group?: number;    // group steps that can run in parallel
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'cancelled';
  critique?: string;
  refinements: number;
  taskType?: TaskType;
  complexity?: ComplexityLevel;
}

export interface MemoryEntry {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'project';
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
  importance: number; // 0-1
}

export interface Session {
  id: string;
  projectPath: string;
  startTime: number;
  endTime?: number;
  messages: Message[];
  plans: Plan[];
  memories: MemoryEntry[];
  context: ContextState;
}

export interface ContextState {
  // Current focus
  goal?: string;
  plan?: Plan;

  // Hierarchical memory
  hot: Message[];           // Most recent, full detail
  warm: string[];           // Summaries of older context
  cold: string[];           // Compressed archive

  // Project context
  projectFacts: Map<string, string>;
  fileContext: Map<string, string>;

  // Token budget
  tokensUsed: number;
  tokensBudget: number;
}

export interface LLMRequest {
  model: string;
  messages: Message[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  model: string;
  latencyMs: number;
}

export interface AgentConfig {
  // Model
  provider: 'anthropic' | 'openai' | 'mock';
  model: string;
  apiKey?: string;
  baseUrl?: string;

  // Behavior
  maxRefinements: number;
  enableCritic: boolean;
  enablePlanning: boolean;
  maxSteps: number;

  // Memory
  memoryPath: string;
  enableMemory: boolean;
  memoryRetrieval: 'semantic' | 'recency' | 'hybrid';

  // TUI
  theme: 'sakura' | 'neon' | 'classic';
  showTimestamps: boolean;
  showTokenUsage: boolean;
}

// Engine events for TUI integration
export type EngineEvent =
  | { type: 'thinking'; content: string }
  | { type: 'plan_created'; plan: Plan }
  | { type: 'step_start'; step: PlanStep }
  | { type: 'step_done'; step: PlanStep; result: any }
  | { type: 'step_failed'; step: PlanStep; error: string }
  | { type: 'tool_call'; call: import('./index.js').ToolCall }
  | { type: 'tool_result'; call: import('./index.js').ToolCall; result: any }
  | { type: 'critique'; verdict: 'pass' | 'refine' | 'fail'; feedback: string }
  | { type: 'refining'; iteration: number }
  | { type: 'message'; message: Message };
