# scripts/

This folder contains developer scripts that aren't part of the runtime:

| File | Purpose |
|------|---------|
| `snapshot.mjs` | Render Ink components to a string for visual regression testing. Run with `npm run snapshot:tui`. |
| `benchmark-live.ts` | Live LLM benchmark — measures tokens/sec, cost, latency. Run with `npx tsx scripts/benchmark-live.ts`. |
| `v4-exploration/` | Historical exploratory scripts from the v4 engine development. Kept for reference, not part of the test suite. |

End users don't need any of this. These are for contributors and CI tooling.
