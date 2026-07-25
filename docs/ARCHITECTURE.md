# Architecture

COLAPSO is an evidence-backed, deterministic browser game. Its architecture deliberately separates quantum acquisition from gameplay: provider access happens offline, artifacts are preserved and compiled, and the production browser runs only static assets and pure state transitions.

![COLAPSO system architecture](media/system-architecture.svg)

## Design goals

1. **Deterministic gameplay.** The same universe artifact and action transcript must produce the same F1 state and result.
2. **Auditable provenance.** Real and simulated evidence remain distinguishable, versioned, and hashable.
3. **Bounded claims.** Measurements, interpretations, and game mechanics are separate concepts.
4. **Static production.** The deployed player has no backend dependency, quantum credential, or per-move network call.
5. **Accessible presentation.** Mouse, keyboard, responsive layouts, reduced motion, focus management, and non-audio status cues are first-class.
6. **Fail-closed publication.** Tests, evidence verifiers, package checks, media checks, privacy scans, and CI guard the public repository.

## System layers

### 1. Evidence acquisition

Location: `backend/src/colapso_quantum/`

The Python 3.12 package owns circuit definitions, local Aer simulation, IBM Runtime integration, SamplerV2/EstimatorV2 parsing, CHSH derivation, entropy acceptance, canonical JSON, and evidence persistence. Real execution is an explicit operator action; normal development and CI are credential-free.

Outputs are immutable evidence packs under:

- `evidence/runs/real/` for provider-derived records
- `evidence/runs/simulated/` for explicitly simulated records

A pack preserves raw exports before derived records, plus a manifest, provenance, submission metadata, and SHA-256 checksums. Provider job IDs are provenance references, not credentials.

### 2. Daily-universe compilation

Location: `frontend/src/daily-universe/`

The compiler accepts a verified evidence pack and produces a versioned `DailyUniverse` artifact. The artifact contains:

- source-evidence identifiers and hashes;
- accepted entropy metadata;
- scientific summaries and interpretations;
- a 7×7 initial game state;
- deterministic resolution-plan material;
- entangled-pair game policies;
- client disclosure and a commitment.

Accepted source material is expanded with domain-separated SHA-256 counter mode. Expansion is reproducible; it does not create or certify additional physical entropy.

Published artifacts live in `frontend/public/data/universes/`. The current client intentionally publishes the resolution plan and therefore makes no anti-cheat or hidden-randomness claim.

### 3. F1 deterministic engine

Location: `frontend/src/engine/`

F1 is a pure TypeScript domain layer. It owns:

- state schemas and validation;
- coordinate and board invariants;
- cell collapse and probability distributions;
- observation budgets and inventory;
- movement, terminal states, and scoring inputs;
- pair-collapse policies;
- four-turn decoherence;
- entropy-source contracts;
- canonical serialization and replay.

The engine does not import React, browser APIs, sound, animation, storage, Qiskit, AWS, or network clients. Actions return explicit success or typed failure results rather than mutating external state.

### 4. Presentation and modes

Locations:

- `frontend/src/store/` — deterministic engine adapter and presentation state
- `frontend/src/components/` — player interface
- `frontend/src/production/` — safe preferences and runtime status

The Zustand store deserializes the published state, creates a fresh deterministic entropy source from the universe resolution plan, and records an action transcript. Quantum Mission, Explorer, and Guided Journey adjust presentation budgets and assistance; they do not replace the F1 rules.

The UI is Spanish (`es-419`) and provides semantic controls, focus-managed dialogs, keyboard navigation, reduced-motion support, responsive layouts, optional sound, and visual status channels.

### 5. Static build and hosting

Location: `deployment/aws-amplify/`

Vite emits the SPA to `frontend/dist/`. Packaging rejects source maps, source/test directories, `node_modules`, localhost references, and a wrapped `dist/` directory. AWS Amplify serves the root files over HTTPS with:

- SPA fallback routing;
- a Content Security Policy and defensive browser headers;
- immutable caching for fingerprinted assets;
- revalidation for HTML, manifests, and universe data;
- canonical and Open Graph URLs bound to the public branch URL.

Local deployment state, staging directories, and release ZIP files are ignored and are not part of the public repository.

## Runtime data flow

```text
GET /data/universes/index.json
  → select current universe artifact
  → validate and deserialize F1 initial state
  → create resolution entropy source from published plan
  → player action
  → F1 processAction(state, action, entropy)
  → next immutable state + typed events
  → presentation derives feedback, metrics, sound, and animation
  → transcript can be replayed against the same artifact
```

There is no runtime path from the browser to IBM Quantum or AWS APIs.

## Trust boundaries

| Boundary | Trusted inputs | Verification |
| --- | --- | --- |
| Provider → evidence pack | Authorized job results and runtime metadata | Structural parsers, canonical exports, manifest, SHA-256 |
| Evidence → universe | Verified accepted records | Evidence hashes, schema checks, derivation domains, commitment |
| Universe → engine | Published JSON | Runtime schema/deserialization and rules version |
| Engine → presentation | Typed states and events | Unit/property tests, replay tests, UI integration tests |
| Build → hosting | `frontend/dist` | Production verifier, package verifier, live deployment verifier |
| Private development → public source | Tracked allowlist | Public-repository verifier and fresh-history mirror builder |

## Determinism and replay

Determinism is scoped precisely: given the same rules version, universe artifact, initial state, resolution plan, and ordered actions, F1 produces the same serialized result. Visual timing, sound playback, and browser layout are not replay inputs.

The Guided Journey is a fixed 23-action transcript for Universe #001 with its own SHA-256 reference. It demonstrates one valid solution, not the only strategy.

## Security model

The production client is public and inspectable. It contains no IBM token, AWS credential, private API, personal data, or server-side secret. Browser storage contains only versioned local preferences: mute, reduced-motion choice, tutorial completion, last mode, and audio consent.

This model supports reproducibility and education, not competitive anti-cheat. A future leaderboard would require server-side transcript validation and a different disclosure model.

## Scientific model

The evidence layer records measurements and uncertainty. Game semantics consume derived deterministic material but do not imply that visual pairs are live physical qubits. Full claim boundaries are in [CLAIMS.md](CLAIMS.md) and pipeline details are in [QUANTUM_PROVENANCE.md](QUANTUM_PROVENANCE.md).

## Technology

- React 19, TypeScript 5.9, Zustand 5
- Vite 8, Tailwind CSS 4, Framer Motion 12, driver.js 1.8, Howler 2.2
- Vitest 4, Testing Library, fast-check, ESLint 10
- Python 3.12, Qiskit 2.5, Qiskit Aer 0.17, Qiskit IBM Runtime 0.48
- AWS Amplify static hosting via AWS CLI v2 and PowerShell
- GitHub Actions on Node 24

Dependency versions are pinned in lockfiles; this document describes the current public release rather than a future architecture.
