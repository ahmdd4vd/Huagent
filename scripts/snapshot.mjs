// Render the new TUI components statically to show their visual structure.
// Bypasses NewLayout (which uses useEffect+subscribe) and renders each
// piece directly so we can see them clearly.
import React from 'react';
import { render, Box, Text } from 'ink';
import { Writable } from 'node:stream';
import { CompactHeader } from '/root/huagent/dist/tui/compact-header.js';
import { ModeChips, SubagentPanel, StatusBar, Toasts } from '/root/huagent/dist/tui/status.js';
import { ActivityFeed } from '/root/huagent/dist/tui/activity-feed.js';
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
  }
}

main().catch(console.error);
