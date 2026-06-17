/**
 * test-effort-detector.ts — Unit tests for effort detection
 *
 * Pure function: detectEffort(text: string) → EffortTier
 * Used by onboarding wizard + /effort command + auto-detect header chip.
 *
 * Run: npx tsx tests/test-effort-detector.ts
 */
import { detectEffort, listTiers, type EffortTier } from '../src/onboarding/effort-detector.js';

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Tier ordering ────────────────────────────────────────────
console.log('\n[Effort Tier ordering]');
{
  const tiers = listTiers();
  assertEq(tiers.length, 6, '6 tiers defined');
  assertEq(tiers[0], 'low', 'first tier is low');
  assertEq(tiers[tiers.length - 1], 'ultramax', 'last tier is ultramax');
}

// ─── Trivial questions → low ──────────────────────────────────
console.log('\n[Trivial questions → low]');
{
  assertEq(detectEffort('what is XSS?'), 'low', 'short question is low');
  assertEq(detectEffort('explain this'), 'low', '"explain this" is low');
  assertEq(detectEffort('hi'), 'low', 'greeting is low');
  assertEq(detectEffort('fix typo'), 'low', '"fix typo" is low');
  assertEq(detectEffort('rename variable'), 'low', 'simple rename is low');
}

// ─── Short tasks → medium ─────────────────────────────────────
console.log('\n[Short tasks → medium]');
{
  assertEq(
    detectEffort('add a button to the page that submits the form'),
    'medium',
    'short feature request is medium',
  );
  assertEq(
    detectEffort('write a function that returns the sum of two numbers'),
    'medium',
    'simple function request is medium',
  );
}

// ─── Multi-step → high ────────────────────────────────────────
console.log('\n[Multi-step → high]');
{
  assertEq(
    detectEffort('split this 200 line module into separate files for the api the database layer and the auth helpers'),
    'high',
    'multi-file split is high',
  );
  assertEq(
    detectEffort(
      'add user authentication with email password, oauth with google and github, ' +
        'password reset flow, email verification, and remember me tokens',
    ),
    'high',
    'auth with multiple features is high',
  );
}

// ─── Big projects → xhigh ─────────────────────────────────────
console.log('\n[Big projects → xhigh]');
{
  assertEq(
    detectEffort('design and implement a distributed consensus algorithm for a multi-region deployment with leader election log replication and partition tolerance'),
    'xhigh',
    'distributed system is xhigh',
  );
}

// ─── Massive migrations → max ─────────────────────────────────
console.log('\n[Massive migrations → max]');
{
  assertEq(
    detectEffort(
      'migrate the entire codebase from python 2 to python 3 including fixing all print statements, ' +
        'updating all libraries, replacing urllib2 with urllib3, fixing all unicode handling, ' +
        'updating the test suite, fixing the build pipeline, updating the deployment scripts, ' +
        'migrating the database access layer, and ensuring backwards compatibility with the legacy data format',
    ),
    'max',
    'large migration is max',
  );
}

// ─── Ultra-massive → ultramax ─────────────────────────────────
console.log('\n[Ultra-massive → ultramax]');
{
  assertEq(
    detectEffort(
      'build a complete enterprise SaaS platform with multi-tenant architecture, role-based access control, ' +
        'audit logging, billing and subscription management, real-time collaboration features, ' +
        'document management with version control, search across documents, integration with external APIs, ' +
        'a workflow engine, customizable dashboards, real-time analytics, reporting, ' +
        'mobile APIs, webhooks, event streaming, distributed message queue, ' +
        'horizontally scalable microservices, kubernetes deployment, monitoring and observability, ' +
        'CI/CD pipeline integration, automated testing at unit integration and e2e levels, ' +
        'security scanning, dependency management, performance testing, load testing, ' +
        'disaster recovery, backup and restore, compliance with SOC2 HIPAA GDPR, ' +
        'a beautiful modern UI with responsive design, accessibility WCAG 2.1 AA, internationalization, ' +
        'documentation portal, API reference, developer SDKs for python node ruby java go, ' +
        'and a vibrant community of developers building integrations and plugins on top of it',
    ),
    'ultramax',
    'enterprise platform is ultramax',
  );
}

// ─── Empty / default → medium ─────────────────────────────────
console.log('\n[Defaults]');
{
  assertEq(detectEffort(''), 'medium', 'empty input defaults to medium');
  assertEq(detectEffort('   '), 'medium', 'whitespace defaults to medium');
}

// ─── Booster words escalate ───────────────────────────────────
console.log('\n[Booster words escalate]');
{
  // No booster keywords present
  const plain =
    'Update the entire authentication module to use a new token format, modify all the middleware, ' +
    'change the database schema, write migration scripts, update the documentation, ' +
    'and ensure backwards compatibility with existing sessions for at least 6 months';
  assertEq(detectEffort(plain), 'high', 'long task without boosters is high');

  // Add "build" + "design" boosters — escalates one tier to xhigh
  const boosted =
    'Build and design a new authentication module to use a token format, modify all the middleware, ' +
    'change the database schema, write migration scripts, update the documentation, ' +
    'and ensure backwards compatibility with existing sessions for at least 6 months';
  assertEq(detectEffort(boosted), 'xhigh', 'booster words escalate');
}

// ─── Summary ──────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
if (failed > 0) {
  console.log('✗ FAIL');
  process.exit(1);
} else {
  console.log('✓ PASS');
}
