// Memory tool - let the agent explicitly save/recall memories
// (Internal use; the agent uses these)
export const memoryTool = {
  name: 'memory',
  description: 'Save or recall memories. Use action="save" to remember, action="recall" to search past context.',
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['save', 'recall', 'fact', 'skill'] },
      type: { type: 'string', enum: ['episodic', 'semantic', 'procedural', 'project'] },
      content: { type: 'string', description: 'For save: the content to remember' },
      query: { type: 'string', description: 'For recall: search query' },
      key: { type: 'string', description: 'For fact: the key' },
      value: { type: 'string', description: 'For fact: the value' },
      name: { type: 'string', description: 'For skill: the pattern name' },
      description: { type: 'string', description: 'For skill: the pattern description' },
      pattern: { type: 'string', description: 'For skill: the pattern code/template' },
    },
    required: ['action'],
  },
  async execute(args: any) {
    // This is a placeholder - actual memory operations happen through MemoryManager
    // The tool description is for the LLM, the executor routes to the manager
    return {
      action: args.action,
      status: 'queued',
      message: 'Memory operation queued for processing by MemoryManager',
    };
  },
};
