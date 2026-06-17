# Contributing to Huagent

**Pertama-tama, terima kasih udah mau contribute!** 🎉

Huagent adalah project open-source, dan kita sangat menghargai setiap kontribusi, sekecil apapun itu.

---

## 📋 Daftar Isi

1. [Code of Conduct](#code-of-conduct)
2. [Cara Contribute](#cara-contribute)
3. [Setup Development Environment](#setup-development-environment)
4. [Development Workflow](#development-workflow)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Submitting Changes](#submitting-changes)
8. [Reporting Bugs](#reporting-bugs)
9. [Suggesting Features](#suggesting-features)
10. [Style Guide](#style-guide)

---

## Code of Conduct

Project ini menggunakan [Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). Dengan berpartisipasi, kamu diharapkan mematuhi code of conduct ini.

**TL;DR:** Be respectful, be kind, be constructive.

---

## Cara Contribute

Ada banyak cara untuk contribute ke Huagent:

### 🐛 Report Bugs
- Temukan bug? [Buka issue](https://github.com/huanime/huagent/issues/new?template=bug_report.md)
- Jelaskan bug dengan jelas: apa yang terjadi, apa yang seharusnya terjadi, cara reproduce

### 💡 Suggest Features
- Punya ide fitur baru? [Buka feature request](https://github.com/huanime/huagent/issues/new?template=feature_request.md)
- Jelaskan kenapa fitur ini berguna dan bagaimana cara kerjanya

### 📖 Improve Documentation
- Dokumentasi kurang jelas? Ada typo? [Edit langsung di GitHub](https://github.com/huanime/huagent/edit/main/docs/USER_GUIDE.md)
- Atau [buka issue](https://github.com/huanime/huagent/issues/new) untuk suggest improvement

### 🔧 Submit Code
- Fix bug atau implement fitur? [Submit pull request](#submitting-changes)
- Pastikan code kamu mengikuti [coding standards](#coding-standards)

### 🧪 Write Tests
- Test coverage masih rendah? [Bantu tulis tests](#testing)
- Unit tests, integration tests, semua helpful!

### 🌍 Translate
- Huagent belum support bahasa kamu? [Bantu translate](#translate)
- User guide, architecture docs, semua bisa ditranslate

---

## Setup Development Environment

### Requirements

- **Node.js** 18+ (recommended: 20 LTS)
- **npm** 8+ (comes with Node.js)
- **Git** (for version control)
- **TypeScript** 5+ (comes with npm install)

### Step 1: Fork & Clone

```bash
# Fork repo di GitHub (klik tombol Fork)

# Clone fork kamu
git clone https://github.com/YOUR_USERNAME/huagent.git
cd huagent

# Add upstream remote
git remote add upstream https://github.com/huanime/huagent.git
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Build

```bash
npm run build
```

### Step 4: Test

```bash
# Run all tests
npm test

# Run specific test file
npx vitest tests/engine/core.test.ts

# Run tests in watch mode
npm run test:watch
```

### Step 5: Run Huagent

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
node dist/cli.js

# Test one-shot mode
node dist/cli.js "say hello"
```

### Step 6: Setup API Key

```bash
# Set environment variable
export ANTHROPIC_API_KEY=sk-ant-...

# Or use .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

---

## Development Workflow

### 1. Create a Branch

```bash
# Sync dengan upstream
git fetch upstream
git checkout main
git merge upstream/main

# Create feature branch
git checkout -b feature/your-feature-name

# Or for bug fix
git checkout -b fix/your-bug-fix
```

**Branch Naming Convention:**
- `feature/xxx` - New feature
- `fix/xxx` - Bug fix
- `docs/xxx` - Documentation update
- `test/xxx` - Test improvement
- `refactor/xxx` - Code refactoring

### 2. Make Changes

```bash
# Edit files...
# Test your changes...
# Repeat until satisfied
```

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run linter
npm run lint

# Build project
npm run build

# Test manually
node dist/cli.js "test your feature"
```

### 4. Commit Changes

```bash
# Add changes
git add .

# Commit with clear message
git commit -m "feat: add new feature X"

# Or for bug fix
git commit -m "fix: resolve issue with Y"
```

**Commit Message Convention:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `test:` - Tests
- `refactor:` - Refactoring
- `chore:` - Maintenance

**Examples:**
```bash
git commit -m "feat: add syntax highlighting to TUI"
git commit -m "fix: resolve memory leak in engine"
git commit -m "docs: update USER_GUIDE.md with new commands"
git commit -m "test: add unit tests for planner"
git commit -m "refactor: simplify error handling in client.ts"
```

### 5. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 6. Open Pull Request

1. Go to your fork on GitHub
2. Click "Compare & pull request"
3. Fill in the PR template
4. Submit!

---

## Coding Standards

### TypeScript

Huagent menggunakan **TypeScript** dengan strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Code Style

**Use Prettier** untuk formatting:

```bash
# Format all files
npm run format

# Format specific file
npx prettier --write src/engine/core.ts
```

**Prettier Config:**
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

### Naming Conventions

**Files:**
- `kebab-case.ts` - Most files
- `PascalCase.tsx` - React components
- `UPPER_CASE.ts` - Constants only

**Variables/Functions:**
```typescript
// camelCase for variables and functions
const userName = 'Alice';
function calculateTotal() { }

// PascalCase for classes and types
class UserManager { }
interface UserData { }

// UPPER_CASE for constants
const MAX_RETRIES = 3;
const API_BASE_URL = 'https://api.example.com';
```

**React Components:**
```typescript
// PascalCase for component names
export const ModernApp: React.FC = () => { };

// camelCase for props
interface AppProps {
  userName: string;
  onButtonClick: () => void;
}
```

### Code Organization

**File Structure:**
```typescript
// 1. Imports (sorted: react, external, internal, types)
import React, { useState } from 'react';
import chalk from 'chalk';
import { Engine } from './engine/core.ts';
import type { Config } from './types/index.ts';

// 2. Constants
const MAX_RETRIES = 3;

// 3. Types/Interfaces
interface UserData {
  name: string;
  age: number;
}

// 4. Helper functions
function formatName(name: string): string {
  return name.trim();
}

// 5. Main export
export class UserManager {
  // ...
}
```

### Comments

**Use JSDoc** untuk public APIs:

```typescript
/**
 * Calculate the total cost based on token usage.
 * 
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param pricing - Pricing configuration
 * @returns Total cost in USD
 * 
 * @example
 * const cost = calculateCost(1000, 500, { input: 0.01, output: 0.03 });
 * // Returns: 0.025
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: { input: number; output: number }
): number {
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1000;
}
```

**Use inline comments** untuk complex logic:

```typescript
// Use exponential decay for memory scoring
// Half-life: 24 hours (memories lose 50% relevance per day)
const score = importance * 0.6 + recency * 0.4;
```

### Error Handling

**Always handle errors:**

```typescript
// ❌ Bad
const data = JSON.parse(text);

// ✅ Good
try {
  const data = JSON.parse(text);
} catch (error) {
  console.error('Failed to parse JSON:', error);
  throw new Error('Invalid JSON format');
}
```

**Use custom error types:**

```typescript
export class HuagentError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'HuagentError';
  }
}

throw new HuagentError('API key not found', 'MISSING_API_KEY');
```

---

## Testing

### Test Structure

```
tests/
├── engine/
│   ├── core.test.ts       # Engine tests
│   ├── planner.test.ts    # Planner tests
│   └── critic.test.ts     # Critic tests
├── providers/
│   ├── client.test.ts     # Client tests
│   └── registry.test.ts   # Registry tests
├── memory/
│   ├── manager.test.ts    # Memory manager tests
│   └── store.test.ts      # Memory store tests
├── tools/
│   ├── read.test.ts       # Read tool tests
│   ├── write.test.ts      # Write tool tests
│   └── edit.test.ts       # Edit tool tests
└── integration/
    └── e2e.test.ts        # End-to-end tests
```

### Writing Tests

**Use Vitest** (similar to Jest):

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Engine } from '../../src/engine/core.ts';

describe('Engine', () => {
  let engine: Engine;

  beforeEach(() => {
    engine = new Engine(/* mock dependencies */);
  });

  describe('task classification', () => {
    it('should classify "fix bug" as code_fix', () => {
      const result = engine.detectTaskType('fix the login bug');
      expect(result).toBe('code_fix');
    });

    it('should classify "read file" as code_read', () => {
      const result = engine.detectTaskType('read the auth file');
      expect(result).toBe('code_read');
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx vitest tests/engine/core.test.ts

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run tests matching pattern
npx vitest -t "task classification"
```

### Test Coverage

Target: **70% coverage**

```bash
# Check coverage
npm run test:coverage

# View coverage report
open coverage/index.html
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('CLI Integration', () => {
  it('should respond to one-shot mode', () => {
    const output = execSync('node dist/cli.js "say hello"', {
      encoding: 'utf-8',
    });
    expect(output).toContain('Hello');
  });
});
```

---

## Submitting Changes

### Pull Request Template

When you open a PR, use this template:

```markdown
## Description
Brief description of what this PR does.

## Changes
- Change 1
- Change 2
- Change 3

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing done

## Screenshots (if applicable)
[Screenshot here]

## Related Issues
Closes #123
```

### PR Review Process

1. **Automated Checks**
   - CI runs tests
   - Linter checks code
   - Coverage report generated

2. **Code Review**
   - Maintainer reviews code
   - Feedback provided
   - Changes requested (if needed)

3. **Approval**
   - PR approved by maintainer
   - Merged to main branch

### PR Checklist

Before submitting, ensure:

- [ ] Code follows [coding standards](#coding-standards)
- [ ] Tests added/updated
- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if needed)
- [ ] PR description is clear
- [ ] Related issue linked (if applicable)

---

## Reporting Bugs

### Bug Report Template

Use this template when reporting bugs:

```markdown
## Bug Description
Clear description of the bug.

## Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What should happen.

## Actual Behavior
What actually happens.

## Environment
- OS: [e.g., macOS 14.0]
- Node.js: [e.g., 20.10.0]
- Huagent: [e.g., 4.3.1]

## Additional Context
[Any additional information]
```

### Bug Triage

Bugs are triaged by severity:

- **Critical** - App crashes, data loss
- **High** - Major feature broken
- **Medium** - Minor feature broken
- **Low** - Cosmetic issue

---

## Suggesting Features

### Feature Request Template

Use this template for feature requests:

```markdown
## Feature Description
Clear description of the feature.

## Problem Statement
What problem does this solve?

## Proposed Solution
How should it work?

## Alternatives Considered
What other solutions did you consider?

## Additional Context
[Any additional information]
```

---

## Style Guide

### Documentation Style

**Use clear, simple language:**

```markdown
# ❌ Bad
The utilization of the aforementioned methodology facilitates the optimization of the system.

# ✅ Good
This method helps optimize the system.
```

**Use examples:**

```markdown
# ❌ Bad
Use the /model command to switch models.

# ✅ Good
Use the /model command to switch models:

```bash
/model gpt-5
```
```

**Use code blocks:**

````markdown
```typescript
const engine = new Engine(client, memory, tools, sessions);
```
````

### Commit Message Style

**Use imperative mood:**

```bash
# ❌ Bad
git commit -m "Added new feature"
git commit -m "Fixes bug"

# ✅ Good
git commit -m "Add new feature"
git commit -m "Fix bug"
```

**Be specific:**

```bash
# ❌ Bad
git commit -m "Update code"

# ✅ Good
git commit -m "Add syntax highlighting to TUI"
```

---

## Getting Help

### Questions?

- **GitHub Discussions:** https://github.com/huanime/huagent/discussions
- **Discord:** https://discord.gg/huagent
- **Email:** support@huanime.dev

### Issues?

- **Bug Reports:** https://github.com/huanime/huagent/issues/new?template=bug_report.md
- **Feature Requests:** https://github.com/huanime/huagent/issues/new?template=feature_request.md

---

## Recognition

Contributors are recognized in:

- **README.md** - Contributors section
- **CHANGELOG.md** - Changes credited
- **GitHub** - Contributors page

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).

---

## Thank You! 🎉

Thank you for contributing to Huagent! Every contribution, no matter how small, is appreciated and valued.

**Happy coding! ✦**
