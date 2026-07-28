# Production Readiness

**Existing live application:** <https://production.d333fud52cy2ho.amplifyapp.com>

**Hosting model:** static Vite SPA on a manually managed AWS Amplify `production` branch. The application has no runtime backend, database, authentication service, IBM credential, or AWS credential.

## Release posture

| Area | Status | Evidence |
| --- | --- | --- |
| Deterministic engine | Ready | Unit, property, serialization, replay, and integration suites |
| Five-universe campaign | Ready offline | Five verified artifacts, unique commitments, campaign bundle/index, #001 byte pin |
| Real evidence | Ready | Five direct SamplerV2 executions; direct #001 EstimatorV2/CHSH; raw/derived manifests and hashes |
| Scientific claims | Bounded | [CLAIMS.md](CLAIMS.md) and [QUANTUM_PROVENANCE.md](QUANTUM_PROVENANCE.md) |
| Responsive player UI | Ready | Selector/progression, five themes, desktop/mobile layouts, keyboard, focus, reduced motion |
| Static build | Release-gated | TypeScript and Vite production build |
| Amplify package | Release-gated | Reproducible ZIP rules, package tests, clean-commit deployment guard |
| Existing live hosting | Deployment target | HTTPS, SPA routes, metadata, assets, headers, caching, budgets, smoke checks |
| Five-universe deployment | Operator-only | Existing-app deployment followed by read-only route/product verification |
| Public repository | Gated | Public-repository verifier, secret scan, fresh-history mirror, GitHub CI |

## One-command offline release gate

After installing locked JavaScript and Python dependencies, run from the repository root:

```bash
npm run release:finalize-offline
```

This repeatable command:

1. strictly verifies all preserved campaign evidence and rewrites the canonical campaign index;
2. strictly finalizes and verifies all five frontend artifacts;
3. verifies the #001 compatibility copy and byte pin;
4. runs Ruff, full backend pytest, frontend lint/tests/build, evidence/product/media/privacy gates, and `git diff --check`;
5. builds and verifies an ignored local Amplify package.

It has no live-provider or cloud action: no IBM access, job submission, AWS call, deployment, commit, or push. If canonical finalization is already complete, `npm run release:prepare-offline` runs the same validation matrix without invoking the two finalizers.

## Runtime contract

### Campaign and offline behavior

The production bundle contains a canonically synchronized copy of the five-entry campaign. Every selected entry is evidence-verified and includes a deterministic board and resolution plan. Universe selection, retries, reset, routes, progression, and gameplay require no IBM Quantum or AWS request. Completed universe numbers persist in a strict device-local record; no board, score, transcript, outcome, credential, or provider data is stored there. Selector access unlocks sequentially, an explicit reset returns progress to #001, and stable `/universe/001` through `/universe/005` links remain playable. Each universe has its own commitment-bound Guided Journey transcript.

COLAPSO is not marketed as a service-worker-backed offline-first PWA. After the current page and chunks are loaded, gameplay has no backend or provider dependency. The UI reports storage constraints without discarding the active in-memory experience.

### Availability and metadata

- Root HTML and fingerprinted JS/CSS load from the same HTTPS origin.
- Manifest, icons, local media, and published campaign data are packaged with the SPA.
- SPA fallback serves extensionless routes; missing static files remain real errors.
- Spanish title/description, canonical URL, Open Graph, Twitter card, theme, and install metadata are present.

### Security and cache policy

Amplify applies checked-in `custom-headers.yml`, including CSP, HSTS, frame, referrer, permissions, and content-type policies. The client uses no third-party analytics, remote fonts, mixed content, or runtime credentials. Fingerprinted assets are immutable; HTML, manifest, identity media, and universe data revalidate; source maps are excluded.

## Operational boundaries

### No automatic deployment

GitHub Actions builds and verifies but receives no AWS credential and does not deploy. A new Amplify release requires an explicitly authorized operator and a clean committed Git working tree. `deploy-amplify.ps1` now fails before cloud mutation when source changes are uncommitted. Rollback of a previously verified ZIP remains a separate operator decision.

### No runtime or release-time quantum execution

The browser and offline release commands never submit or retrieve IBM Runtime jobs. All five preserved results already exist. Optional future acquisition remains a separately authorized Python operator workflow and is not required for this release.

### Local generated state

These operational artifacts are ignored and must remain untracked:

- `deployment/aws-amplify/.deployment-state.json`
- `deployment/aws-amplify/.staging/`
- `deployment/aws-amplify/releases/`
- `frontend/dist/`
- backend coverage/cache output

## Screenshot workflow

Screenshot automation defaults to the local preview URL `http://127.0.0.1:4173`. It prepares the hero, #001 provenance, Explorer, Guided Journey, decoherence, result, mobile, campaign selector, Universe #005, and #005 shared-CHSH provenance captures. Remote capture is rejected unless `--allow-remote` is explicitly supplied. No production screenshot was captured in this sprint.

## Operator-only deployment and verification

After reviewing and committing the release, an authorized operator may run the exact PowerShell command in [`deployment/aws-amplify/README.md`](../deployment/aws-amplify/README.md). It validates AWS identity/profile/region, rebuilds, packages, uploads, starts a manual Amplify job, waits for terminal success, and stores redacted local state. This is a potentially billable cloud mutation and is intentionally not part of the offline gate.

A post-deployment read-only verification is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/aws-amplify/verify-deployment.ps1 `
  -Url "https://production.d333fud52cy2ho.amplifyapp.com"
```

This command performs network requests to the public site and was not run during offline preparation.

## Rollback

Amplify manual deployments are immutable jobs. An operator can redeploy a previously preserved, checksum-verified ZIP after confirming its origin commit and canonical URL. Generated release archives remain local operational artifacts.

## Remaining non-blocking limitations

- The campaign is a fixed five-universe release, not a scheduled daily feed.
- #002–#005 share #001's CHSH scientific reference and do not contain direct EstimatorV2 jobs.
- Provider job detail may require authorized IBM access; exported records remain inspectable offline.
- Separate Job IDs do not alone prove statistical independence.
- The client is auditable rather than anti-cheat secure.
- No public leaderboard or server-side replay validator exists.
- The player interface is Spanish only; engineering documentation is English.