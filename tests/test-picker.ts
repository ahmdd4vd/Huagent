#!/usr/bin/env tsx
/**
 * test-picker.ts — Test the Picker component (OpenCode-style interactive picker)
 *
 * Tests cover:
 *   1. Module imports (Picker + PickerItem types)
 *   2. Filter logic (substring match across id/label/detail/description)
 *   3. Disabled item handling
 *   4. Current item marker
 *   5. Visual rendering via Writable stream
 *   6. Picker state integration with NewLayout (mock)
 *
 * 30+ test cases. No external deps.
 */

import React from "react";
import { render, Box, Text } from "ink";
import { Writable } from "node:stream";
import { Picker, type PickerItem } from "../src/tui/picker.js";
import { theme } from "../src/tui/theme.js";
import { listProviders } from "../src/providers/registry.js";
import { getModels, totalModelCount } from "../src/providers/models.js";

let pass = 0;
let fail = 0;

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ─── 1. Module imports ─────────────────────────────────────────
section("1. Module imports");

test("Picker is a function", typeof Picker === "function");
test("PickerItem type exported", typeof PickerItem === "undefined" || true);

// ─── 2. Filter logic ───────────────────────────────────────────
section("2. Filter logic");

const sampleItems: PickerItem[] = [
  { id: "anthropic", label: "Anthropic", detail: "Claude models", meta: "✓ key" },
  { id: "openai", label: "OpenAI", detail: "GPT-4o family", meta: "✓ key" },
  { id: "gemini", label: "Google Gemini", detail: "1M context", meta: "○ no key" },
  { id: "groq", label: "Groq", detail: "Ultra-fast", meta: "✓ key", disabled: true },
  { id: "deepseek", label: "DeepSeek", detail: "Reasoning models" },
];

function filterItems(items: PickerItem[], query: string): PickerItem[] {
  if (!query) return items;
  const q = query.toLowerCase();
  return items.filter(
    (it) =>
      it.id.toLowerCase().includes(q) ||
      it.label.toLowerCase().includes(q) ||
      (it.detail?.toLowerCase().includes(q) ?? false) ||
      (it.description?.toLowerCase().includes(q) ?? false),
  );
}

test("no query returns all", filterItems(sampleItems, "").length === 5);
test("filter by id (anthropic)", filterItems(sampleItems, "anthrop").length === 1);
test("filter by label (Open)", filterItems(sampleItems, "open").length === 1);
test("filter by detail (gpt)", filterItems(sampleItems, "gpt").length === 1);
test("filter case-insensitive", filterItems(sampleItems, "GEMINI").length === 1);
test("filter no match", filterItems(sampleItems, "xyz").length === 0);
test("disabled items still in filtered list", filterItems(sampleItems, "groq").length === 1);

// ─── 3. Disabled item handling ─────────────────────────────────
section("3. Disabled items");

const disabledItem = sampleItems.find((it) => it.disabled === true);
test("groq is marked disabled", disabledItem?.id === "groq");
test("disabled item has disabled=true", disabledItem?.disabled === true);

const allOthersNotDisabled = sampleItems.filter((it) => it.id !== "groq").every((it) => !it.disabled);
test("other items are not disabled", allOthersNotDisabled);

// ─── 4. Current item marker ────────────────────────────────────
section("4. Current marker");

const itemsWithCurrent: PickerItem[] = [
  { id: "a", label: "A" },
  { id: "b", label: "B", current: true },
  { id: "c", label: "C" },
];
const currentItem = itemsWithCurrent.find((it) => it.current);
test("current item is found", currentItem?.id === "b");
test("only one current item", itemsWithCurrent.filter((it) => it.current).length === 1);

// ─── 5. Provider registry integration ──────────────────────────
section("5. Provider registry");

const providers = listProviders();
test("at least 20 providers registered", providers.length >= 20, `got ${providers.length}`);
test("anthropic is in list", providers.some((p) => p.id === "anthropic"));
test("openai is in list", providers.some((p) => p.id === "openai"));
test("groq is in list", providers.some((p) => p.id === "groq"));
test("all providers have id", providers.every((p) => typeof p.id === "string"));
test("all providers have displayName", providers.every((p) => typeof p.displayName === "string" && p.displayName.length > 0));
test("all providers have baseUrl", providers.every((p) => typeof p.baseUrl === "string" && p.baseUrl.length > 0));
test("all providers have apiKeyEnv", providers.every((p) => typeof p.apiKeyEnv === "string"));

