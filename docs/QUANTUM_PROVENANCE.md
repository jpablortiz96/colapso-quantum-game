# Quantum Provenance

COLAPSO Universe #001 is compiled from preserved IBM Quantum hardware evidence. This document traces that chain, identifies every public artifact, and states the scientific limits of the result.

![Quantum provenance pipeline](media/quantum-pipeline.svg)

## Provenance summary

| Field | Value |
| --- | --- |
| Universe ID | `colapso-2026-07-22-001` |
| Universe number | `1` |
| Evidence run | `real-20260721t205417z` |
| Backend | `ibm_fez` |
| Mode | `REAL` |
| Runtime primitives | SamplerV2 and EstimatorV2 |
| Accepted entropy | 1,024 bits |
| Universe schema | 1 |
| Engine rules | 1 |
| Generated at | `2026-07-22T15:03:39.867076Z` |
| Commitment | `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579` |

Public universe: [`frontend/public/data/universes/2026-07-22.json`](../frontend/public/data/universes/2026-07-22.json)

Evidence pack: [`evidence/runs/real/real-20260721t205417z/`](../evidence/runs/real/real-20260721t205417z/)

## Stage 1: preserved execution records

The real run used separate runtime primitives for separate purposes:

- **SamplerV2** produced measurement samples used by the entropy and one-basis correlation paths.
- **EstimatorV2** produced expectation values for a multi-basis CHSH witness.

COLAPSO preserves the exported records before compiling the game universe:

| Artifact | Role |
| --- | --- |
| `submission.json` | Submission inputs and provider job references |
| `sampler-runtime-raw.json` | Directly exported SamplerV2 runtime structure |
| `sampler-raw.json` | Canonical sampler representation |
| `estimator-runtime-raw.json` | Directly exported EstimatorV2 runtime structure |
| `estimator-raw.json` | Canonical estimator representation |
| `result-structure.json` | Inventory of returned result shapes |
| `preflight.json` | Provider-plan and execution preflight evidence |
| `provenance.json` | Backend, dependency, primitive, and retrieval provenance |
| `manifest.json` | Evidence-pack state and artifact inventory |
| `SHA256SUMS` | Integrity digest list |

The two IBM job IDs are retained in the pack and universe as scientific provenance. They are not authentication secrets, although provider-side inspection may require an authorized IBM account.

## Stage 2: derived measurements

### Accepted entropy

`entropy-derived.json` records 1,024 accepted bits and the source material used by the compiler. The source entropy hash is:

```text
dc0dd25eeb7cce3e8a2950ac167d419b869f9503a97d63abd3cca22261b1b6a3
```

The acceptance record does not claim device-independent randomness certification.

### One-basis correlation

`bell-derived.json` records:

- 256 shots;
- observed correlation `0.9140625`;
- interpretation `ONE_BASIS_CORRELATION_ONLY_NOT_A_BELL_VIOLATION_OR_CONCLUSIVE_ENTANGLEMENT_CERTIFICATION`.

A strong correlation in one measurement basis is not, by itself, a Bell test. COLAPSO labels it accordingly.

### CHSH witness

`chsh-derived.json` records the sign convention `E00 + E01 + E10 - E11` and:

- witness `S = 2.698628939348193`;
- propagated standard error `0.12161062756743832`;
- classical bound `2`;
- classification `STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT`;
- interpretation `REAL_WITH_UNCERTAINTY_NO_DEVICE_INDEPENDENT_OR_LOOPHOLE_FREE_CLAIM`.

The witness is evidence above the classical bound under the recorded execution and analysis assumptions. It is not described as device-independent, loophole-free, or a demonstration of quantum advantage.

## Stage 3: deterministic expansion

The compiler uses accepted source material as input to versioned, domain-separated SHA-256 counter-mode derivations:

1. `universe-attempt` selects the accepted compilation attempt.
2. `initial-state/v1` derives material for the 7×7 initial state.
3. `resolution-plan/v1` derives material for deterministic turn resolution.
4. `turn-resolution/v1` interprets the resolution stream during F1 actions.

The construction records domains, versions, counter starts, byte counts, and material hashes in the universe artifact. It extends material reproducibly; it does not create or certify new physical entropy.

## Stage 4: committed universe

The resulting artifact contains the initial state, public board, pair policies, resolution plan, scientific summaries, source hashes, and client disclosure. The commitment binds the published artifact to:

```text
bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579
```

Because the client artifact includes resolution material, a technically capable player can inspect future outcomes. This is intentional for an auditable educational release. There is no anti-cheat claim.

## Stage 5: deterministic F1 replay

At runtime the browser does not contact IBM Quantum. It:

1. loads and validates the published universe;
2. deserializes the F1 initial state;
3. creates a deterministic resolution entropy source;
4. processes player actions through the pure engine;
5. records the action transcript;
6. reproduces the same result when the same transcript is replayed against the same rules and universe.

The Guided Journey transcript contains 23 actions and is separately referenced by SHA-256 in `frontend/src/components/guided-journey.ts`.

## Verify locally

Install JavaScript and Python dependencies as described in the root README, then run:

```bash
npm run verify:f2b
npm run verify:f4a
npm run verify:production
```

The evidence pack's `SHA256SUMS` can also be reviewed directly. Do not edit a preserved real-run artifact in place; a changed byte must invalidate the associated integrity check.

## Claims COLAPSO does not make

- No quantum job is executed for each player move.
- The one-basis correlation is not a Bell violation.
- The evidence is not a loophole-free or device-independent certification.
- No quantum advantage is claimed.
- Visual or tactical pairs are not asserted to be persistent physical pairs.
- Deterministic expansion does not manufacture physical entropy.
- The public client is not anti-cheat secure.
- Access to provider job records is not guaranteed without IBM authorization.

See [CLAIMS.md](CLAIMS.md) for the normative claim ledger and [EVIDENCE.md](EVIDENCE.md) for evidence-pack rules.
