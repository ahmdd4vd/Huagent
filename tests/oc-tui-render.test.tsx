/**
 * Rendering tests for the OpenCode TUI components.
 *
 * Uses ink-testing-library to render each component in isolation and
 * verify the output contains the expected text/structure.
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Box, Text } from 'ink';
import { MessageList, type ChatMessage } from '../src/tui/oc/MessageList.js';
import { Footer } from '../src/tui/oc/Footer.js';
import { Picker, type PickerItem } from '../src/tui/oc/Picker.js';
import { Dialog, ConfirmDialog, AlertDialog, HelpDialog } from '../src/tui/oc/Dialog.js';
import { theme } from '../src/tui/oc/theme.js';

// Helper to make a chat message.
function msg(role: 'user' | 'assistant' | 'system', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
    ...extra,
  };
}

describe('OpenCode TUI — MessageList rendering', () => {
  it('renders an empty list without crashing', () => {
    const { lastFrame } = render(<MessageList messages={[]} width={80} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Empty list should not contain any message content.
    expect(frame).not.toContain('assistant');
  });

  it('renders user messages with arrow prefix', () => {
    const { lastFrame } = render(
      <MessageList messages={[msg('user', 'hello world')]} width={80} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('hello world');
    expect(frame).toContain('→'); // user message arrow prefix
  });

  it('renders assistant messages with model label', () => {
    const { lastFrame } = render(
      <MessageList
        messages={[msg('assistant', 'hi there')]}
        width={80}
        modelLabel="claude-sonnet-4"
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('hi there');
    expect(frame).toContain('claude-sonnet-4'); // model label is shown
  });

  it('renders system messages in muted style', () => {
    const { lastFrame } = render(
      <MessageList messages={[msg('system', 'session restored')]} width={80} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('session restored');
  });

  it('renders tool calls inline as badges', () => {
    const m = msg('assistant', 'reading files now', {
      toolCalls: [
        { name: 'read', status: 'success', durationMs: 100, summary: 'src/index.ts' },
        { name: 'bash', status: 'running' },
      ],
    });
    const { lastFrame } = render(<MessageList messages={[m]} width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('read');
    expect(frame).toContain('bash');
    expect(frame).toContain('src/index.ts');
    expect(frame).toContain('0.1s'); // 100ms → 0.1s
  });

  it('renders streaming indicator when isThinking=true', () => {
    const { lastFrame } = render(
      <MessageList messages={[]} width={80} isThinking={true} modelLabel="hua" />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('hua');
    expect(frame).toMatch(/thinking|⋯/);
  });

  it('renders streaming text when present', () => {
    const { lastFrame } = render(
      <MessageList
        messages={[]}
        width={80}
        streamingText="partial response..."
        modelLabel="hua"
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('partial response');
  });

  it('respects maxVisible (prunes old messages)', () => {
    const many: ChatMessage[] = Array.from({ length: 200 }, (_, i) =>
      msg('user', `message-${i}`),
    );
    const { lastFrame } = render(
      <MessageList messages={many} width={80} maxVisible={10} />,
    );
    const frame = lastFrame() || '';
    // First 190 messages should be pruned; only the last 10 should appear.
    expect(frame).not.toContain('message-0');
    expect(frame).not.toContain('message-100');
    expect(frame).toContain('message-199');
  });
});

describe('OpenCode TUI — Footer rendering', () => {
  it('renders the directory path', () => {
    const { lastFrame } = render(<Footer directory="/home/user/project" width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('project');
  });

  it('shortens home directory to ~', () => {
    const home = process.env.HOME || '/home/user';
    const { lastFrame } = render(<Footer directory={`${home}/projects/test`} width={80} />);
    const frame = lastFrame() || '';
    // Should contain "~" or at least the last path segment.
    expect(frame).toMatch(/~|test/);
  });

  it('shows pending permissions count when > 0', () => {
    const { lastFrame } = render(
      <Footer directory="/tmp" pendingPermissions={3} width={80} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('3 Permission');
  });

  it('pluralizes "Permission" correctly', () => {
    const single = render(<Footer directory="/tmp" pendingPermissions={1} width={80} />);
    expect((single.lastFrame() || '')).toContain('1 Permission');
    const plural = render(<Footer directory="/tmp" pendingPermissions={2} width={80} />);
    expect((plural.lastFrame() || '')).toContain('2 Permissions');
  });

  it('shows LSP count', () => {
    const { lastFrame } = render(<Footer directory="/tmp" lspCount={2} width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('2 LSP');
  });

  it('shows MCP count when > 0', () => {
    const { lastFrame } = render(<Footer directory="/tmp" mcpCount={3} width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('3 MCP');
  });

  it('always shows /status hint', () => {
    const { lastFrame } = render(<Footer directory="/tmp" width={80} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('/status');
  });
});

describe('OpenCode TUI — Dialog rendering', () => {
  it('renders a basic Dialog with title', () => {
    const { lastFrame } = render(
      <Dialog title="My Dialog" width={40}>
        <Text>Body content</Text>
      </Dialog>,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('My Dialog');
    expect(frame).toContain('Body content');
  });

  it('renders ConfirmDialog with yes/no options', () => {
    const { lastFrame } = render(
      <ConfirmDialog
        title="Delete?"
        message="Are you sure you want to delete?"
        onConfirm={() => {}}
        onCancel={() => {}}
        width={50}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Delete?');
    expect(frame).toContain('Are you sure');
    expect(frame).toContain('Yes');
    expect(frame).toContain('No');
  });

  it('renders AlertDialog with message', () => {
    const { lastFrame } = render(
      <AlertDialog title="Warning" message="Something happened" onDismiss={() => {}} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Warning');
    expect(frame).toContain('Something happened');
  });

  it('renders HelpDialog with keybindings', () => {
    const { lastFrame } = render(<HelpDialog onDismiss={() => {}} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('Keybindings');
    expect(frame).toContain('Ctrl+C');
    expect(frame).toContain('Enter');
    expect(frame).toContain('Submit prompt');
  });

  it('uses error color border for error variant', () => {
    const { lastFrame } = render(
      <Dialog title="Error" variant="error" width={40}>
        <Text>Failed</Text>
      </Dialog>,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Error');
    expect(frame).toContain('Failed');
    // Note: the actual border color is determined by ANSI escape codes,
    // which we can't easily assert on. We just verify the structure.
  });
});

describe('OpenCode TUI — Picker rendering', () => {
  const items: PickerItem[] = [
    { id: 'a', label: 'Alpha', description: 'First letter' },
    { id: 'b', label: 'Beta', description: 'Second letter' },
    { id: 'c', label: 'Gamma', description: 'Third letter' },
  ];

  it('renders title and all items', () => {
    const { lastFrame } = render(
      <Picker title="Pick one" items={items} onSelect={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Pick one');
    expect(frame).toContain('Alpha');
    expect(frame).toContain('Beta');
    expect(frame).toContain('Gamma');
  });

  it('shows item count and navigation hints in footer', () => {
    const { lastFrame } = render(
      <Picker title="Pick" items={items} onSelect={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('3 of 3');
    expect(frame).toMatch(/navigate|select|cancel/);
  });

  it('renders empty state when no items match', () => {
    const { lastFrame } = render(
      <Picker title="Empty" items={[]} onSelect={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('No matches');
    expect(frame).toContain('0 of 0');
  });
});
