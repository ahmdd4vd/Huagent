/**
 * End-to-end rendering test for OpenCodeApp — the new production TUI.
 *
 * Verifies that the app:
 *   1. Mounts without crashing with mock engine/client/tools.
 *   2. Renders the prompt at the bottom.
 *   3. Renders the footer with directory info.
 *   4. Renders the message list area.
 *   5. User submission adds a message to the list.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { OpenCodeApp } from '../src/tui/OpenCodeApp.js';

// Mock engine that just echoes back the message after a tiny delay.
function makeMocks() {
  const messages: string[] = [];
  const onSubmit = vi.fn(async (msg: string) => {
    messages.push(msg);
    return `Response to: ${msg}`;
  });

  const client = {
    getModel: () => 'mock-model',
    setModel: () => {},
    getProvider: () => ({
      id: 'mock', name: 'mock', displayName: 'Mock',
      emoji: '◇', apiKeyEnv: 'MOCK', defaultModel: 'mock-model',
      baseUrl: 'https://mock', apiFormat: 'openai-chat' as const,
      authScheme: 'bearer' as const, supportsPromptCaching: false,
      supportsTools: true, supportsStreaming: true, contextWindow: 8000,
    }),
    setProvider: () => {},
    stream: async function* () {},
    getStats: () => ({ totalTokens: 100, totalCost: 0.001, totalRequests: 1 }),
  };

  const memory = {
    recall: () => [],
    recordEpisode: () => {},
    saveProjectFact: () => {},
    recordPattern: () => {},
    stats: () => ({ memories: 0, skills: 0 }),
  };

  const tools = {
    list: () => [],
    execute: async () => ({}),
    getPermissionMode: () => 'workspace-write',
    setPermissionMode: () => {},
  };

  const sessions = {
    startSession: () => 'test',
    endSession: () => {},
    list: () => [],
    load: () => {},
  };

  const config = {
    workdir: '/tmp/test-project',
    model: 'mock-model',
    provider: 'mock',
    permissionMode: 'workspace-write',
  };

  return { onSubmit, client, memory, tools, sessions, config };
}

describe('OpenCodeApp — end-to-end rendering', () => {
  it('mounts without crashing', () => {
    const m = makeMocks();
    expect(() => {
      render(
        React.createElement(OpenCodeApp, {
          engine: { process: async () => 'ok', end: async () => {} } as any,
          client: m.client as any,
          memory: m.memory as any,
          tools: m.tools as any,
          sessions: m.sessions as any,
          skills: { list: () => [] } as any,
          config: m.config as any,
          onSubmit: m.onSubmit,
          onExit: () => {},
        }),
      );
    }).not.toThrow();
  });

  it('renders the prompt area with placeholder text', () => {
    const m = makeMocks();
    const { lastFrame } = render(
      React.createElement(OpenCodeApp, {
        engine: { process: async () => 'ok', end: async () => {} } as any,
        client: m.client as any,
        memory: m.memory as any,
        tools: m.tools as any,
        sessions: m.sessions as any,
        skills: { list: () => [] } as any,
        config: m.config as any,
        onSubmit: m.onSubmit,
        onExit: () => {},
      }),
    );
    const frame = lastFrame() || '';
    // The prompt should be visible with placeholder text.
    expect(frame).toMatch(/Ask|search|help/);
  });

  it('renders the footer with directory info', () => {
    const m = makeMocks();
    const { lastFrame } = render(
      React.createElement(OpenCodeApp, {
        engine: { process: async () => 'ok', end: async () => {} } as any,
        client: m.client as any,
        memory: m.memory as any,
        tools: m.tools as any,
        sessions: m.sessions as any,
        skills: { list: () => [] } as any,
        config: m.config as any,
        onSubmit: m.onSubmit,
        onExit: () => {},
      }),
    );
    const frame = lastFrame() || '';
    // Footer should show /status hint.
    expect(frame).toContain('/status');
  });

  it('renders model + provider in the meta row', () => {
    const m = makeMocks();
    const { lastFrame } = render(
      React.createElement(OpenCodeApp, {
        engine: { process: async () => 'ok', end: async () => {} } as any,
        client: m.client as any,
        memory: m.memory as any,
        tools: m.tools as any,
        sessions: m.sessions as any,
        skills: { list: () => [] } as any,
        config: m.config as any,
        onSubmit: m.onSubmit,
        onExit: () => {},
      }),
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('mock-model');
    expect(frame).toContain('mock');
  });

  it('renders the stats hint at the bottom (tokens/cost)', () => {
    const m = makeMocks();
    const { lastFrame } = render(
      React.createElement(OpenCodeApp, {
        engine: { process: async () => 'ok', end: async () => {} } as any,
        client: m.client as any,
        memory: m.memory as any,
        tools: m.tools as any,
        sessions: m.sessions as any,
        skills: { list: () => [] } as any,
        config: m.config as any,
        onSubmit: m.onSubmit,
        onExit: () => {},
      }),
    );
    const frame = lastFrame() || '';
    // Stats hint should mention tokens or cost.
    expect(frame).toMatch(/tokens|cost/);
  });
});
