## Summary

<!-- What problem does this solve, and why is this the smallest appropriate change? -->

## Boundary

- [ ] Presentation/documentation only
- [ ] F1 deterministic engine
- [ ] Daily-universe or evidence pipeline
- [ ] Build/CI/deployment tooling

## Invariants

- [ ] Deterministic replay and versioned serialization are preserved or explicitly migrated.
- [ ] Simulated and real evidence remain unambiguously labeled.
- [ ] Scientific language stays within `docs/CLAIMS.md`.
- [ ] No credential, personal data, local path, generated deployment state, or private artifact is included.
- [ ] Player-facing text is Spanish; public engineering material is English.

## Verification

<!-- List exact commands and results. Add real screenshots for visual changes. -->

```text
npm run lint
npm run test -- --run
npm run build
npm run verify:public-repo
npm run scan:secrets
```

## Deployment impact

<!-- State "None" unless an explicitly authorized infrastructure/deployment action is required. CI must not deploy. -->