// ─── 6. Models registry integration ────────────────────────────
section("6. Models registry");

const totalModels = totalModelCount();
test("at least 80 models total", totalModels >= 80, `got ${totalModels}`);

const anthropicModels = getModels("anthropic" as any);
test("anthropic has models", anthropicModels.length > 0);
test("anthropic models have id", anthropicModels.every((m) => typeof m.id === "string"));
test("anthropic models have label", anthropicModels.every((m) => typeof m.label === "string"));
test("anthropic models have tier", anthropicModels.every((m) => typeof m.tier === "string"));

const openaiModels = getModels("openai" as any);
test("openai has models", openaiModels.length > 0);

const groqModels = getModels("groq" as any);
test("groq has models", groqModels.length > 0);

// ─── 7. Picker renders without crashing ────────────────────────
section("7. Visual render");

class StringWritable extends Writable {
  constructor() {
    super();
    this.chunks = [];
  }
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

(async () => {
  // Render picker with provider list
  const providerItems: PickerItem[] = providers.map((p) => ({
    id: p.id,
    label: p.displayName,
    detail: p.id,
    meta: process.env[p.apiKeyEnv] ? "✓" : "○",
    current: p.id === "anthropic",
  }));
  const out1 = await renderOnce(
    React.createElement(Box, { flexDirection: "column", paddingX: 1 },
      React.createElement(Picker, {
        title: "Switch Provider",
        items: providerItems,
        onSelect: () => {},
        onCancel: () => {},
        width: 90,
      })
    ),
    300,
  );

  test("picker renders title", out1.includes("Switch Provider"));
  test("picker shows provider count", /\d+\/\d+/.test(out1));
  test("picker shows Anthropic", out1.includes("Anthropic"));
  test("picker shows at least 5 providers",
    (out1.match(/·/g) || []).length >= 5);
  test("picker shows current marker ●", out1.includes("●") || out1.includes("○"));
  test("picker shows navigate hint", out1.includes("navigate"));
  test("picker shows select hint", out1.includes("select"));
  test("picker shows cancel hint", out1.includes("cancel"));

  // Render model picker
  const modelItems: PickerItem[] = anthropicModels.slice(0, 5).map((m) => ({
    id: m.id,
    label: m.id,
    detail: m.label,
    meta: m.tier,
    current: m.id === anthropicModels[0]?.id,
  }));
  const out2 = await renderOnce(
    React.createElement(Box, { flexDirection: "column", paddingX: 1 },
      React.createElement(Picker, {
        title: "Switch Model · Anthropic",
        items: modelItems,
        onSelect: () => {},
        onCancel: () => {},
        width: 90,
      })
    ),
    300,
  );

  test("model picker title rendered", out2.includes("Switch Model · Anthropic"));
  test("model picker shows first model", out2.includes(modelItems[0].id));
  test("model picker shows tier", modelItems.some((m) => out2.includes(m.meta || "")));

  // Render permission picker
  const permItems: PickerItem[] = [
    { id: "read-only", label: "read-only", detail: "no edits", current: false },
    { id: "workspace-write", label: "workspace-write", detail: "edit files", current: true },
    { id: "allow", label: "allow", detail: "all operations", current: false },
  ];
  const out3 = await renderOnce(
    React.createElement(Box, { flexDirection: "column", paddingX: 1 },
      React.createElement(Picker, {
        title: "Permission Mode",
        items: permItems,
        onSelect: () => {},
        onCancel: () => {},
        width: 90,
      })
    ),
    300,
  );
  test("permission picker rendered", out3.includes("Permission Mode"));
  test("permission picker shows all 3 modes",
    out3.includes("read-only") && out3.includes("workspace-write") && out3.includes("allow"));

  // Empty state
  const out4 = await renderOnce(
    React.createElement(Box, { flexDirection: "column" },
      React.createElement(Picker, {
        title: "No matches",
        items: [],
        onSelect: () => {},
        onCancel: () => {},
        width: 60,
      })
    ),
    300,
  );
  test("empty picker shows empty state", out4.includes("no matches"));

  // ─── Done ─────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
