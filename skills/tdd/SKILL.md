---
name: tdd
description: Test-driven development workflow for any feature
origin: huanime
triggers: [test, tdd, test-driven, red-green-refactor]
---

# TDD Workflow

When implementing a new feature, follow the red-green-refactor cycle:

1. **RED** — Write a failing test first
2. **GREEN** — Write the minimum code to make it pass
3. **REFACTOR** — Improve the code while keeping tests green

## Steps

1. Identify the smallest testable behavior
2. Write the test (it should FAIL)
3. Run the test, confirm it fails for the right reason
4. Write the minimum implementation
5. Run the test, confirm it passes
6. Refactor for clarity, performance, or DRY
7. Repeat

## Anti-patterns to avoid

- Don't write code first, then test
- Don't skip the failing-test step
- Don't write tests for trivial code (e.g., getters)
- Don't refactor and add features simultaneously
