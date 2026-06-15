---
name: security-scan
description: Quick security audit for common vulnerabilities
origin: huanime
triggers: [security, audit, vulnerability, owasp]
---

# Security Scan

Quick checklist for security issues. Use when reviewing code or before deploying.

## Top Checks

### 1. Secrets in code
- Look for hardcoded API keys, passwords, tokens
- Check `.env` is in `.gitignore`
- Verify secrets are loaded from environment or vault

### 2. Input validation
- All user input is validated
- SQL queries use parameterized statements
- File paths are normalized and sandboxed
- URLs are validated before fetching

### 3. Authentication & Authorization
- Auth checks on every protected endpoint
- Session tokens are rotated
- Role-based access control is enforced

### 4. Cryptography
- bcrypt/argon2 for passwords (not MD5/SHA1)
- HTTPS everywhere
- TLS verification enabled
- Secure random for tokens (not Math.random)

### 5. Rate limiting
- Login attempts are throttled
- API calls have rate limits
- Resource-intensive operations are queued

### 6. Dependencies
- No known vulnerabilities (`npm audit`)
- Dependencies are pinned to specific versions
- Lockfile is committed

### 7. Logging
- No sensitive data in logs
- Audit trail for security events
- Log injection is prevented (structured logging)

## If you find an issue

1. Categorize: CRITICAL, HIGH, MEDIUM, LOW
2. Provide specific file:line reference
3. Suggest a fix
4. For CRITICAL: stop work, fix immediately
