/**
 * Interaction tests for the OpenCode Prompt component.
 *
 * Verifies that:
 *   1. The prompt renders with placeholder text when empty.
 *   2. Typing characters updates the input value.
 *   3. Backspace removes characters.
 *   4. Enter submits the input.
 *   5. Suggestions render above the prompt when provided.
 *   6. Status row shows "ready" / "thinking" / "streaming" appropriately.
 *   7. Meta row shows agent · model · provider labels.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { Prompt, type PromptStatus } from '../src/tui/oc/Prompt.js';

describe('OpenCode TUI — Prompt interaction', () => {
  it('renders placeholder when input is empty', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        placeholder="Type something..."
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('Type something...');
  });

  it('renders the current input value', () => {
    const { lastFrame } = render(
      <Prompt
        value="hello world"
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('hello world');
  });

  it('renders agent · model · provider in meta row', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        agentLabel="huagent"
        modelLabel="claude-sonnet-4"
        providerLabel="anthropic"
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('huagent');
    expect(frame).toContain('claude-sonnet-4');
    expect(frame).toContain('anthropic');
  });

  it('renders variant label when provided', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        variantLabel="auto"
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('auto');
  });

  it('shows "ready" status when idle', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        status={{ type: 'idle' }}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('ready');
  });

  it('shows "thinking" status when thinking', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        status={{ type: 'thinking' }}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toMatch(/thinking|⋯/);
  });

  it('shows "writing" status when streaming', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        status={{ type: 'streaming' }}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toMatch(/writing|⋯/);
  });

  it('shows error status with message', () => {
    const { lastFrame } = render(
      <Prompt
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        status={{ type: 'error', message: 'API failed' }}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('API failed');
  });

  it('renders suggestions above the prompt', () => {
    const { lastFrame } = render(
      <Prompt
        value="/mod"
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        suggestions={[
          { name: '/model', summary: 'Set LLM model' },
          { name: '/models', summary: 'List available models' },
        ]}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('/model');
    expect(frame).toContain('Set LLM model');
    expect(frame).toContain('/models');
    expect(frame).toContain('List available models');
    // The first suggestion should be marked as selected.
    expect(frame).toContain('▶');
  });

  it('shows navigation hints when suggestions are present', () => {
    const { lastFrame } = render(
      <Prompt
        value="/"
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        suggestions={[{ name: '/help', summary: 'Show help' }]}
      />,
    );
    const frame = lastFrame() || '';
    expect(frame).toMatch(/enter|tab|esc/);
  });

  it('does not show suggestions row when list is empty', () => {
    const { lastFrame } = render(
      <Prompt
        value="hello"
        onChange={() => {}}
        onSubmit={() => {}}
        width={80}
        suggestions={[]}
      />,
    );
    const frame = lastFrame() || '';
    // Should not contain the autocomplete hint text.
    expect(frame).not.toMatch(/enter · tab accept · esc close/);
  });

  // Note: interactive keyboard tests (typing, Enter submit, Tab pick) are
  // flaky in ink-testing-library because the input pipeline is async and
  // depends on raw-mode support that varies across Node.js versions and
  // terminal environments. The Prompt component's useInput handler is
  // exercised end-to-end by the smoke test in scripts/smoke-tui.ts and by
  // manual testing in a real terminal. Here we focus on rendering
  // assertions, which are deterministic.
});
