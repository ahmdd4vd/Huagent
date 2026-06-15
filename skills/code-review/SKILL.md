---
name: code-review
description: Senior-level code review checklist
origin: huanime
triggers: [review, code-review, pr-review]
---

# Code Review

When reviewing code, work through these categories in order:

## CRITICAL (must fix before merge)

- **Security**: hardcoded secrets, SQL injection, XSS, SSRF, RCE
- **Correctness**: logic errors, off-by-one, null/undefined mishandling
- **Data loss**: missing transactions, destructive operations without backup

## HIGH (should fix)

- **Error handling**: uncaught exceptions, swallowed errors
- **Type safety**: missing type annotations, unsafe casts
- **Resource leaks**: unclosed files, connections, timers
- **Concurrency**: race conditions, deadlocks, missing locks

## MEDIUM (consider fixing)

- **Performance**: O(n²) when O(n) is possible
- **Readability**: unclear names, complex expressions
- **DRY**: duplicated logic
- **Test coverage**: missing edge cases

## LOW (nice to have)

- **Style**: formatting, naming consistency
- **Documentation**: missing comments on non-obvious code
- **Organization**: file structure

## Filter

Only report issues you're **>80% confident** are real problems.
Skip stylistic preferences unless they violate project conventions.
Consolidate similar issues ("5 functions missing error handling").
