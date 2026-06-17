# Huagent API Reference

**Version:** 4.3.1  
**Last Updated:** 2026-06-15

---

## Overview

This document provides a complete API reference for Huagent's core modules.

---

## Engine (`src/engine/core.ts`)

### Class: `Engine`

The main engine that processes user messages through a 6-stage workflow.

#### Constructor

```typescript
new Engine(
  client: UnifiedClient,
  memory: MemoryManager,
  tools: ToolRegistry,
  sessions: SessionManager,
  options?: EngineOptions
)
```

**Parameters:**
- `client` - UnifiedClient instance for LLM communication
- `memory` - MemoryManager instance for memory operations
- `tools` - ToolRegistry instance for tool execution
- `sessions` - SessionManager instance for session management
- `options` - Optional configuration

#### EngineOptions

```typescript
interface EngineOptions {
  criticModel?: string;           // Cheaper model for critique (default: main model)
  maxIterations?: number;         // Max refinement iterations (default: 3)
  enableSubagents?: boolean;      // Enable subagent spawning (default: true)
  enableMemoryFeedback?: boolean; // Enable memory feedback loop (default: true)
  enableToolFeedback?: boolean;   // Enable tool result feedback (default: true)
}
```

#### Methods

##### `process(message: string): Promise<string>`

Process a user message through the 6-stage workflow.

**Parameters:**
- `message` - User input text

**Returns:**
- Final response text

**Example:**
```typescript
const engine = new Engine(client, memory, tools, sessions);
const response = await engine.process('fix the login bug');
console.log(response);
```

##### `detectTaskType(message: string): TaskType`

Detect the type of task from a message.

**Parameters:**
- `message` - User message

**Returns:**
- `TaskType` - One of: `'code_fix'`, `'code_read'`, `'code_refactor'`, `'action'`, `'question'`, `'unknown'`

**Example:**
```typescript
const taskType = engine.detectTaskType('fix the login bug');
// Returns: 'code_fix'
```

##### `detectComplexity(message: string): ComplexityLevel`

Detect the complexity level of a message.

**Parameters:**
- `message` - User message

**Returns:**
- `ComplexityLevel` - One of: `'trivial'`, `'simple'`, `'moderate'`, `'complex'`

**Example:**
```typescript
const complexity = engine.detectComplexity('what is JavaScript');
// Returns: 'trivial'
```

##### `setCriticModel(model: string): void`

Set a cheaper model for critique stage.

**Parameters:**
- `model` - Model name (e.g., `'claude-haiku-4.5'`)

**Example:**
```typescript
engine.setCriticModel('claude-haiku-4.5');
```

##### `reset(): void`

Reset the engine state (clear conversation history).

**Example:**
```typescript
engine.reset();
```

---

## Providers (`src/providers/`)

### Class: `UnifiedClient`

Unified client for all 26 LLM providers.

#### Constructor

```typescript
new UnifiedClient(
  providerId: ProviderId,
  apiKey: string,
  baseUrl?: string
)
```

**Parameters:**
- `providerId` - Provider ID (e.g., `'anthropic'`, `'openai'`)
- `apiKey` - API key for the provider
- `baseUrl` - Optional custom base URL

#### Methods

##### `stream(request: StreamRequest): AsyncGenerator<StreamEvent>`

Stream a response from the LLM.

**Parameters:**
- `request` - Stream request configuration

**Returns:**
- AsyncGenerator yielding StreamEvent objects

**StreamRequest:**
```typescript
interface StreamRequest {
  messages: Message[];
  model: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}
```

**StreamEvent:**
```typescript
type StreamEvent =
  | { type: 'text_delta'; delta: string; accumulated: string }
  | { type: 'tool_use'; id: string; name: string; args: any }
  | { type: 'usage'; input: number; output: number; total: number; cost: number }
  | { type: 'message_stop'; stopReason: string };
```

