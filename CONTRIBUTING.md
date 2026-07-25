# Contributing to COLAPSO

Thank you for helping improve COLAPSO. Contributions are welcome when they preserve deterministic behavior, evidence provenance, scientific guardrails, privacy, and the intentionally Spanish player interface.

## Before you start

- Search existing issues and pull requests.
- Use a focused issue for behavior changes or substantial design work.
- Report security-sensitive findings privately as described in [SECURITY.md](SECURITY.md).
- Do not submit credentials, personal data, private provider output, raw prompts/conversations, generated deployment state, or unlicensed media.

## Development setup

Requirements:

- Node.js 22+
- npm 10+
- Git
- Python 3.12 and uv only for quantum evidence tooling

```bash
git clone https://github.com/jpablortiz96/colapso-quantum-game.git
cd colapso-quantum-game
npm ci
npm run dev --workspace frontend
```

For Python work:

```bash
cd backend
uv sync --frozen
uv run pytest
```

No IBM or AWS credential is needed for ordinary development.

## Project invariants

### Determinism

F1 engine behavior must remain a pure function of versioned state, action, and entropy-source input. Tests involving randomness must use deterministic sources. New serialized fields require explicit versioning and compatibility decisions.

### Evidence labels

Never present Aer/local output as real hardware evidence. Real evidence must preserve provider provenance, raw exports before derivation, manifest state, and integrity hashes. Existing real-run artifacts are immutable.

### Scientific claims

Keep language consistent with [docs/CLAIMS.md](docs/CLAIMS.md):

- one-basis correlation is not a Bell violation;
- CHSH includes uncertainty and is not device-independent or loophole-free;
- no quantum advantage or anti-cheat claim;
- deterministic expansion does not create physical entropy;
- game pair mechanics are not physical-pair certification.

### Language

- Player-facing UI: Spanish (`es-419`)
- Source, tests, comments, commit messages, and public engineering docs: English
- Preserved evidence values and established identifiers: unchanged

### Security and privacy

Do not commit tokens, keys, `.env` files, local paths, personal email addresses, deployment state, release ZIPs, source maps, or provider account data. Job IDs already included in the preserved public evidence are intentional provenance references.

## Making a change

1. Create a branch from `main`.
2. Keep the change scoped; do not combine unrelated refactors.
3. Add or update tests when behavior changes.
4. Update public documentation when contracts, commands, or claims change.
5. Run the relevant checks locally.
6. Open a pull request explaining intent, boundaries, and verification.

## Verification

The complete public gate is:

```bash
npm run lint
npm run test -- --run
npm run build
npm run verify:production
npm run verify:amplify-package
npm run verify:public-repo
npm run scan:secrets
```

For evidence or backend changes also run:

```bash
cd backend
uv run ruff check .
uv run pytest
```

For daily-universe or preserved-evidence changes, run the matching `verify:f*` scripts and describe why the immutable artifact needs to change.

## Pull requests

A strong pull request includes:

- a concise problem and solution;
- affected architectural boundary;
- player-visible impact, if any;
- scientific/evidence impact, if any;
- test and verification commands run;
- screenshots for visual changes;
- no generated build output or local operational state.

Maintainers may ask for a smaller change if engine, evidence, presentation, deployment, and documentation concerns are mixed unnecessarily.

## Media

Documentation media must be original or have a compatible, documented license. Production screenshots must come from the real deployed application, contain no browser chrome or personal data, and use WebP. Do not use third-party brand logos without permission.

## Deployment

Pull requests and CI never deploy. Do not run AWS or live IBM commands as part of a contribution unless the repository owner explicitly authorizes that operation and scope. Read-only production verification is acceptable.

## Commit style

Use short imperative/conventional messages where practical, for example:

```text
fix(engine): preserve replay ordering
docs: clarify CHSH uncertainty
feat(ui): improve keyboard focus state
```

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
