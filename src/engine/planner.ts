// Smart Planner: specialized LLM call for structured planning
// Returns a typed Plan object with tool awareness

import type { UnifiedClient, StreamEvent } from '../providers/client.js';
import type { Plan, PlanStep, TaskType } from '../types/index.js';
import { nanoid } from 'nanoid';

const PLANNER_PROMPT = `You are an expert planner for a coding AI agent. Given a user request, generate a structured plan.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "goal": "the refined goal (clear, specific)",
  "complexity": "trivial|simple|moderate|complex",
  "taskType": "code_write|code_read|code_fix|question|research|action",
  "steps": [
    {
      "id": 1,
      "description": "what this step does",
      "tool": "tool_name or null if just thinking",
      "args": { "arg1": "value1" },
      "depends_on": [],
      "parallel_group": 0
    }
  ]
}

RULES:
- Use ONLY tools from the available list
- Reference exact tool names
- Make args realistic (paths exist, commands valid)
- Group independent steps in same parallel_group
- If no tool needed (just answer), use one step with tool: null
- Keep plans minimal — don't over-decompose trivial tasks
- For multi-file changes, list each file as a separate step

Available tools:
{TOOLS}

Examples:

User: "what does main.ts do?"
{
  "goal": "Explain what main.ts does",
  "complexity": "trivial",
  "taskType": "code_read",
  "steps": [
    { "id": 1, "description": "Read main.ts", "tool": "read", "args": { "path": "main.ts" }, "depends_on": [], "parallel_group": 0 },
    { "id": 2, "description": "Summarize contents", "tool": null, "args": {}, "depends_on": [1], "parallel_group": 1 }
  ]
}

User: "fix the login bug"
{
  "goal": "Fix login bug",
  "complexity": "moderate",
  "taskType": "code_fix",
  "steps": [
    { "id": 1, "description": "Find login code", "tool": "search_files", "args": { "pattern": "login" }, "depends_on": [], "parallel_group": 0 },
    { "id": 2, "description": "Read login file", "tool": "read", "args": { "path": "auth.ts" }, "depends_on": [1], "parallel_group": 1 },
    { "id": 3, "description": "Identify bug", "tool": null, "args": {}, "depends_on": [2], "parallel_group": 2 },
    { "id": 4, "description": "Apply fix", "tool": "edit", "args": { "path": "auth.ts", "old": "...", "new": "..." }, "depends_on": [3], "parallel_group": 3 },
    { "id": 5, "description": "Verify fix", "tool": "bash", "args": { "command": "node test.js" }, "depends_on": [4], "parallel_group": 4 }
  ]
}

Now plan this:
{REQUEST}`;

export interface PlannerInput {
  request: string;
  availableTools: string[];
  memoryContext?: string;
  taskType?: TaskType;
}

export class Planner {
  constructor(private client: UnifiedClient) {}

  async plan(input: PlannerInput): Promise<Plan> {
    const toolsList = input.availableTools.length
      ? input.availableTools.join(', ')
      : 'none';

    const prompt = PLANNER_PROMPT
      .replace('{TOOLS}', toolsList)
      .replace('{REQUEST}', input.request + (input.memoryContext ? `\n\nContext:\n${input.memoryContext}` : ''));

    let text = '';
    for await (const event of this.client.stream({
      model: this.client.getModel(),
      system: prompt,
      messages: [{ role: 'user', content: input.request }],
      temperature: 0.2,
      maxTokens: 2000,
    })) {
      if (event.type === 'text_delta') text = event.accumulated;
      if (event.type === 'message_stop') break;
      if (event.type === 'error') throw new Error(event.error);
    }

    const parsed = this.extractJson(text);
    if (!parsed) {
      // Fallback: treat as simple chat step
      return this.fallbackPlan(input.request);
    }

    return {
      id: nanoid(),
      goal: parsed.goal || input.request,
      steps: (parsed.steps || []).map((s: any) => ({
        id: nanoid(),
        description: s.description || 'unnamed step',
        tool: s.tool || undefined,
        args: s.args || {},
        depends_on: s.depends_on || [],
        parallel_group: s.parallel_group ?? 0,
        status: 'pending' as const,
      })),
      createdAt: Date.now(),
      status: 'planning' as const,
      refinements: 0,
      complexity: parsed.complexity || 'simple',
      taskType: parsed.taskType || input.taskType || 'unknown',
    };
  }

  private fallbackPlan(request: string): Plan {
    return {
      id: nanoid(),
      goal: request,
      steps: [
        {
          id: nanoid(),
          description: 'Respond to user',
          tool: undefined,
          args: {},
          depends_on: [],
          parallel_group: 0,
          status: 'pending' as const,
        },
      ],
      createdAt: Date.now(),
      status: 'planning' as const,
      refinements: 0,
      complexity: 'simple',
      taskType: 'unknown',
    };
  }

  private extractJson(text: string): any {
    // 1. Try direct parse (cleanest case)
    try {
      return JSON.parse(text);
    } catch {}

    // 2. Try code block (```json ... ```)
    const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {}
    }

    // 3. Find balanced JSON object (not greedy — tracks brace depth)
    const startIdx = text.indexOf('{');
    if (startIdx !== -1) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(startIdx, i + 1));
            } catch { break; }
          }
        }
      }
    }

    return null;
  }
}