**Example:**
```typescript
const client = new UnifiedClient('anthropic', 'sk-ant-...');
for await (const event of client.stream({
  messages: [{ role: 'user', content: 'hello' }],
  model: 'claude-sonnet-4.6',
})) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}
```

##### `setModel(model: string): void`

Set the default model.

**Parameters:**
- `model` - Model name

**Example:**
```typescript
client.setModel('claude-opus-4.6');
```

##### `getModel(): string`

Get the current default model.

**Returns:**
- Model name

**Example:**
```typescript
const model = client.getModel();
// Returns: 'claude-sonnet-4.6'
```

##### `getProviderName(): string`

Get the provider name.

**Returns:**
- Provider name

**Example:**
```typescript
const name = client.getProviderName();
// Returns: 'Anthropic'
```

##### `getStats(): ClientStats`

Get usage statistics.

**Returns:**
- `ClientStats` object

**ClientStats:**
```typescript
interface ClientStats {
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  averageTokensPerRequest: number;
}
```

**Example:**
```typescript
const stats = client.getStats();
console.log(`Total tokens: ${stats.totalTokens}`);
console.log(`Total cost: $${stats.totalCost}`);
```

##### `resetStats(): void`

Reset usage statistics.

**Example:**
```typescript
client.resetStats();
```

---

### Registry (`src/providers/registry.ts`)

#### Function: `detectProviderFromEnv(): ProviderId | null`

Detect provider from environment variables.

**Returns:**
- `ProviderId` or `null` if not detected

**Example:**
```typescript
const provider = detectProviderFromEnv();
// Returns: 'anthropic' if ANTHROPIC_API_KEY is set
```

#### Constant: `PROVIDERS`

Registry of all 26 providers.

**Example:**
```typescript
import { PROVIDERS } from '../providers/registry.ts';

console.log(PROVIDERS.anthropic);
// {
//   id: 'anthropic',
//   name: 'Anthropic',
//   baseUrl: 'https://api.anthropic.com',
//   apiKeyEnv: 'ANTHROPIC_API_KEY',
//   ...
// }
```

---

### Models (`src/providers/models.ts`)

#### Function: `getModels(providerId: ProviderId): Model[]`

Get all models for a provider.

**Parameters:**
- `providerId` - Provider ID

**Returns:**
- Array of Model objects

**Model:**
```typescript
interface Model {
  id: string;
  name: string;
  maxTokens: number;
  cost: { input: number; output: number };
  capabilities: string[];
}
```

**Example:**
```typescript
const models = getModels('anthropic');
// Returns: [
//   { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', ... },
//   { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', ... },
//   ...
// ]
```

---

### Capabilities (`src/providers/capabilities.ts`)

#### Function: `getCapabilities(provider: string, model: string): ModelCapabilities`

Get capabilities for a model using pattern matching.

**Parameters:**
- `provider` - Provider name
- `model` - Model name

**Returns:**
- `ModelCapabilities` object

**ModelCapabilities:**
```typescript
interface ModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  contextWindow: number;
  maxOutput: number;
  thinkingFormat?: string;
  thinkingCanDisable?: boolean;
}
```

**Example:**
```typescript
const caps = getCapabilities('anthropic', 'claude-opus-4.6');
// Returns: {
//   vision: true,
//   reasoning: true,
//   contextWindow: 1000000,
//   maxOutput: 32000,
//   thinkingFormat: 'claude-adaptive',
//   thinkingCanDisable: true
// }
```

---

### Pricing (`src/providers/pricing.ts`)

#### Function: `getPricing(provider: string, model: string): Pricing`

Get pricing for a model using pattern matching.

**Parameters:**
- `provider` - Provider name
- `model` - Model name

**Returns:**
- `Pricing` object

**Pricing:**
```typescript
interface Pricing {
  input: number;  // Cost per 1M input tokens (USD)
  output: number; // Cost per 1M output tokens (USD)
}
```

**Example:**
```typescript
const pricing = getPricing('anthropic', 'claude-opus-4.6');
// Returns: { input: 15, output: 75 }
```

