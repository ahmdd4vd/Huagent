/**
 * wllm/ingest/semantic-extractor.ts
 *
 * Pass 2: LLM-based semantic extraction.
 * Takes Pass 1's structural data + raw source, asks LLM to extract:
 *   - Entities (services, libraries, APIs)
 *   - Concepts (patterns, techniques, conventions)
 *   - Gotchas (TODO/FIXME/HACK contextualized)
 *   - Connections to existing wiki pages
 *   - Contradictions with existing knowledge
 *
 * Uses MiniMax-M3 (configured in /root/.hermes/.env via TOKENROUTER_API_KEY).
 *
 * Cost-aware: only 1 LLM call per file (Pass 3 is 3 calls for verification).
 */

import { readFileSync, existsSync } from "node:fs";
import { FileStructure } from "./structural-extractor.js";

/**
 * An LLM provider interface.
 */
export interface LLMProvider {
  name: string;
  model: string;
  chat(messages: Array<{ role: "user" | "system" | "assistant"; content: string }>): Promise<{ content: string }>;
  generateText(prompt: string): Promise<{ text: string; tokensUsed: number; durationMs: number }>;
}

/**
 * The semantic analysis result.
 */
export interface SemanticAnalysis {
  /** Source file structure (from Pass 1) */
  structure: FileStructure;
  /** Entities extracted (services, libraries, APIs, etc.) */
  entities: Array<{ name: string; kind: "service" | "library" | "api" | "tool" | "person" | "concept"; description: string; confidence: number }>;
  /** Concepts extracted (patterns, techniques, conventions) */
  concepts: Array<{ name: string; description: string; confidence: number }>;
  /** Gotchas / important findings from comments + structure */
  gotchas: Array<{ type: "warning" | "todo" | "fixme" | "hack" | "insight"; description: string; line?: number; severity: "low" | "medium" | "high" }>;
  /** Connections to existing wiki pages (by name) */
  connections: Array<{ targetPage: string; relation: "uses" | "extends" | "implements" | "related" | "configures"; confidence: number }>;
  /** Contradictions found with existing knowledge */
  contradictions: Array<{ existingClaim: string; newClaim: string; confidence: number }>;
  /** Summary of the file (1-2 sentences) */
  summary: string;
  /** Tokens used */
  tokensUsed: number;
  /** Raw LLM response (for debugging) */
  rawResponse?: string;
}

/**
 * Build the LLM prompt for semantic analysis.
 */
