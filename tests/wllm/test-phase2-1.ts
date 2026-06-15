#!/usr/bin/env tsx
/**
 * test-wllm-phase2-1.ts — Test TS Compiler structural extraction (Pass 1)
 */
import { extractStructure, extractStructureFromSource, sha256 } from "../../src/wllm/ingest/structural-extractor.js";
import { writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`); }
}

async function section(name: string) {
  console.log(`\n=== ${name} ===`);
}

async function main() {
  const tmpDir = await mkdtemp(join(tmpdir(), "wllm-structural-"));
  try {
    // ====================================================================
    await section("1. SHA256 hash");
    // ====================================================================
    const h1 = sha256("hello");
    const h2 = sha256("hello");
    const h3 = sha256("world");
    test("Same input → same hash", h1 === h2);
    test("Different input → different hash", h1 !== h3);
    test("Hash is 64 hex chars", /^[0-9a-f]{64}$/.test(h1));

    // ====================================================================
    await section("2. Simple TypeScript extraction");
    // ====================================================================
    const simpleSource = `import { foo } from "./foo";
import * as bar from "./bar";

export const VERSION = "1.0.0";

/**
 * Greets a user by name.
 */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export async function fetchData(url: string): Promise<void> {
  // TODO: add error handling
}

function privateHelper(x: number): number {
  return x * 2;
}
`;

    const simple = extractStructureFromSource(simpleSource, "test.ts");
    test("Language detected: typescript", simple.language === "typescript");
    test("Hash computed", simple.hash.length === 64);
    test("Size correct", simple.size === simpleSource.length);

    test("Imports: 2 found", simple.imports.length === 2);
    test("Import 1: from './foo'", simple.imports.some(i => i.module === "./foo"));
    test("Import 2: from './bar'", simple.imports.some(i => i.module === "./bar"));
    test("Import 1 symbols: foo", simple.imports.find(i => i.module === "./foo")?.symbols.includes("foo"));
    test("Import 2 symbols: * as bar", simple.imports.find(i => i.module === "./bar")?.symbols.includes("* as bar"));

    test("Functions: 3 total", simple.functions.length === 3);
    test("Function greet: exported", simple.functions.find(f => f.name === "greet")?.isExported === true);
    test("Function greet: not async", simple.functions.find(f => f.name === "greet")?.isAsync === false);
    test("Function fetchData: async", simple.functions.find(f => f.name === "fetchData")?.isAsync === true);
    test("Function privateHelper: not exported", simple.functions.find(f => f.name === "privateHelper")?.isExported === false);
    test("Function greet: has JSDoc", simple.functions.find(f => f.name === "greet")?.jsDoc !== undefined);

    test("Exports: 3 (VERSION, greet, fetchData)", simple.exports.length === 3);
    test("Export greet is function", simple.exports.find(e => e.symbol === "greet")?.kind === "function");

    // ====================================================================
    await section("3. Class with heritage and decorators");
    // ====================================================================
    const classSource = `
import { BaseService } from "./base";

@injectable()
@controller("/users")
export class UserService extends BaseService implements IUserService {
  private users: User[] = [];
  static COUNT = 0;

  constructor(private logger: Logger) {
    super();
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find(u => u.id === id) ?? null;
  }

  save(user: User): void {
    this.users.push(user);
  }
}
`;

    const cls = extractStructureFromSource(classSource, "user.ts");
    test("Class UserService found", cls.classes.length === 1);
    test("Class: name", cls.classes[0].name === "UserService");
    test("Class: exported", cls.classes[0].isExported === true);
    test("Class: extends BaseService", cls.classes[0].extends === "BaseService");
    test("Class: implements IUserService", cls.classes[0].implements?.includes("IUserService"));
    test("Class: 2 methods (findById, save)", cls.classes[0].methods.length === 2);
    test("Class: methods include findById", cls.classes[0].methods.includes("findById"));
    test("Class: methods include save", cls.classes[0].methods.includes("save"));

    // ====================================================================
    await section("4. Interfaces and types");
    // ====================================================================
    const interfaceSource = `
export interface User {
  id: string;
  name: string;
  email?: string;
}

interface InternalConfig {
  debug: boolean;
}

export type Status = "active" | "inactive" | "pending";

export type ID = string | number;
`;

    const iface = extractStructureFromSource(interfaceSource, "types.ts");
    test("Interfaces: 2", iface.interfaces.length === 2);
    test("Interface User: exported", iface.interfaces.find(i => i.name === "User")?.isExported === true);
    test("Interface InternalConfig: not exported", iface.interfaces.find(i => i.name === "InternalConfig")?.isExported === false);
    test("Types: 2", iface.types.length === 2);
    test("Type Status: exported", iface.types.find(t => t.name === "Status")?.isExported === true);
    test("Type ID: exported", iface.types.find(t => t.name === "ID")?.isExported === true);

    // ====================================================================
    await section("5. Enums");
    // ====================================================================
    const enumSource = `
export enum Color {
  Red = "RED",
  Green = "GREEN",
  Blue = "BLUE",
}

enum Status {
  Active,
  Inactive,
}
`;

    const enm = extractStructureFromSource(enumSource, "enums.ts");
    test("Enums: 2", enm.enums.length === 2);
    test("Enum Color: exported", enm.enums.find(e => e.name === "Color")?.isExported === true);
    test("Enum Color: 3 members", enm.enums.find(e => e.name === "Color")?.members.length === 3);
    test("Enum Status: 2 members", enm.enums.find(e => e.name === "Status")?.members.length === 2);

    // ====================================================================
    await section("6. Comments (TODO/FIXME/HACK/NOTE)");
    // ====================================================================
    const commentSource = `
// TODO: implement retry logic
// FIXME: this is broken when X is null
// HACK: temporary workaround for Y
// NOTE: this is a note about Z
// XXX: needs refactoring
// This is just a regular comment
function foo() {}
`;

    const cmt = extractStructureFromSource(commentSource, "comments.ts");
    test("Comments: 5 special (TODO/FIXME/HACK/NOTE/XXX)", cmt.comments.length === 5);
    test("TODO found", cmt.comments.some(c => c.type === "TODO"));
    test("FIXME found", cmt.comments.some(c => c.type === "FIXME"));
    test("HACK found", cmt.comments.some(c => c.type === "HACK"));
    test("NOTE found", cmt.comments.some(c => c.type === "NOTE"));
    test("XXX found", cmt.comments.some(c => c.type === "XXX"));
    test("TODO has text", cmt.comments.find(c => c.type === "TODO")?.text.includes("retry"));

    // ====================================================================
    await section("7. Real file extraction (huagent source)");
    // ====================================================================
    const realFile = join(tmpDir, "real.ts");
    await writeFile(realFile, simpleSource);
    const real = extractStructure(realFile);
    test("Real file: language", real.language === "typescript");
    test("Real file: size", real.size === simpleSource.length);
    test("Real file: hash", real.hash === sha256(simpleSource));
    test("Real file: imports", real.imports.length === 2);
    test("Real file: functions", real.functions.length === 3);

    // ====================================================================
    await section("8. Edge cases");
    // ====================================================================
    // Empty file
    const empty = extractStructureFromSource("", "empty.ts");
    test("Empty file: no imports", empty.imports.length === 0);
    test("Empty file: no functions", empty.functions.length === 0);
    test("Empty file: hash exists", empty.hash.length === 64);

    // File with only comments
    const onlyComments = extractStructureFromSource("// just a comment\n/* multi */", "comments-only.ts");
    test("Comments-only: no functions", onlyComments.functions.length === 0);

    // File with generic types
    const genericSource = `
export function identity<T>(value: T): T {
  return value;
}

export class Container<T> {
  private items: T[] = [];
}
`;
    const generic = extractStructureFromSource(genericSource, "generic.ts");
    test("Generic function extracted", generic.functions.some(f => f.name === "identity"));
    test("Generic class extracted", generic.classes.some(c => c.name === "Container"));

    // Async function
    const asyncSource = `export const fetchData = async (url: string) => { return null; };`;
    const asyncExtract = extractStructureFromSource(asyncSource, "async.ts");
    test("Async arrow function as variable", asyncExtract.exports.some(e => e.symbol === "fetchData"));

    // ====================================================================
    await section("9. JSX/TSX detection");
    // ====================================================================
    const tsxSource = `
import React from "react";

export function Greeting({ name }: { name: string }) {
  return <div className="greeting">Hello, {name}!</div>;
}
`;
    const tsxExtract = extractStructureFromSource(tsxSource, "component.tsx");
    test("TSX language detected", tsxExtract.language === "tsx");
    test("TSX function extracted", tsxExtract.functions.some(f => f.name === "Greeting"));
    test("TSX import React", tsxExtract.imports.some(i => i.module === "react"));

    const jsxSource = `
function App() {
  return <div>App</div>;
}
`;
    const jsxExtract = extractStructureFromSource(jsxSource, "app.jsx");
    test("JSX language detected", jsxExtract.language === "jsx");

    // ====================================================================
    await section("10. Complex real-world file");
    // ====================================================================
    const complexSource = `
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

/**
 * Manages user authentication and session lifecycle.
 * @see https://example.com/auth
 */
export class AuthService extends EventEmitter {
  private static instance: AuthService;
  private readonly sessionTimeout = 3600000; // 1 hour

  private constructor(
    private readonly logger: Logger,
    private readonly config: AuthConfig,
  ) {
    super();
  }

  static getInstance(logger: Logger, config: AuthConfig): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService(logger, config);
    }
    return AuthService.instance;
  }

  async login(req: Request, res: Response): Promise<User> {
    // TODO: add rate limiting
    const { email, password } = req.body;
    // FIXME: validate email format
    const user = await this.findUser(email);
    return user;
  }

  logout(token: string): void {
    // HACK: token validation skipped for demo
    this.emit("logout", token);
  }

  private async findUser(email: string): Promise<User> {
    return { id: "1", email, name: "Test" };
  }
}