---

## Memory (`src/memory/`)

### Class: `MemoryManager`

High-level memory management.

#### Constructor

```typescript
new MemoryManager(store: MemoryStore)
```

**Parameters:**
- `store` - MemoryStore instance

#### Methods

##### `recall(query: string, limit?: number): Memory[]`

Recall memories relevant to a query.

**Parameters:**
- `query` - Search query
- `limit` - Max results (default: 5)

**Returns:**
- Array of Memory objects

**Memory:**
```typescript
interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  lastAccessed: number;
  created: number;
}
```

**Example:**
```typescript
const memories = memory.recall('login bug', 5);
// Returns: [
//   { id: '...', content: 'Fixed login bug yesterday...', ... },
//   ...
// ]
```

##### `save(content: string, type?: MemoryType, importance?: number): string`

Save a new memory.

**Parameters:**
- `content` - Memory content
- `type` - Memory type (default: `'episodic'`)
- `importance` - Importance score 0-1 (default: 0.5)

**Returns:**
- Memory ID

**Example:**
```typescript
const id = memory.save('Fixed login bug in auth.ts', 'episodic', 0.8);
// Returns: 'abc123...'
```

##### `get(id: string): Memory | null`

Get a memory by ID.

**Parameters:**
- `id` - Memory ID

**Returns:**
- Memory object or null

**Example:**
```typescript
const memory = memoryManager.get('abc123');
```

##### `delete(id: string): void`

Delete a memory.

**Parameters:**
- `id` - Memory ID

**Example:**
```typescript
memoryManager.delete('abc123');
```

##### `stats(): MemoryStats`

Get memory statistics.

**Returns:**
- `MemoryStats` object

**MemoryStats:**
```typescript
interface MemoryStats {
  total: number;
  episodic: number;
  semantic: number;
  procedural: number;
  project: number;
}
```

**Example:**
```typescript
const stats = memory.stats();
console.log(`Total memories: ${stats.total}`);
```

---

### Class: `MemoryStore`

Low-level SQLite storage.

#### Constructor

```typescript
new MemoryStore(dbPath: string)
```

**Parameters:**
- `dbPath` - Path to SQLite database file

#### Methods

##### `save(memory: Memory): string`

Save a memory to the database.

**Parameters:**
- `memory` - Memory object

**Returns:**
- Memory ID

##### `get(id: string): Memory | null`

Get a memory by ID.

**Parameters:**
- `id` - Memory ID

**Returns:**
- Memory object or null

##### `search(query: string, limit?: number): Memory[]`

Search memories by query.

**Parameters:**
- `query` - Search query
- `limit` - Max results (default: 10)

**Returns:**
- Array of Memory objects

##### `delete(id: string): void`

Delete a memory.

**Parameters:**
- `id` - Memory ID

##### `close(): void`

Close the database connection.

---

## Tools (`src/tools/`)

### Class: `ToolRegistry`

Registry of available tools.

#### Constructor

```typescript
new ToolRegistry(config: ToolRegistryConfig)
```

**ToolRegistryConfig:**
```typescript
interface ToolRegistryConfig {
  workspace: string;
  permissionMode: PermissionMode;
}
```

#### Methods

##### `execute(name: string, args: any): Promise<ToolResult>`

Execute a tool.

**Parameters:**
- `name` - Tool name
- `args` - Tool arguments

**Returns:**
- `ToolResult` object

**ToolResult:**
```typescript
interface ToolResult {
  success: boolean;
  result?: any;
  error?: string;
}
```

**Example:**
```typescript
const result = await tools.execute('read', { path: 'src/auth.ts' });
if (result.success) {
  console.log(result.result);
}
```

##### `list(): ToolDefinition[]`

List all available tools.

**Returns:**
- Array of ToolDefinition objects