function buildPrompt(structure: FileStructure): string {
  // Build a concise summary of the file structure
  const structureSummary = {
    path: structure.path,
    language: structure.language,
    imports: structure.imports.map(i => `${i.module} (${i.symbols.join(", ") || "*"})`),
    exports: structure.exports.map(e => `${e.kind}:${e.symbol}`),
    functions: structure.functions.map(f => `${f.isAsync ? "async " : ""}${f.name}(...)  ${f.jsDoc ? `// ${f.jsDoc.split("\n")[0]}` : ""}`),
    classes: structure.classes.map(c => `class ${c.name}${c.extends ? ` extends ${c.extends}` : ""}${c.implements?.length ? ` implements ${c.implements.join(", ")}` : ""} { methods: ${c.methods.join(", ")} }`),
    interfaces: structure.interfaces.map(i => `interface ${i.name}  ${i.jsDoc ? `// ${i.jsDoc.split("\n")[0]}` : ""}`),
    types: structure.types.map(t => `type ${t.name}`),
    enums: structure.enums.map(e => `enum ${e.name} { ${e.members.join(", ")} }`),
    comments: structure.comments.map(c => `${c.type}: ${c.text} (line ${c.line})`),
  };

  return `You are analyzing a source code file to extract semantic knowledge for a wiki.

FILE: ${structureSummary.path}
LANGUAGE: ${structureSummary.language}

STRUCTURE (extracted by TypeScript Compiler API — these are FACTS, not interpretation):
${JSON.stringify(structureSummary, null, 2)}

YOUR TASK: Extract the following from this file:

1. ENTITIES: services, libraries, APIs, tools, or concepts mentioned
   Format: [{ "name": "...", "kind": "service|library|api|tool|concept", "description": "...", "confidence": 0.0-1.0 }]

2. CONCEPTS: patterns, techniques, or conventions used
   Format: [{ "name": "...", "description": "...", "confidence": 0.0-1.0 }]

3. GOTCHAS: things developers should know (from comments, code structure)
   Format: [{ "type": "warning|todo|fixme|hack|insight", "description": "...", "line": N, "severity": "low|medium|high" }]

4. CONNECTIONS: relationships to potential wiki pages
   Format: [{ "targetPage": "...", "relation": "uses|extends|implements|related|configures", "confidence": 0.0-1.0 }]

5. CONTRADICTIONS: claims in the code that might contradict common knowledge
   Format: [{ "existingClaim": "...", "newClaim": "...", "confidence": 0.0-1.0 }]

6. SUMMARY: 1-2 sentence description of what this file does

Respond with ONLY valid JSON in this exact format:
{
  "entities": [...],
  "concepts": [...],
  "gotchas": [...],
  "connections": [...],
  "contradictions": [],
  "summary": "..."
}

Be CONCISE. Only include high-confidence findings. Quality over quantity.
If a field has nothing notable, return empty array.
`;
}

/**
 * Parse the LLM JSON response with fallback.
 */
function parseLLMResponse(text: string): Omit<SemanticAnalysis, "structure" | "tokensUsed" | "rawResponse"> {
  // Try to extract JSON from the response (LLM might wrap in markdown)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("No JSON found in LLM response");
  }
  const json = JSON.parse(jsonMatch[0]);

  return {
    entities: Array.isArray(json.entities) ? json.entities : [],
    concepts: Array.isArray(json.concepts) ? json.concepts : [],
    gotchas: Array.isArray(json.gotchas) ? json.gotchas : [],
    connections: Array.isArray(json.connections) ? json.connections : [],
    contradictions: Array.isArray(json.contradictions) ? json.contradictions : [],
    summary: typeof json.summary === "string" ? json.summary : "",
  };
}

/**
 * Run semantic extraction using LLM.
 */
export async function extractSemantics(
  structure: FileStructure,
  provider: LLMProvider,
  options: { withRaw?: boolean } = {}
): Promise<SemanticAnalysis> {
  const prompt = buildPrompt(structure);

  const t0 = Date.now();
  const result = await provider.generateText(prompt);
  const duration = Date.now() - t0;

  const parsed = parseLLMResponse(result.text);

  return {
    structure,
    ...parsed,
    tokensUsed: result.tokensUsed,
    ...(options.withRaw ? { rawResponse: result.text } : {}),
  };
}

/**
 * Create a MiniMax-M3 provider (configured via TOKENROUTER_API_KEY env var).
 */
export function createTokenRouterProvider(model: string = "MiniMax-M3"): LLMProvider {
  const apiKey = process.env.TOKENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("TOKENROUTER_API_KEY not set in environment");
  }
  const baseUrl = process.env.TOKENROUTER_BASE_URL || "https://api.tokenrouter.com/v1";

  return {
    name: "tokenrouter",
    model,
    async chat(messages) {
      // BUGFIX: Added 30s timeout via AbortSignal. The previous code had
      // no timeout — a slow/hanging API would block the entire ingest
      // pipeline indefinitely.
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,  // low for consistent extraction
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LLM request failed: ${res.status} ${errText}`);
      }
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content ?? "" };
    },
    async generateText(prompt) {
      const t0 = Date.now();
      // BUGFIX: Added 30s timeout.
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`LLM request failed: ${res.status} ${errText}`);
      }
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      const tokensUsed = data.usage?.total_tokens ?? 0;
      return { text, tokensUsed, durationMs: Date.now() - t0 };
    },
  };
}

/**
 * A mock LLM provider for testing (no network calls).
 */
export function createMockProvider(responses: Record<string, string> = {}): LLMProvider {
  return {
    name: "mock",
    model: "mock",
    async chat(messages) {
      const last = messages[messages.length - 1];
      return { content: responses[last.content] ?? "Mock response" };
    },
    async generateText(prompt) {
      // Return a fixed mock response
      const mockResponse = `{
  "entities": [
    {"name": "ExampleService", "kind": "service", "description": "Mock service from test", "confidence": 0.9}
  ],
  "concepts": [
    {"name": "Repository Pattern", "description": "Abstracts data access", "confidence": 0.8}
  ],
  "gotchas": [
    {"type": "warning", "description": "Mock gotcha", "line": 10, "severity": "medium"}
  ],
  "connections": [
    {"targetPage": "ExampleService", "relation": "uses", "confidence": 0.7}
  ],
  "contradictions": [],
  "summary": "Mock file used for testing."
}`;
      return { text: mockResponse, tokensUsed: 100, durationMs: 5 };
    },
  };
}
