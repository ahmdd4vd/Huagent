// Subagent tool - spawn a subagent for a focused task
// Inspired by OpenClaude's AgentTool

import { getOrchestrator, type SubagentType } from '../agents/subagent.js';
import { UnifiedClient } from '../providers/client.js';

export const subagentTool = {
  name: 'subagent',
  description: `Spawn a focused subagent to handle a specific task in parallel or isolation.

Subagent types:
- general-purpose: Versatile for any task
- code-explorer: Map out a codebase (read-only)
- code-reviewer: Review code quality
- test-runner: Run tests
- doc-writer: Write documentation
- bug-hunter: Debug issues
- planner: Create implementation plans
- critic: Review work and suggest improvements
- refactorer: Improve code structure
- security-reviewer: Find vulnerabilities

Examples:
- { "type": "code-reviewer", "task": "Review src/auth/login.ts" }
- { "type": "code-explorer", "task": "Map the auth system" }
- { "type": "general-purpose", "task": "Refactor the database layer" }`,
  schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['general-purpose', 'code-explorer', 'code-reviewer', 'test-runner', 'doc-writer', 'bug-hunter', 'planner', 'critic', 'refactorer', 'security-reviewer'],
        description: 'Type of subagent to spawn',
      },
      task: { type: 'string', description: 'What the subagent should do' },
      context: { type: 'string', description: 'Optional context to pass along' },
    },
    required: ['type', 'task'],
  },
  async execute(args: { type: SubagentType; task: string; context?: string }, ctx: { client: UnifiedClient; parentMessages?: any[] }) {
    const orchestrator = getOrchestrator();

    const fullTask = args.context
      ? `${args.task}\n\nContext:\n${args.context}`
      : args.task;

    const result = await orchestrator.run({
      type: args.type,
      task: fullTask,
      client: ctx.client,
      parentMessages: ctx.parentMessages,
    });

    return {
      subagentId: result.id,
      type: result.type,
      status: result.status,
      output: result.output,
      duration: result.endTime ? result.endTime - result.startTime : 0,
      tokensUsed: result.tokensUsed,
      cost: result.cost,
    };
  },
};