**ToolDefinition:**
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParameterDefinition[];
}
```

**Example:**
```typescript
const tools = registry.list();
// Returns: [
//   { name: 'read', description: 'Read a file', ... },
//   { name: 'write', description: 'Write a file', ... },
//   ...
// ]
```

##### `getPermissionMode(): PermissionMode`

Get the current permission mode.

**Returns:**
- `PermissionMode` value

**Example:**
```typescript
const mode = registry.getPermissionMode();
// Returns: 'workspace-write'
```

##### `setPermissionMode(mode: PermissionMode): void`

Set the permission mode.

**Parameters:**
- `mode` - PermissionMode value

**Example:**
```typescript
registry.setPermissionMode('read-only');
```

---

## Hooks (`src/hooks.ts`)

### Class: `HookSystem`

Lifecycle hook system.

#### Methods

##### `on(event: HookEvent, handler: HookHandler): void`

Register a hook handler.

**Parameters:**
- `event` - Hook event name
- `handler` - Handler function

**HookEvent:**
```typescript
type HookEvent =
  | 'UserPrompt'
  | 'PreLLMCall'
  | 'PostLLMCall'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PreCompact'
  | 'PostCompact'
  | 'AssistantReply'
  | 'SessionEnd';
```

**HookHandler:**
```typescript
type HookHandler = (ctx: HookContext) => void | Promise<void>;
```

**HookContext:**
```typescript
interface HookContext {
  event: HookEvent;
  data: any;
}
```

**Example:**
```typescript
hooks.on('PostToolUse', (ctx) => {
  console.log(`Tool ${ctx.data.tool} executed`);
});
```

##### `off(event: HookEvent, handler: HookHandler): void`

Unregister a hook handler.

**Parameters:**
- `event` - Hook event name
- `handler` - Handler function

**Example:**
```typescript
hooks.off('PostToolUse', handler);
```

##### `emit(event: HookEvent, data: any): Promise<void>`

Emit a hook event.

**Parameters:**
- `event` - Hook event name
- `data` - Event data

**Example:**
```typescript
await hooks.emit('UserPrompt', { message: 'hello' });
```

---

## Sessions (`src/sessions.ts`)

### Class: `SessionManager`

Session management.

#### Methods

##### `startSession(projectPath: string): string`

Start a new session.

**Parameters:**
- `projectPath` - Project path

**Returns:**
- Session ID

**Example:**
```typescript
const sessionId = sessions.startSession('/path/to/project');
```

##### `saveSession(sessionId: string, messages: Message[]): void`

Save a session to disk.

**Parameters:**
- `sessionId` - Session ID
- `messages` - Conversation messages

**Example:**
```typescript
sessions.saveSession('abc123', messages);
```

##### `loadSession(sessionId: string): Session | null`

Load a session from disk.

**Parameters:**
- `sessionId` - Session ID

**Returns:**
- Session object or null

**Example:**
```typescript
const session = sessions.loadSession('abc123');
```

##### `listSessions(): Session[]`

List all saved sessions.

**Returns:**
- Array of Session objects

**Example:**
```typescript
const sessions = sessions.listSessions();
```

##### `endSession(sessionId: string): void`

End a session.

**Parameters:**
- `sessionId` - Session ID

**Example:**
```typescript
sessions.endSession('abc123');
```

---

## Types (`src/types/index.ts`)

### Message

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
}
```

### ToolCall

```typescript
interface ToolCall {
  id: string;
  name: string;
  args: any;
}
```

### Plan

```typescript
interface Plan {
  goal: string;
  steps: PlanStep[];
}
```

### PlanStep

```typescript
interface PlanStep {
  description: string;
  tool?: string;
  args?: any;
  dependsOn?: number[];
  status?: 'pending' | 'running' | 'done' | 'failed';
  result?: any;
}
```

### TaskType

```typescript
type TaskType =
  | 'code_fix'
  | 'code_read'
  | 'code_refactor'
  | 'action'
  | 'question'
  | 'unknown';
```

### ComplexityLevel

```typescript
type ComplexityLevel = 'trivial' | 'simple' | 'moderate' | 'complex';
```

