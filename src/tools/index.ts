// Tool registry - all the things the agent can do
// Now with permission enforcement (inspired by claw-code)

import type { Tool } from '../types/index.js';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { searchTool } from './search.js';
import { grepTool } from './grep.js';
import { webTool } from './web.js';
import { memoryTool } from './memory.js';
import { PermissionEnforcer, type PermissionMode } from '../permissions.js';

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  denied?: boolean;
  deniedReason?: string;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private workdir: string;
  private enforcer: PermissionEnforcer;

  constructor(workdir: string = process.cwd(), mode: PermissionMode = 'workspace-write') {
    this.workdir = workdir;
    this.enforcer = new PermissionEnforcer({
      workspaceRoot: workdir,
      mode,
    });
    this.registerDefaults();
  }

  setWorkdir(path: string) {
    this.workdir = path;
    const toolArr = Array.from(this.tools.values());
    for (const tool of toolArr) {
      tool.workdir = path;
    }
    this.enforcer.setWorkspaceRoot(path);
  }

  setPermissionMode(mode: PermissionMode) {
    this.enforcer.setMode(mode);
  }

  getPermissionMode(): PermissionMode {
    return this.enforcer.getMode();
  }

  register(tool: Tool) {
    if (tool.workdir === undefined) {
      tool.workdir = this.workdir;
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  getSchemas(): any[] {
    // Return schemas with name + description included, so the OpenAI
    // format converter in client.ts can find them. The raw schema
    // stored on each tool only has { type, properties, required } —
    // we merge in the tool name and description here.
    return this.list().map((t) => ({
      ...t.schema,
      name: t.name,
      description: t.description,
    }));
  }

  async execute(name: string, args: any): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        duration: 0,
      };
    }

    // Permission check
    const permission = await this.enforcer.check(name, args);
    if (!permission.allowed) {
      return {
        success: false,
        error: permission.reason || 'Permission denied',
        duration: 0,
        denied: true,
        deniedReason: permission.reason,
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(args);
      return {
        success: true,
        result,
        duration: Date.now() - start,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        duration: Date.now() - start,
      };
    }
  }

  private registerDefaults() {
    this.register(readTool);
    this.register(writeTool);
    this.register(editTool);
    this.register(bashTool);
    this.register(searchTool);
    this.register(grepTool);
    this.register(webTool);
    this.register(memoryTool);
  }
}

export { readTool, writeTool, editTool, bashTool, searchTool, grepTool, webTool, memoryTool };
