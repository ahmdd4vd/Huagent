#!/usr/bin/env tsx
/**
 * test-dialogs.ts — Tests for the OpenCode-style dialog components.
 */

import React from "react";
import { render, Box, Text } from "ink";
import { Writable } from "node:stream";
import { QuestionPrompt } from "../src/tui/question-prompt.js";
import { PlanMode } from "../src/tui/plan-mode.js";
import { ToolConfirmation } from "../src/tui/tool-confirmation.js";
import { SessionResume, buildSessionItems, type SessionView } from "../src/tui/session-resume.js";
import { theme } from "../src/tui/theme.js";
import { getDialogController } from "../src/tui/dialog-controller.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

class StringWritable extends Writable {
  chunks: string[] = [];
  _write(chunk: any, enc: any, cb: any) { this.chunks.push(chunk.toString()); cb(); }
  toString() { return this.chunks.join(""); }
}

async function renderOnce(element: any, ms = 500, cols = 100): Promise<string> {
  return new Promise((resolve) => {
    const stdout = new StringWritable();
    Object.defineProperty(process.stdout, "columns", { value: cols, configurable: true });
    const app = render(element, { stdout, debug: false, exitOnCtrlC: false });
    setTimeout(() => {
      app.unmount();
      const raw = stdout.toString();
      const clean = raw
        .replace(/\x1b\[\?25[lh]/g, "")
        .replace(/\x1b\[\?1049[hl]/g, "")
        .replace(/\x1b\[\d+;\d+H/g, "")
        .replace(/\x1b\[\d*[AJK]/g, "")
        .replace(/\x1b\[\d*G/g, "")
        .replace(/\x1b\[2J/g, "")
        .replace(/\x1b\[0?m/g, "")
        .replace(/\r/g, "");
      resolve(clean);
    }, ms);
  });
}

async function main() {
  // ─── 1. DialogController ──────────────────────────────────────
  section("1. DialogController");
  const dlg = getDialogController();
  test("controller is singleton", dlg === getDialogController());
  test("initial state has no dialogs",
    dlg.getState().question === null &&
    dlg.getState().permission === null &&
    dlg.getState().plan === null);

  // askUser
  const qPromise = dlg.askUser({
    questions: [{ question: 'pick one', header: 'pick', options: [{ label: 'A' }, { label: 'B' }] }],
  });
  test("askUser sets question state", dlg.getState().question !== null);
  test("askUser generates id", Boolean(dlg.getState().question?.request.id));

  dlg.resolveQuestion([['A']]);
  test("resolveQuestion clears state", dlg.getState().question === null);
  const qResult = await qPromise;
  test("resolveQuestion returns answers", qResult[0][0] === 'A');

  // requestPermission
  const pPromise = dlg.requestPermission({
    tool: 'bash',
    args: { command: 'rm -rf /' },
    preview: 'rm -rf /',
    reason: 'Destructive command',
  });
  test("requestPermission sets state", dlg.getState().permission !== null);
  dlg.resolvePermission('deny');
  test("resolvePermission clears state", dlg.getState().permission === null);
  const pResult = await pPromise;
  test("resolvePermission returns decision", pResult === 'deny');

  // reviewPlan
  const plan = { goal: 'test', steps: [{ description: 'step 1' }] };
  const rPromise = dlg.reviewPlan(plan as any);
  test("reviewPlan sets state", dlg.getState().plan !== null);
  dlg.resolvePlan('approve');
  test("resolvePlan clears state", dlg.getState().plan === null);
  const rResult = await rPromise;
  test("resolvePlan returns decision", rResult === 'approve');

  // Subscribe / notify
  let notifyCount = 0;
  const unsub = dlg.subscribe(() => notifyCount++);
  const p2 = dlg.askUser({ questions: [{ question: 'q', header: 'h', options: [{ label: 'A' }] }] });
  test("subscribe notified on askUser", notifyCount > 0);
  dlg.resolveQuestion([['A']]);
  await p2;
  unsub();

  // Event subscription
  let events: any[] = [];
  const unsubE = dlg.subscribeEvents((e) => events.push(e));
  dlg.publishEvent({ type: 'plan_created', plan: { steps: [] } });
  test("subscribeEvents receives events", events.length > 0 && events[0].type === 'plan_created');
  unsubE();

  // ─── 2. buildSessionItems ─────────────────────────────────────
  section("2. buildSessionItems");
  const sessions: SessionView[] = [
    { id: 'a', startTime: Date.now() - 60_000, projectPath: '/home/user/proj', summary: 'first session', messageCount: 5, model: 'm', provider: 'p' },
    { id: 'b', startTime: Date.now() - 3_600_000, projectPath: '/var/lib', summary: 'old session', messageCount: 0 },
  ];
  const items = buildSessionItems(sessions, 'a');
  test("buildSessionItems returns same count", items.length === 2);
  test("buildSessionItems marks current", items.find((i) => i.id === 'a')?.current === true);
  test("buildSessionItems includes summary", items[0].label.includes('first session'));
  test("buildSessionItems includes project", items[0].detail?.includes('proj'));
  test("buildSessionItems includes msg count", items[0].detail?.includes('5 msgs'));
  test("buildSessionItems formats time", items[0].detail?.match(/(just now|m ago|h ago)/) !== null);

  const emptyItems = buildSessionItems([], undefined);
  test("buildSessionItems handles empty", emptyItems.length === 0);

  const longPath = '/home/user/very/long/path/to/project';
  const longItem = buildSessionItems(
    [{ id: 'x', startTime: Date.now(), projectPath: longPath, summary: 'x', messageCount: 1 }],
    undefined,
  )[0];
  test("buildSessionItems truncates long paths", longItem.detail?.includes('…/') || longItem.detail?.includes(longPath));

  // ─── 3. Visual rendering ──────────────────────────────────────
  section("3. Visual rendering");

  // QuestionPrompt: single question
  const out1 = await renderOnce(
    React.createElement(Box, { flexDirection: "column", paddingX: 1 },
      React.createElement(QuestionPrompt, {
        request: {
          id: 'q1',
          questions: [{
            question: 'Which database?',
            header: 'DB',
            options: [
              { label: 'PostgreSQL', description: 'Relational, ACID' },
              { label: 'MongoDB', description: 'Document store' },
              { label: 'SQLite', description: 'Embedded' },
            ],
          }],
        },
        onSubmit: () => {},
        onCancel: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("question renders title", out1.includes("Question"));
  test("question shows question text", out1.includes("Which database"));
  test("question shows all 3 options", out1.includes("PostgreSQL") && out1.includes("MongoDB") && out1.includes("SQLite"));
  test("question shows descriptions", out1.includes("Relational") && out1.includes("Document store"));
  test("question shows numbered options", /1\. PostgreSQL/.test(out1) && /2\. MongoDB/.test(out1));
  test("question shows navigate hint", out1.includes("navigate"));
  test("question shows select hint", out1.includes("select"));

  // QuestionPrompt: multi-question
  const out2 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(QuestionPrompt, {
        request: {
          id: 'q2',
          questions: [
            { question: 'Framework?', header: 'FW', options: [{ label: 'Express' }, { label: 'Fastify' }] },
            { question: 'Language?', header: 'Lang', options: [{ label: 'TypeScript' }, { label: 'JavaScript' }] },
          ],
        },
        onSubmit: () => {},
        onCancel: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("multi-question shows Q1 tab", out2.includes("Q1"));
  test("multi-question shows Q2 tab", out2.includes("Q2"));
  test("multi-question shows confirm tab", out2.includes("Confirm"));

  // QuestionPrompt: multi-select
  const out3 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(QuestionPrompt, {
        request: {
          id: 'q3',
          questions: [{
            question: 'Pick features:',
            header: 'feat',
            options: [{ label: 'Auth' }, { label: 'API' }, { label: 'DB' }],
            multiSelect: true,
          }],
        },
        onSubmit: () => {},
        onCancel: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("multi-select shows toggle hint", out3.includes("multi-select"));

  // PlanMode
  const out4 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(PlanMode, {
        plan: {
          goal: 'Add JWT auth',
          steps: [
            { id: '1', description: 'Read auth.ts', tool: 'read', parallel_group: 0 },
            { id: '2', description: 'Write jwt.ts', tool: 'write', args: { path: 'src/jwt.ts' } },
            { id: '3', description: 'Run tests', tool: 'bash', args: { command: 'npm test' } },
          ],
          taskType: 'code_write',
          complexity: 'moderate',
        },
        onApprove: () => {},
        onReject: () => {},
        onEdit: () => {},
        width: 90,
      })
    ),
    300,
  );
  test("plan shows title", out4.includes("Plan Review"));
  test("plan shows goal", out4.includes("JWT auth"));
  test("plan shows steps", out4.includes("Read auth.ts") && out4.includes("Write jwt.ts") && out4.includes("Run tests"));
  test("plan shows tool labels", out4.includes("[read]") && out4.includes("[write]") && out4.includes("[bash]"));
  test("plan shows approve hint", out4.includes("approve"));
  test("plan shows reject hint", out4.includes("reject"));
  test("plan shows edit hint", out4.includes("edit"));

  // ToolConfirmation: bash command
  const out5 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(ToolConfirmation, {
        request: {
          id: 'p1',
          tool: 'bash',
          args: { command: 'rm -rf node_modules' },
          preview: 'rm -rf node_modules',
          reason: 'Destructive command',
        },
        onDecide: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("tool permission shows title", out5.includes("Permission Required"));
  test("tool permission shows tool", out5.includes("bash"));
  test("tool permission shows reason", out5.includes("Destructive command"));
  test("tool permission shows preview", out5.includes("rm -rf node_modules"));
  test("tool permission shows all 4 choices", out5.includes("Allow") && out5.includes("Deny") && out5.includes("Always"));
  test("tool permission shows hints", out5.includes("select"));

  const out6 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(ToolConfirmation, {
        request: {
          id: 'p2',
          tool: 'write',
          args: { path: '/etc/passwd' },
          preview: '/etc/passwd',
          reason: 'Writes outside workspace',
        },
        onDecide: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("write tool shows path", out6.includes("/etc/passwd"));
  test("write tool shows reason", out6.includes("outside workspace"));

  // SessionResume
  const out7 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(SessionResume, {
        sessions,
        currentSessionId: 'a',
        onSelect: () => {},
        onCancel: () => {},
        width: 100,
      })
    ),
    300,
  );
  test("session resume shows title", out7.includes("Resume Session"));
  test("session resume shows first session", out7.includes("first session"));
  test("session resume shows second session", out7.includes("old session"));
  test("session resume marks current", out7.includes("current"));

  const out8 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(SessionResume, {
        sessions: [],
        onSelect: () => {},
        onCancel: () => {},
        width: 80,
      })
    ),
    300,
  );
  test("empty session resume shows empty state", out8.includes("No saved sessions") || out8.includes("yet"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
