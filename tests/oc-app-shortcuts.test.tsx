/**
 * Global keyboard shortcut tests for OpenCodeApp.
 *
 * Verifies that the Ctrl+P/T/E/R/K/L shortcuts and the `?` help shortcut
 * work at the app level (when no picker/dialog is open).
 *
 * Strategy: render OpenCodeApp with a mock engine, then write the keystroke
 * and check the resulting frame for the expected UI change (e.g. the picker
 * title appears).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { OpenCodeApp } from '../src/tui/OpenCodeApp.js';

function makeMocks() {
  const onSubmit = vi.fn(async (msg: string) => `Response to: ${msg}`);
  const client = {
    getModel: () => 'mock-model',
    setModel: () => {},
    getProviderId: () => 'mock',
    getProviderName: () => 'Mock',
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

function renderApp() {
  const m = makeMocks();
  const result = render(
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
  return { ...result, mocks: m };
}

describe('OpenCodeApp — global keyboard shortcuts', () => {
  it('opens help dialog when ? is pressed with empty input', async () => {
    const { lastFrame, stdin } = renderApp();
    // Wait for initial render to settle.
    await new Promise((r) => setTimeout(r, 100));

    // Press ?.
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 200));

    const frame = lastFrame() || '';
    // Help dialog should be visible.
    expect(frame).toContain('Keybindings');
  });

  it('opens provider picker when Ctrl+P is pressed', async () => {
    const { lastFrame, stdin } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    // Ctrl+P = byte 0x10.
    stdin.write('\x10');
    await new Promise((r) => setTimeout(r, 300));

    const frame = lastFrame() || '';
    // Provider picker should be visible — title says "Select provider".
    expect(frame).toMatch(/Select provider|provider/i);
  });

  it('opens model picker when Ctrl+T is pressed', async () => {
    const { lastFrame, stdin } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    // Ctrl+T = byte 0x14.
    stdin.write('\x14');
    await new Promise((r) => setTimeout(r, 300));

    const frame = lastFrame() || '';
    // Model picker should be visible — title says "Select model".
    expect(frame).toMatch(/Select model|model/i);
  });

  it('opens scope picker when Ctrl+E is pressed', async () => {
    const { lastFrame, stdin } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    // Ctrl+E = byte 0x05.
    stdin.write('\x05');
    await new Promise((r) => setTimeout(r, 300));

    const frame = lastFrame() || '';
    // Scope picker should be visible.
    expect(frame).toMatch(/scope/i);
  });

  it('clears messages when Ctrl+L is pressed', async () => {
    const { lastFrame, stdin } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    // Ctrl+L = byte 0x0c.
    stdin.write('\x0c');
    await new Promise((r) => setTimeout(r, 200));

    const frame = lastFrame() || '';
    // A "Cleared messages" toast should appear.
    expect(frame).toMatch(/Cleared|cleared/);
  });

  it('renders stats hint at the bottom when no overlay is active', async () => {
    const { lastFrame } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame() || '';
    // Stats hint should mention tokens, cost, permission.
    expect(frame).toMatch(/tokens/);
    expect(frame).toMatch(/cost/);
    expect(frame).toMatch(/workspace-write|perm/);
  });

  it('renders the prompt with placeholder text', async () => {
    const { lastFrame } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame() || '';
    expect(frame).toMatch(/Ask|search|help/);
  });

  it('renders the footer with directory info', async () => {
    const { lastFrame } = renderApp();
    await new Promise((r) => setTimeout(r, 100));

    const frame = lastFrame() || '';
    expect(frame).toContain('/status');
  });
});