export interface AuthConfig {
  secret: string;
  expiresIn: number;
}

export type AuthToken = string;

export enum AuthError {
  InvalidCredentials = "INVALID_CREDENTIALS",
  TokenExpired = "TOKEN_EXPIRED",
}
`;
    const complex = extractStructureFromSource(complexSource, "auth-service.ts");

    test("Complex: 1 import", complex.imports.length === 2);
    test("Complex: 1 class", complex.classes.length === 1);
    test("Complex: class extends EventEmitter", complex.classes[0].extends === "EventEmitter");
    test("Complex: class has 4 methods (getInstance, login, logout, findUser)", complex.classes[0].methods.length === 4);
    test("Complex: 1 interface (AuthConfig)", complex.interfaces.length === 1);
    test("Complex: 1 type alias (AuthToken)", complex.types.length === 1);
    test("Complex: 1 enum (AuthError)", complex.enums.length === 1);
    test("Complex: 4 comments (TODO, FIXME, HACK)", complex.comments.length >= 3);
    test("Complex: TODO comment found", complex.comments.some(c => c.type === "TODO" && c.text.includes("rate limiting")));
    test("Complex: FIXME comment found", complex.comments.some(c => c.type === "FIXME" && c.text.includes("email format")));
    test("Complex: HACK comment found", complex.comments.some(c => c.type === "HACK" && c.text.includes("token validation")));
    test("Complex: JSDoc on class", complex.classes[0].jsDoc !== undefined);

    // ====================================================================
    await section("11. Performance (fast enough for ingest)");
    // ====================================================================
    const perfSource = Array(100).fill(0).map((_, i) => `export function fn${i}(x: number): number { return x + ${i}; }`).join("\n");
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      extractStructureFromSource(perfSource, "perf.ts");
    }
    const elapsed = Date.now() - t0;
    test(`10 extractions of 100-function file in ${elapsed}ms (< 1000ms)`, elapsed < 1000);

    // ====================================================================
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Phase 2.1 Test Results: ${pass} passed, ${fail} failed`);
    console.log("=".repeat(60));

    if (fail > 0) {
      console.log("\n❌ Failed tests:");
      failures.forEach(f => console.log(`  - ${f}`));
      process.exit(1);
    } else {
      console.log("\n🎉 ALL Phase 2.1 tests PASSED");
    }
  } finally {
    await rm(tmpDir, { recursive: true });
  }
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
