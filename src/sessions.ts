// Session manager - save/load conversation state
// Inspired by claw-code (Rust) SessionStore

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nanoid } from 'nanoid';
import type { Message } from './types/index.js';

export interface SessionData {
  id: string;
  projectPath: string;
  startTime: number;
  endTime?: number;
  messages: Message[];
  summary?: string;
  metadata: {
    model?: string;
    provider?: string;
    totalTokens?: number;
    totalCost?: number;
    permissionMode?: string;
  };
}

export class SessionManager {
  private sessionsDir: string;
  private pendingSession: { id: string; projectPath: string; startTime: number } | null = null;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir || join(homedir(), '.huagent', 'sessions');
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  // Save a session
  save(data: Omit<SessionData, 'id' | 'startTime' | 'endTime'> & { id?: string; startTime?: number }): string {
    const id = data.id || nanoid(12);
    const session: SessionData = {
      id,
      projectPath: data.projectPath,
      startTime: data.startTime || Date.now(),
      endTime: Date.now(),
      messages: data.messages,
      summary: data.summary,
      metadata: data.metadata || {},
    };

    const filePath = this.getSessionPath(id);
    writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    return id;
  }

  // Load a session by ID
  load(id: string): SessionData | null {
    const filePath = this.getSessionPath(id);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  }

  // List all sessions (newest first)
  list(limit = 50): SessionData[] {
    if (!existsSync(this.sessionsDir)) return [];

    const files = readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit);

    const sessions: SessionData[] = [];
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(this.sessionsDir, file), 'utf-8'));
        sessions.push(data);
      } catch {
        // Skip corrupted files
      }
    }
    return sessions;
  }

  // Find sessions by project path
  findByProject(projectPath: string, limit = 10): SessionData[] {
    return this.list(100).filter((s) => s.projectPath === projectPath).slice(0, limit);
  }

  // Delete a session
  delete(id: string): boolean {
    const filePath = this.getSessionPath(id);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }

  // Check if a session exists
  exists(id: string): boolean {
    return existsSync(this.getSessionPath(id));
  }

  // Start a new session (in-memory tracking)
  startSession(projectPath: string): string {
    const id = nanoid(12);
    this.pendingSession = { id, projectPath, startTime: Date.now() };
    return id;
  }

  // End the current session
  endSession(id: string, summary: string): void {
    if (this.pendingSession && this.pendingSession.id === id) {
      this.save({
        projectPath: this.pendingSession.projectPath,
        messages: [],
        summary,
        startTime: this.pendingSession.startTime,
        metadata: { sessionDuration: Date.now() - this.pendingSession.startTime } as any,
      });
      this.pendingSession = null;
    }
  }

  // Get the latest session
  latest(): SessionData | null {
    const sessions = this.list(1);
    return sessions[0] || null;
  }

  // Format sessions for display
  formatList(sessions: SessionData[]): string {
    if (sessions.length === 0) {
      return '  (no sessions yet)';
    }

    const lines: string[] = [];
    for (const s of sessions) {
      const duration = s.endTime
        ? `${Math.round((s.endTime - s.startTime) / 1000)}s`
        : 'active';
      const msgCount = s.messages.length;
      const project = s.projectPath.split('/').slice(-2).join('/');
      const summary = s.summary || s.messages[0]?.content?.slice(0, 50) || '(empty)';
      const time = new Date(s.startTime).toLocaleString();

      lines.push(`  ${fg('#FF6B9D', s.id)} ${fg('#9AA5CE', time)} ${fg('#FFD700', `(${msgCount} msgs, ${duration})`)}`);
      lines.push(`    ${fg('#C589E8', project)} — ${summary.replace(/\n/g, ' ').slice(0, 80)}`);
    }
    return lines.join('\n');
  }

  private getSessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }
}

function fg(color: string, text: string): string {
  const clean = color.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}
