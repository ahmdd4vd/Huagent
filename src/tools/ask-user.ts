// Ask user tool - pause and ask the user a question
// Inspired by OpenClaude's AskUserQuestionTool

export const askUserTool = {
  name: 'ask_user',
  description: 'Ask the user a multiple-choice question and wait for their answer. Use when you need clarification before proceeding.',
  schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      options: {
        type: 'array',
        description: 'Available options (2-4)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['label'],
        },
      },
      multiSelect: { type: 'boolean', description: 'Allow multiple selections' },
    },
    required: ['question', 'options'],
  },
  async execute(args: { question: string; options: Array<{ label: string; description?: string }>; multiSelect?: boolean }) {
    // In a real impl, this would prompt the user via TUI
    // For now, return the question for the caller to handle
    return {
      question: args.question,
      options: args.options,
      multiSelect: args.multiSelect || false,
      awaitingAnswer: true,
    };
  },
};
