// TodoWrite tool - manage a task list (inspired by claude-code TodoWrite)
// Helps the agent plan and track multi-step work

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;  // Present tense, e.g. "Reading file"
  createdAt: number;
  updatedAt: number;
}

let _todos: TodoItem[] = [];
let _idCounter = 0;

function nextId(): string {
  return String(++_idCounter);
}

export const todoTool = {
  name: 'todo',
  description: `Manage a task list for multi-step work.

Actions:
- "plan" — Replace the entire todo list with a new plan
- "update" — Update a single todo's status
- "list" — Get current todos
- "clear" — Clear all todos

Use this to break complex tasks into steps and track progress.`,
  schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['plan', 'update', 'list', 'clear'] },
      items: {
        type: 'array',
        description: 'For "plan" action: array of todo items',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            activeForm: { type: 'string' },
          },
          required: ['content'],
        },
      },
      id: { type: 'string', description: 'For "update" action: todo id' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
    },
    required: ['action'],
  },
  async execute(args: { action: string; items?: any[]; id?: string; status?: string }) {
    switch (args.action) {
      case 'plan': {
        _todos = [];
        _idCounter = 0;
        if (args.items) {
          for (const item of args.items) {
            _todos.push({
              id: nextId(),
              content: item.content,
              status: 'pending',
              activeForm: item.activeForm || item.content,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
        return { action: 'plan', todos: _todos };
      }
      case 'update': {
        const todo = _todos.find((t) => t.id === args.id);
        if (todo && args.status) {
          todo.status = args.status as TodoItem['status'];
          todo.updatedAt = Date.now();
        }
        return { action: 'update', todo };
      }
      case 'list': {
        return { action: 'list', todos: _todos };
      }
      case 'clear': {
        _todos = [];
        _idCounter = 0;
        return { action: 'clear' };
      }
      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  },
};
