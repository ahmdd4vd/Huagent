// Render the new TUI components statically to show their visual structure.
// Bypasses NewLayout (which uses useEffect+subscribe) and renders each
// piece directly so we can see them clearly.
import React from 'react';
import { render, Box, Text } from 'ink';
import { Writable } from 'node:stream';
import { CompactHeader } from '/root/huagent/dist/tui/compact-header.js';
import { ModeChips, SubagentPanel, StatusBar, Toasts } from '/root/huagent/dist/tui/status.js';
import { ActivityFeed } from '/root/huagent/dist/tui/activity-feed.js';
import { Picker } from '/root/huagent/dist/tui/picker.js';
import { QuestionPrompt } from '/root/huagent/dist/tui/question-prompt.js';
import { PlanMode } from '/root/huagent/dist/tui/plan-mode.js';
import { ToolConfirmation } from '/root/huagent/dist/tui/tool-confirmation.js';
import { SessionResume } from '/root/huagent/dist/tui/session-resume.js';
import { theme } from '/root/huagent/dist/tui/theme.js';

class StringWritable extends Writable {
  constructor(opts = {}) {
    super(opts);
    this.chunks = [];
    this.columns = opts.columns || 120;
    this.rows = opts.rows || 40;
  }
  _write(chunk, enc, cb) { this.chunks.push(chunk.toString()); cb(); }
  toString() { return this.chunks.join(''); }
}

