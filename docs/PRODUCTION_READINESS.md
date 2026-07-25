# Production Readiness

**Live application:** <https://production.d333fud52cy2ho.amplifyapp.com>

**Hosting model:** static Vite SPA on the manually managed AWS Amplify `production` branch. The application has no runtime backend, database, authentication service, IBM credential, or AWS credential.

The most recent deployment verification completed all 23 checks against the canonical production deployment on 2026-07-21/22 UTC. Publication work does not redeploy or change AWS infrastructure.

## Release posture

| Area | Status | Evidence |
| --- | --- | --- |
| Deterministic engine | Ready | Unit, property, serialization, replay, and integration suites |
| Published universe | Ready | Schema verification, source hashes, commitment, fixed rules version |
| Real evidence | Ready | Preserved raw/derived records, manifest, provenance, SHA-256 sums |
| Scientific claims | Bounded | [CLAIMS.md](CLAIMS.md) and [QUANTUM_PROVENANCE.md](QUANTUM_PROVENANCE.md) |
| Responsive player UI | Ready | Desktop/mobile layouts, keyboard, focus, reduced motion, status channels |
| Static build | Ready | TypeScript and Vite production build |
| Amplify package | Ready | Reproducible ZIP rules and package tests |
| Live hosting | Ready | HTTPS, SPA routes, metadata, assets, headers, caching, budgets, smoke checks |
| Public repository | Gated | Public-repository verifier, secret scan, fresh-history mirror, GitHub CI |

## Build gate

From the repository root:

```bash
npm ci
npm run lint
npm run test -- --run
npm run build
npm run verify:production
npm run verify:amplify-package
npm run verify:public-repo
npm run scan:secrets
```

The build gate validates source, tests, daily-universe contracts, production metadata, offline behavior, media, public documentation, privacy boundaries, and the static package contract.

## Runtime contract

### Availability

- Root document responds over HTTPS.
- Fingerprinted JS and CSS assets load from the same origin.
- The web manifest and required icons are available.
- SPA fallback routes return the application document.
- A static missing asset remains a real 404 rather than receiving the SPA document.

### Metadata

- Spanish title and description match the player experience.
- Canonical and Open Graph URLs match the production branch URL.
- Open Graph and Twitter card metadata are present.
- Theme color and install metadata are present.

### Security headers

Amplify applies the checked-in `custom-headers.yml`, including a Content Security Policy and defensive browser headers. The exact values are version controlled and checked by `verify-deployment.ps1`.

The client does not require inline application scripts, third-party analytics, remote fonts, or mixed HTTP content. Audio and visual assets are same-origin.

### Cache policy

- Fingerprinted assets receive long-lived immutable caching.
- HTML, manifests, and universe index/data remain revalidatable.
- Source maps are not deployed.

### Offline behavior

COLAPSO is not marketed as a service-worker-backed offline-first PWA. After the current page and its chunks/data are loaded, gameplay has no backend or provider dependency. The UI reports network and local-storage constraints without discarding the active in-memory experience.

## Operational boundaries

### No automatic cloud deployment in CI

GitHub Actions builds and verifies but receives no AWS credential and does not deploy. Production deployment is a deliberate operator action using AWS CLI v2 and the PowerShell tooling in `deployment/aws-amplify/`.

### No runtime quantum execution

The browser uses a precompiled universe. It never submits or retrieves IBM Runtime jobs. Optional live evidence acquisition belongs to the Python operator workflow and is not part of a web release.

### Local state is private and ignored

These deployment artifacts must remain untracked:

- `deployment/aws-amplify/.deployment-state.json`
- `deployment/aws-amplify/.staging/`
- `deployment/aws-amplify/releases/`
- `frontend/dist/`

The public mirror copies tracked files only and rejects these paths.

## Manual production verification

A safe, read-only live check is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deployment/aws-amplify/verify-deployment.ps1 `
  -Url "https://production.d333fud52cy2ho.amplifyapp.com"
```

This checks the deployed application; it does not create, update, or redeploy AWS resources.

## Rollback

Amplify manual deployments are immutable jobs. An operator can redeploy a previously preserved, verified ZIP to the same branch after confirming its commit, canonical URL, and checksums. Generated release ZIPs are local operational artifacts and are intentionally absent from Git.

## Remaining non-blocking limitations

- The current public artifact contains one compiled real universe rather than a scheduled daily feed.
- Provider job detail may require authorized IBM access; exported records remain public.
- The client is auditable rather than anti-cheat secure.
- No public leaderboard or server-side replay validator exists.
- The player interface is Spanish only; engineering documentation is English.

These are disclosed product boundaries, not hidden production dependencies.
