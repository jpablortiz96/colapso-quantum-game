<p align="center">
  <img src="docs/media/readme-hero.svg" alt="COLAPSO — observe, navigate, verify" width="100%" />
</p>

<p align="center">
  <strong>A deterministic five-universe puzzle campaign compiled from preserved IBM Quantum hardware evidence.</strong><br />
  Choose a universe, observe uncertain cells, manage a finite resource budget, survive decoherence, and reach the golden exit.
</p>

<p align="center">
  <a href="https://production.d333fud52cy2ho.amplifyapp.com"><img alt="Play COLAPSO" src="https://img.shields.io/badge/PLAY-LIVE-22d3ee?style=for-the-badge&labelColor=082f49" /></a>
  <a href="https://github.com/jpablortiz96/colapso-quantum-game/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/jpablortiz96/colapso-quantum-game/ci.yml?branch=main&style=for-the-badge&label=CI" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-a855f7?style=for-the-badge" /></a>
  <img alt="Node 22 or newer" src="https://img.shields.io/badge/node-%3E%3D22-65a30d?style=for-the-badge" />
</p>

<p align="center">
  <a href="#play-now">Play now</a> ·
  <a href="#how-it-plays">Gameplay</a> ·
  <a href="#quantum-provenance">Quantum provenance</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#run-locally">Run locally</a> ·
  <a href="#scientific-boundaries">Scientific boundaries</a>
</p>

> **Language note:** the player experience is intentionally Spanish (`es-419`). Source code and public engineering documentation are English.

## Five-universe release

COLAPSO turns **five preserved IBM Quantum hardware executions** into **five deterministic, replayable puzzle universes**. The published evidence packs, manifests, hashes, commitments, boards, and resolution plans can be verified entirely offline; playing never submits or retrieves a quantum job.