function renderOnce(element, ms = 600, cols = 120) {
  return new Promise((resolve) => {
    const stdout = new StringWritable({ columns: cols });
    Object.defineProperty(process.stdout, 'columns', { value: cols, configurable: true });
    const app = render(element, { stdout, debug: false, exitOnCtrlC: false });
    setTimeout(() => {
      app.unmount();
      const raw = stdout.toString();
      const clean = raw
        .replace(/\x1b\[\?25[lh]/g, '')
        .replace(/\x1b\[\?1049[hl]/g, '')
        .replace(/\x1b\[\d+;\d+H/g, '')
        .replace(/\x1b\[\d*[AJK]/g, '')
        .replace(/\x1b\[\d*G/g, '')
        .replace(/\x1b\[2J/g, '')
        .replace(/\x1b\[0?m/g, '')
        .replace(/\r/g, '');
      resolve(clean);
    }, ms);
  });
}

const sampleActivities = [
  { id: 'a1', kind: 'plan', status: 'success', summary: 'add jwt auth to our express app', meta: { hypothesis: 'jose lib, RS256' }, start_ts: Date.now() - 28000, end_ts: Date.now() - 27000, durationMs: 1000 },
  { id: 'a2', kind: 'read', status: 'success', summary: 'src/middleware/auth.ts', detail: '47 lines', start_ts: Date.now() - 25000, end_ts: Date.now() - 24000, durationMs: 800 },
  { id: 'a3', kind: 'read', status: 'success', summary: 'src/routes/users.ts', detail: '89 lines', start_ts: Date.now() - 23000, end_ts: Date.now() - 22000, durationMs: 600 },
  { id: 'a4', kind: 'observe', status: 'success', summary: 'Read → found existing session-based auth', start_ts: Date.now() - 21000, end_ts: Date.now() - 20000, durationMs: 200 },
  { id: 'a5', kind: 'subagent', status: 'success', summary: 'architect → designed JWT middleware', start_ts: Date.now() - 18000, end_ts: Date.now() - 12000, durationMs: 6000 },
  { id: 'a6', kind: 'ground', status: 'success', summary: 'ground: 2 checks (240ms)', start_ts: Date.now() - 11000, end_ts: Date.now() - 10000, durationMs: 240 },
  { id: 'a7', kind: 'write', status: 'success', summary: 'src/middleware/jwt.ts', detail: '142 lines', start_ts: Date.now() - 8000, end_ts: Date.now() - 6000, durationMs: 2000 },
  { id: 'a8', kind: 'edit', status: 'success', summary: 'src/routes/users.ts', start_ts: Date.now() - 5000, end_ts: Date.now() - 4000, durationMs: 800 },
  { id: 'a9', kind: 'verify', status: 'success', summary: 'src/middleware/jwt.ts: passed (0)', detail: '12/12 pass', start_ts: Date.now() - 3000, end_ts: Date.now() - 500, durationMs: 2340 },
];

const sampleSubagents = [
  { id: 's1', name: 'architect', task: 'Design JWT middleware', status: 'success', progress: 1.0 },
  { id: 's2', name: 'reviewer', task: 'Check code quality', status: 'running', progress: 0.65 },
];

const sampleToasts = [
  { id: 't1', level: 'success', message: 'Tests passed: 12/12 in 2.3s', createdAt: Date.now() - 500 },
  { id: 't2', level: 'info', message: 'Scope set to src/middleware/jwt.ts', createdAt: Date.now() - 2000 },
];

async function main() {
  const view = process.argv[2] || 'full';

  if (view === 'header') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'mock',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(ModeChips, {
            autonomous: false, scope: 'src/middleware/jwt.ts',
            permissionMode: 'workspace-write', model: 'MiniMax-M3',
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'feed') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: theme.fg }, 'activity panel:'),
        React.createElement(ActivityFeed, { activities: sampleActivities, width: 90, maxItems: 20 }),
      )
    );
    console.log(out);
  } else if (view === 'subagents') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: theme.fg }, 'subagent panel:'),
        React.createElement(SubagentPanel, { subagents: sampleSubagents, width: 70 }),
      )
    );
    console.log(out);
  } else if (view === 'toasts') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: theme.fg }, 'toasts:'),
        React.createElement(Toasts, { toasts: sampleToasts, width: 70 }),
      )
    );
    console.log(out);
  } else if (view === 'status') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(Text, { color: theme.fg }, 'status bar:'),
        React.createElement(StatusBar, {
          stats: { tokens: 4230, cost: 0.0127, requests: 0, steps: 8 },
          permissionMode: 'workspace-write',
          width: 100,
        })
      )
    );
    console.log(out);
  } else if (view === 'autonomous') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(CompactHeader, {
          autonomous: true, scope: 'src/middleware/jwt.ts',
          permissionMode: 'bypass', model: 'MiniMax-M3', provider: 'mock',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(ModeChips, {
            autonomous: true, scope: 'src/middleware/jwt.ts',
            permissionMode: 'bypass', model: 'MiniMax-M3',
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'full') {
    // Full composed view: header + messages + activity feed + subagents + toasts + status
    const messages = [
      { key: 'm1', role: 'user', content: 'add jwt auth to our express app, replace the old session thing' },
      { key: 'm2', role: 'assistant', content: 'Got it. Let me first scope the existing auth, then design a JWT middleware that integrates cleanly.' },
    ];
    const messageNodes = messages.map((m) =>
      React.createElement(Box, { key: m.key, flexDirection: 'row', marginBottom: 0 },
        React.createElement(Text, { color: m.role === 'user' ? theme.gold : theme.lavender, bold: true },
          m.role === 'user' ? ' ❯ ' : ' ✧ '),
        React.createElement(Text, { color: theme.fg }, m.content),
      )
    );
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'mock',
        }),
        React.createElement(Box, { flexDirection: 'column', marginY: 1 }, ...messageNodes),
        React.createElement(Box, { flexDirection: 'column' },
          React.createElement(ActivityFeed, { activities: sampleActivities, width: 110, maxItems: 20 })
        ),
        React.createElement(Box, { marginTop: 1, flexDirection: 'row' },
          React.createElement(Box, { marginRight: 2 },
            React.createElement(SubagentPanel, { subagents: sampleSubagents, width: 55 })
          ),
          React.createElement(Box, { flexDirection: 'column' },
            React.createElement(Toasts, { toasts: sampleToasts, width: 55 })
          ),
        ),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(StatusBar, {
            stats: { tokens: 4230, cost: 0.0127, requests: 0, steps: 8 },
            permissionMode: 'workspace-write',
            engine: 'v4',
            width: 110,
          })
        ),
        React.createElement(Box, { marginTop: 1, flexDirection: 'column' },
          React.createElement(Text, { color: theme.fgSubtle, dimColor: true },
            '⌨  '),
          React.createElement(Text, { color: theme.fgSubtle }, 'Ctrl+P'),
          React.createElement(Text, { color: theme.fgSubtle }, ' provider  ·  '),
          React.createElement(Text, { color: theme.fgSubtle }, 'Ctrl+M'),
          React.createElement(Text, { color: theme.fgSubtle }, ' model  ·  '),
          React.createElement(Text, { color: theme.fgSubtle }, 'Ctrl+S'),
          React.createElement(Text, { color: theme.fgSubtle }, ' scope  ·  '),
          React.createElement(Text, { color: theme.fgSubtle }, 'Ctrl+K'),
          React.createElement(Text, { color: theme.fgSubtle }, ' palette  ·  '),
          React.createElement(Text, { color: theme.fgSubtle }, 'Ctrl+L'),
          React.createElement(Text, { color: theme.fgSubtle }, ' activity'),
        ),
      )
    );
    console.log(out);
  } else if (view === 'narrow') {
    // Test at 80 cols (narrow terminal)
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'mock',
          width: 80,
        }),
        React.createElement(StatusBar, {
          stats: { tokens: 4230, cost: 0.0127, requests: 0, steps: 8 },
          permissionMode: 'workspace-write', engine: 'v4', width: 80,
        })
      ),
      500,
      80
    );
    console.log(out);
  } else if (view === 'messages') {
    const messages = [
      { key: 'm1', role: 'user', content: 'add jwt auth to our express app, replace the old session thing' },
      { key: 'm2', role: 'assistant', content: 'Got it. Let me first scope the existing auth, then design a JWT middleware that integrates cleanly.' },
    ];
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column' },
        messages.map((m) =>
          React.createElement(Box, { key: m.key, flexDirection: 'row', marginBottom: 1 },
            React.createElement(Text, { color: m.role === 'user' ? theme.gold : theme.lavender },
              m.role === 'user' ? '❯ ' : '✧ hua '),
            React.createElement(Text, { color: theme.fg }, m.content),
          )
        ),
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'mock',
        }),
      )
    );
    console.log(out);
  } else if (view === 'picker-provider') {
    const items = [
      { id: 'anthropic', label: 'Anthropic', detail: 'anthropic', description: 'Claude models · API at api.anthropic.com', meta: '✓ key set', current: true },
      { id: 'openai', label: 'OpenAI', detail: 'openai', description: 'GPT-4o, o1, etc.', meta: '✓ key set' },
      { id: 'gemini', label: 'Google Gemini', detail: 'gemini', description: '1M context, multimodal', meta: '○ no key' },
      { id: 'groq', label: 'Groq', detail: 'groq', description: 'Ultra-fast inference', meta: '✓ key set' },
      { id: 'cerebras', label: 'Cerebras', detail: 'cerebras', description: 'Wafer-scale fast LLM', meta: '○ no key', disabled: true },
      { id: 'deepseek', label: 'DeepSeek', detail: 'deepseek', description: 'Reasoning + chat models', meta: '✓ key set' },
      { id: 'custom', label: 'Custom (TokenRouter, etc.)', detail: 'custom', description: 'HUAGENT_BASE_URL', meta: '○ base url', current: false },
    ];
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(Picker, {
            title: 'Switch Provider',
            items,
            onSelect: () => {},
            onCancel: () => {},
            width: 100,
            maxVisible: 8,
          })
        ),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(StatusBar, {
            stats: { tokens: 4230, cost: 0.0127, requests: 0, steps: 8 },
            permissionMode: 'workspace-write', engine: 'v3', width: 100,
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'picker-model') {
    const items = [
      { id: 'MiniMax-M3', label: 'MiniMax-M3', detail: 'MiniMax M3', description: 'Latest flagship, balanced', meta: 'Flagship', current: true },
      { id: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022', detail: 'Claude 3.5 Sonnet', description: 'Reliable, fast, good tools', meta: 'Flagship' },
      { id: 'claude-3-5-haiku-20241022', label: 'claude-3-5-haiku-20241022', detail: 'Claude 3.5 Haiku', description: 'Cheap + fast', meta: 'Fast' },
      { id: 'claude-3-opus-20240229', label: 'claude-3-opus-20240229', detail: 'Claude 3 Opus', description: 'Deep reasoning, slow', meta: 'Reasoning' },
    ];
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(Picker, {
            title: 'Switch Model · Anthropic',
            items,
            onSelect: () => {},
            onCancel: () => {},
            width: 100,
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'question') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(QuestionPrompt, {
            request: {
              id: 'q1',
              questions: [
                { question: 'Which database should we use for the auth service?', header: 'DB',
                  options: [
                    { label: 'PostgreSQL', description: 'Relational, ACID, strong typing' },
                    { label: 'MongoDB', description: 'Document store, flexible schema' },
                    { label: 'SQLite', description: 'Embedded, no server needed' },
                    { label: 'Redis', description: 'In-memory, blazing fast' },
                  ]
                },
                { question: 'How should we hash passwords?', header: 'Hash',
                  options: [
                    { label: 'bcrypt', description: 'Industry standard, slow by design' },
                    { label: 'argon2', description: 'Modern, memory-hard' },
                    { label: 'scrypt', description: 'CPU + memory hard' },
                  ]
                },
              ],
            },
            onSubmit: () => {},
            onCancel: () => {},
            width: 100,
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'plan') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(PlanMode, {
            plan: {
              goal: 'Add JWT auth to express app, replace the old session thing',
              steps: [
                { id: '1', description: 'Read existing auth code', tool: 'read', parallel_group: 0 },
                { id: '2', description: 'Read middleware directory structure', tool: 'bash', parallel_group: 0 },
                { id: '3', description: 'Design JWT middleware (sign + verify)', tool: 'write', args: { path: 'src/middleware/jwt.ts' } },
                { id: '4', description: 'Update routes to use JWT', tool: 'edit', args: { path: 'src/routes/auth.ts' } },
                { id: '5', description: 'Add JWT tests', tool: 'write', args: { path: 'tests/jwt.test.ts' } },
                { id: '6', description: 'Run tests + lint', tool: 'bash', args: { command: 'npm test && npm run lint' } },
              ],
              taskType: 'code_write',
              complexity: 'moderate',
            },
            onApprove: () => {},
            onReject: () => {},
            onEdit: () => {},
            width: 100,
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'permission') {
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(ToolConfirmation, {
            request: {
              id: 'p1',
              tool: 'bash',
              args: { command: 'rm -rf node_modules && npm install' },
              preview: 'rm -rf node_modules && npm install',
              reason: 'Mutating command in workspace',
            },
            onDecide: () => {},
            width: 100,
          })
        ),
      )
    );
    console.log(out);
  } else if (view === 'resume') {
    const sessions = [
      { id: 'a1b2c3d4e5f6', startTime: Date.now() - 30_000, projectPath: '/home/david/projects/huagent', summary: 'Add JWT auth to express app', messageCount: 12, model: 'MiniMax-M3', provider: 'anthropic' },
      { id: 'b2c3d4e5f6g7', startTime: Date.now() - 7200_000, projectPath: '/home/david/projects/blog', summary: 'Write a markdown blog post about TUI design', messageCount: 4, model: 'claude-3-5-sonnet-20241022', provider: 'anthropic' },
      { id: 'c3d4e5f6g7h8', startTime: Date.now() - 86400_000, projectPath: '/home/david/projects/api', summary: 'Refactor REST API to use middleware', messageCount: 8, model: 'gpt-4o', provider: 'openai' },
      { id: 'd4e5f6g7h8i9', startTime: Date.now() - 172800_000, projectPath: '/home/david/projects/huagent', summary: 'Build a CLI tool for managing dotfiles', messageCount: 0, model: 'MiniMax-M3', provider: 'anthropic' },
    ];
    const out = await renderOnce(
      React.createElement(Box, { flexDirection: 'column', paddingX: 1 },
        React.createElement(CompactHeader, {
          autonomous: false, scope: 'src/middleware/jwt.ts',
          permissionMode: 'workspace-write', model: 'MiniMax-M3', provider: 'anthropic',
        }),
        React.createElement(Box, { marginTop: 1 },
          React.createElement(SessionResume, {
            sessions,
            currentSessionId: 'a1b2c3d4e5f6',
            onSelect: () => {},
            onCancel: () => {},
            width: 110,
          })
        ),
      )
    );
    console.log(out);
  }
}

main().catch(console.error);