### PermissionMode

```typescript
type PermissionMode =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'
  | 'prompt'
  | 'allow';
```

### MemoryType

```typescript
type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'project';
```

### ProviderId

```typescript
type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'groq'
  | 'deepseek'
  | 'perplexity'
  | 'xai'
  | 'minimax'
  | 'nvidia'
  | 'cerebras'
  | 'openrouter'
  | 'together'
  | 'fireworks'
  | 'huggingface'
  | 'github'
  | 'azure'
  | 'bedrock'
  | 'vertex'
  | 'mistral'
  | 'codestral'
  | 'custom';
```

---

## Examples

### Basic Usage

```typescript
import { Engine } from './engine/core.ts';
import { UnifiedClient } from './providers/client.ts';
import { MemoryManager } from './memory/manager.ts';
import { ToolRegistry } from './tools/index.ts';
import { SessionManager } from './sessions.ts';

// Initialize components
const client = new UnifiedClient('anthropic', 'sk-ant-...');
const memory = new MemoryManager(new MemoryStore('./memory.db'));
const tools = new ToolRegistry({ workspace: '.', permissionMode: 'workspace-write' });
const sessions = new SessionManager();

// Create engine
const engine = new Engine(client, memory, tools, sessions);

// Process message
const response = await engine.process('fix the login bug in auth.ts');
console.log(response);
```

### Streaming Response

```typescript
const client = new UnifiedClient('anthropic', 'sk-ant-...');

for await (const event of client.stream({
  messages: [{ role: 'user', content: 'explain JavaScript' }],
  model: 'claude-sonnet-4.6',
})) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'usage') {
    console.log(`\nTokens: ${event.total}, Cost: $${event.cost}`);
  }
}
```

### Memory Operations

```typescript
const memory = new MemoryManager(new MemoryStore('./memory.db'));

// Save memory
memory.save('Fixed login bug in auth.ts', 'episodic', 0.8);

// Recall memories
const memories = memory.recall('login bug', 5);

// Get stats
const stats = memory.stats();
console.log(`Total: ${stats.total}`);
```

### Tool Execution

```typescript
const tools = new ToolRegistry({ workspace: '.', permissionMode: 'workspace-write' });

// Read file
const result = await tools.execute('read', { path: 'src/auth.ts' });
if (result.success) {
  console.log(result.result);
}

// Write file
await tools.execute('write', {
  path: 'src/new.ts',
  content: 'export const hello = "world";',
});
```

### Hook System

```typescript
const hooks = new HookSystem();

// Register hook
hooks.on('PostToolUse', (ctx) => {
  console.log(`Tool ${ctx.data.tool} executed`);
});

// Emit event
await hooks.emit('PostToolUse', { tool: 'read', args: { path: 'auth.ts' } });
```

---

## Error Handling

### HuagentError

Base error class for all Huagent errors.

```typescript
class HuagentError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'HuagentError';
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `MISSING_API_KEY` | API key not provided |
| `INVALID_PROVIDER` | Invalid provider ID |
| `INVALID_MODEL` | Invalid model name |
| `TOOL_NOT_FOUND` | Tool not found in registry |
| `PERMISSION_DENIED` | Tool execution denied |
| `MEMORY_ERROR` | Memory operation failed |
| `SESSION_ERROR` | Session operation failed |
| `LLM_ERROR` | LLM API error |

### Example

```typescript
try {
  const response = await engine.process('fix bug');
} catch (error) {
  if (error instanceof HuagentError) {
    console.error(`Error ${error.code}: ${error.message}`);
  } else {
    console.error('Unknown error:', error);
  }
}
```

---

## Additional Resources

- [User Guide](./USER_GUIDE.md)
- [Architecture](./ARCHITECTURE.md)
- [Contributing](./CONTRIBUTING.md)
- [GitHub Repository](https://github.com/huanime/huagent)

---

**API designed for simplicity, extensibility, and type safety. ✦**