| Judge link | Destination |
| --- | --- |
| **Live demo** | [production.d333fud52cy2ho.amplifyapp.com](https://production.d333fud52cy2ho.amplifyapp.com) |
| **Public repository** | [github.com/jpablortiz96/colapso-quantum-game](https://github.com/jpablortiz96/colapso-quantum-game) |
| **Five-minute demo video** | **Coming soon** — follow the exact recording plan in [`DEMO_SCRIPT_5_MIN.md`](DEMO_SCRIPT_5_MIN.md) |
| **Offline verification** | `npm run release:prepare-offline` |

**Controls:** select cells and visible actions with mouse/touch; move the board cursor with arrow keys or WASD; press Space to select/act, Enter for the primary action, X/H for powers, Q for an Explorer pulse, M for sound, R to restart, `?` for help, and Escape to close dialogs.

## Play now

**[Launch the production game →](https://production.d333fud52cy2ho.amplifyapp.com)**

No account, wallet, API key, quantum-provider access, or installation is required. The deployed application is a static SPA: once its assets and published campaign are loaded, gameplay runs locally in the browser.

<p align="center">
  <a href="https://production.d333fud52cy2ho.amplifyapp.com"><img src="docs/media/screenshots/01-hero.webp" alt="COLAPSO production landing screen" width="92%" /></a>
</p>

## Why COLAPSO is different

Many “quantum” games use the word as a visual theme. COLAPSO makes provenance part of the system:

- **Five preserved hardware inputs:** one direct SamplerV2 execution per universe, plus the preserved Universe #001 EstimatorV2/CHSH record; manifests and SHA-256 checksums bind every public claim.
- **Five compiled universes:** accepted material is expanded through a documented SHA-256 counter-mode construction into versioned 7×7 boards and deterministic resolution plans.
- **A pure rules engine:** observation, movement, entanglement policies, decoherence, scoring, serialization, and replay are deterministic F1 rules.
- **An inspectable client:** every board, resolution plan, evidence reference, and integrity commitment is public. COLAPSO does not claim anti-cheat secrecy.
- **Bounded scientific language:** Universe #001 has direct SamplerV2 and EstimatorV2 provenance; Universes #002–#005 have direct SamplerV2 provenance and explicitly share #001's CHSH reference rather than claiming direct EstimatorV2 evidence.

The game does **not** submit a quantum job for each move. Quantum acquisition happened before publication; the browser consumes preserved, versioned artifacts.

## How it plays

Your observer starts in the lower-left corner. The exit is in the upper-right. Most cells begin as possibilities:

1. **Observe** a possibility to resolve it, spending one observation.
2. **Navigate** through traversable outcomes while managing energy and resources.
3. **Anticipate decoherence:** every fourth turn, the field resolves another possibility on its own.
4. **Reach the exit** with a replayable action transcript.

The landing screen exposes five verified campaign entries with distinct boards, copy, color themes, commitments, and device-local completion progress. Universe #001 is always unlocked; each victory unlocks the next selector entry, and an explicit reset clears campaign progress. Stable direct links `/universe/001` through `/universe/005` remain playable without fabricating prior victories. Quantum Mission, Explorer, and a board-specific audited Guided Journey are available for every universe.

| Mode | Availability | Purpose | Presentation |
| --- | --- | --- | --- |
| **Quantum Mission** | Universes #001–#005 | Canonical challenge | 10 observations, official score, no hints or rewind |
| **Explorer** | Universes #001–#005 | Learn through assisted planning | 13 observations, visible tactical margin, five optional pulses |
| **Guided Journey** | Universes #001–#005 | Follow one audited solution for the selected board | 21–23 explicit steps, three rewinds, non-competitive result |

See [Gameplay](docs/GAMEPLAY.md) for controls, resources, powers, accessibility, and mode details.

### Single-screen desktop cockpit

During active play at supported desktop cockpit sizes (at least 1100×680), the complete 7×7 board, command telemetry, decoherence pressure, resource state, quantum powers, and primary Observer Console action share one browser viewport. Document scrolling is disabled only for that active desktop state; dialogs retain their own safe overflow. Tablet and mobile layouts keep a natural single document flow without a nested console scrollbar, while optional probabilities, coherence, event history, tactical details, help, and provenance remain available under **Más telemetría**.

Gameplay labels, board probabilities, console copy, and expanded telemetry use a clearer responsive type scale. The mode, resource summary, selected objective, and primary action remain pinned in the desktop Observer Console while lower tools and expanded information scroll inside their own keyboard-focusable region when needed.

The cockpit changes presentation only. Observation budgets, powers, score, decoherence cadence, hidden results, replay, keyboard semantics, and the published universe are unchanged.

<table>
  <tr>
    <td width="50%"><img src="docs/media/screenshots/03-explorer-mode.webp" alt="Explorer mode with the board and tactical console" /></td>
    <td width="50%"><img src="docs/media/screenshots/04-decoherence-alert.webp" alt="Maximum decoherence alert before the field changes" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Explorer mode</strong><br />Visible planning support without changing F1 rules.</td>
    <td align="center"><strong>Decoherence pressure</strong><br />A persistent warning before the next collapse.</td>
  </tr>
  <tr>
    <td><img src="docs/media/screenshots/05-guided-journey.webp" alt="Guided Journey showing the next audited action" /></td>
    <td><img src="docs/media/screenshots/06-final-result.webp" alt="Completed Guided Journey with deterministic route map" /></td>
  </tr>
  <tr>
    <td align="center"><strong>Guided Journey</strong><br />Concepts introduced through real player actions.</td>
    <td align="center"><strong>Verifiable result</strong><br />Route, metrics, and transcript-derived outcome.</td>
  </tr>
</table>

<p align="center">
  <img src="docs/media/screenshots/07-mobile.webp" alt="COLAPSO responsive production landing screen on mobile" width="32%" />
</p>
<p align="center"><strong>Responsive by design.</strong> The same production experience adapts to a narrow touch viewport without a separate client.</p>

## Quantum provenance

<p align="center">
  <img src="docs/media/quantum-pipeline.svg" alt="COLAPSO quantum provenance pipeline" width="100%" />
</p>

The finalized campaign is `colapso-five-hardware-universes-v1`. Its strict offline index is [`evidence/campaign-index.json`](evidence/campaign-index.json), with SHA-256 `bc3cb080daed5c29eaed6caf14cc7fb9ee7a6b2ed6091038e1c67c141755577d`. Five distinct SamplerV2 Job IDs and five distinct preserved results are verified; the project does not infer statistical independence solely from separate jobs.

| # | Title | Direct evidence | CHSH provenance | Published commitment |
| --- | --- | --- | --- | --- |
| 001 | Origin Universe | SamplerV2 + EstimatorV2 | Direct | `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579` |
| 002 | Entangled Paths | SamplerV2 | Shared reference to #001 | `bd5f8c97b66339df9f453c4a527bf6e68654c0472be133170aaf0c30b304cb27` |
| 003 | The Void Protocol | SamplerV2 | Shared reference to #001 | `be311b3567602eaa3bfd4da7881d5830b9ffc07bad97452e52b3c340d408eebe` |
| 004 | Energy Crisis | SamplerV2 | Shared reference to #001 | `f8bcf4ff0154c8b4091f01236509046004223ae4ca46e43a7f0836276a5780ae` |
| 005 | Quantum Storm | SamplerV2 | Shared reference to #001 | `c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56` |

Universe #001 supplies the campaign's fixed CHSH scientific reference from [`evidence/runs/real/real-20260721t205417z`](evidence/runs/real/real-20260721t205417z/):

| Fact | Published value |
| --- | --- |
| Hardware backend | `ibm_fez` |
| Runtime primitives | Direct SamplerV2 and EstimatorV2 |
| Accepted entropy material | 1,024 bits |
| One-basis observed correlation | `0.9140625` from 256 shots |
| CHSH witness | `2.698628939348193` |
| Propagated standard error | `0.12161062756743832` |
| Classical CHSH bound | `2` |
| Evidence classification | `STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT` |
| Expansion | SHA-256 counter mode, domain separated |

The in-game provenance panel exposes the same chain and its limitations:

<p align="center">
  <img src="docs/media/screenshots/02-quantum-provenance.webp" alt="In-game quantum provenance and scientific guardrails" width="92%" />
</p>

Read [Quantum Provenance](docs/QUANTUM_PROVENANCE.md) for artifact-level details and [Evidence](docs/EVIDENCE.md) for the evidence contract.

## Scientific boundaries

COLAPSO reports preserved measurements; it does not inflate them into broader claims.

- The displayed Bell correlation is a **single-basis correlation**. By itself it is not a Bell violation or conclusive entanglement certification.
- The CHSH witness is reported with propagated uncertainty. It is not presented as device-independent or loophole-free.
- The CHSH values shown for Universes #002–#005 are an explicit shared reference to Universe #001's EstimatorV2 evidence, not direct EstimatorV2 evidence for those universes.
- Separate Job IDs establish separate preserved executions; they do not by themselves prove statistical independence.
- No quantum-advantage claim is made.
- Tactical “entangled pairs” are deterministic game mechanics; they are not claims about persistent physical qubit pairs.
- SHA-256 expansion makes accepted source material reproducible; it does not create or certify new physical entropy.
- Provider job records can require authorized IBM access. Public exports, provenance, and hashes remain independently inspectable here.
- The client publishes its resolution material. No anti-cheat or unpredictability guarantee is claimed.

See [Claims](docs/CLAIMS.md) for the complete claim ledger.

## Architecture

<p align="center">
  <img src="docs/media/system-architecture.svg" alt="COLAPSO system architecture" width="100%" />
</p>

COLAPSO separates acquisition, compilation, deterministic rules, and presentation:

```text
preserved IBM evidence (5 Sampler jobs + #001 Estimator/CHSH)
        ↓
campaign compiler → five versioned universe JSON files + commitments
        ↓
pure TypeScript F1 engine → deterministic state transitions + replay
        ↓
React presentation → stable routes, persisted progression, five themes, three modes and five audited guides
        ↓
Vite static build → operator-deployed AWS Amplify Hosting
```

The production runtime has no application backend and no quantum-provider credential. Python tooling under `backend/` creates and verifies evidence offline; the browser never imports it. See [Architecture](docs/ARCHITECTURE.md) for trust boundaries and module ownership.

## Run locally

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer (the lockfile records npm 11.8.0)
- Git

### Frontend

```bash
git clone https://github.com/jpablortiz96/colapso-quantum-game.git
cd colapso-quantum-game
npm ci
npm run dev --workspace frontend
```

Vite prints the local URL. No IBM or AWS credential is needed to build, test, or play.

### Finalized campaign verification

The complete release candidate can be finalized and validated with one repeatable offline command:

```bash
npm run release:finalize-offline
```

It strictly rechecks preserved evidence, regenerates the five canonical campaign artifacts, runs backend lint/tests and all frontend/repository gates, builds the SPA, and verifies an ignored local Amplify package. It does not contact IBM Quantum or AWS, submit a job, deploy, commit, or push. Once finalization is already recorded, the non-finalizing validation entry point is:

```bash
npm run release:prepare-offline
```

Individual gates remain available:

```bash
npm run verify:campaign-evidence
npm run campaign:verify
npm run lint
npm run test
npm run build
npm run verify:production
npm run verify:amplify-package
npm run verify:public-repo
npm run scan:secrets
```

CI runs repository, frontend, evidence, media, privacy, production, and packaging gates on every pull request and on pushes to `main`. Verification commands fail closed; no CI job receives AWS or IBM credentials.

### Optional Python evidence tooling

The Python tooling requires Python 3.12 and pinned dependencies from `backend/uv.lock`:

```bash
cd backend
uv sync --frozen
uv run pytest
uv run python -m colapso_quantum.cli simulate --seed 7 --shots 256
```

Simulation output is always labeled simulated. Live submission is optional, credentialed, and outside normal development; read [`backend/README.md`](backend/README.md) before using it.

## Repository map

| Path | Responsibility |
| --- | --- |
| `frontend/src/engine/` | Pure deterministic game rules and replay contracts |
| `frontend/src/daily-universe/` | Evidence-to-universe compilation and verification |
| `frontend/src/components/` | Spanish player experience and accessible controls |
| `frontend/public/data/universes/` | Five immutable universe artifacts plus campaign/index manifests |
| `backend/src/colapso_quantum/` | Qiskit evidence, provider, and provenance tooling |
| `evidence/campaign-index.json` | Strict five-execution campaign inventory and limitations |
| `evidence/runs/real/`, `evidence/universe-*` | Preserved real-hardware evidence packs |
| `evidence/runs/simulated/` | Explicitly labeled local simulation evidence |
| `deployment/aws-amplify/` | Reproducible static packaging, deployment, and verification |
| `docs/` | Architecture, claims, gameplay, provenance, and operations |
| `scripts/` | Repository verifiers, screenshot capture, and release tooling |

## Built with Kiro

<p align="center">
  <img src="docs/media/kiro-engineering-workflow.svg" alt="Human-directed engineering workflow with Kiro" width="100%" />
</p>

Kiro was used as an agentic development environment for requirements refinement, implementation, test feedback, evidence review, deployment automation, and public-release curation. The developer retained responsibility for scope, claims, credentials, infrastructure actions, commits, and publication. Read [Built with Kiro](docs/BUILT_WITH_KIRO.md) for the workflow and artifact policy.

The diagram above is original project artwork. It does not use or represent an official Kiro logo.

## Production and security

- **Live application:** [production.d333fud52cy2ho.amplifyapp.com](https://production.d333fud52cy2ho.amplifyapp.com)
- **Hosting:** manually deployed static AWS Amplify branch with SPA routing and explicit security/cache headers
- **Readiness:** [Production Readiness](docs/PRODUCTION_READINESS.md)
- **Deployment:** [AWS Amplify guide](deployment/aws-amplify/README.md)
- **Vulnerabilities:** use [GitHub private vulnerability reporting](SECURITY.md); do not open a public issue for sensitive reports

## Contributing

Issues and focused pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), preserve deterministic behavior, label simulated evidence, and keep scientific claims within the published guardrails.

## License

Released under the [MIT License](LICENSE). Copyright © 2026 COLAPSO contributors.
