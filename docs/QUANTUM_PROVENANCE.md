# Quantum Provenance

COLAPSO's finalized campaign contains five deterministic universes compiled from five separately submitted and preserved IBM Quantum SamplerV2 hardware executions. Universe #001 additionally preserves the campaign's direct EstimatorV2/CHSH record. Universes #002–#005 reference that fixed #001 CHSH record explicitly; they do not claim direct EstimatorV2 evidence of their own.

![Quantum provenance pipeline](media/quantum-pipeline.svg)

## Campaign summary

| Field | Value |
| --- | --- |
| Campaign ID | `colapso-five-hardware-universes-v1` |
| Campaign state | `EVIDENCE_ACQUIRED` / five published entries |
| Hardware backend | `ibm_fez` |
| Direct SamplerV2 executions | 5 |
| Direct EstimatorV2 executions used by the campaign | 1, attached to Universe #001 |
| Universe schema / engine rules | `1` / `1` |
| Campaign index | [`evidence/campaign-index.json`](../evidence/campaign-index.json) |
| Campaign index SHA-256 | `bc3cb080daed5c29eaed6caf14cc7fb9ee7a6b2ed6091038e1c67c141755577d` |
| Published bundle | [`frontend/public/data/universes/campaign.json`](../frontend/public/data/universes/campaign.json) |

The campaign index records the exact limitation: the executions may share a backend and circuit family. COLAPSO describes them as separate preserved hardware workloads and does not claim statistical independence solely from distinct Job IDs.

## Published universes

| # | Date | Title | Direct SamplerV2 Job ID | Evidence path | Primitive provenance | Published commitment |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | `2026-07-22` | Origin Universe | `d9ftp02neu4c739q2u7g` | `evidence/runs/real/real-20260721t205417z` | Direct SamplerV2 + EstimatorV2 | `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579` |
| 002 | `2026-07-23` | Entangled Paths | `d9jtrbjhdfks73cirkmg` | `evidence/universe-002` | Direct SamplerV2 + shared #001 CHSH | `bd5f8c97b66339df9f453c4a527bf6e68654c0472be133170aaf0c30b304cb27` |
| 003 | `2026-07-24` | The Void Protocol | `d9jttb3hdfks73cirmq0` | `evidence/universe-003` | Direct SamplerV2 + shared #001 CHSH | `be311b3567602eaa3bfd4da7881d5830b9ffc07bad97452e52b3c340d408eebe` |
| 004 | `2026-07-25` | Energy Crisis | `d9jtvjrhdfks73cirp90` | `evidence/universe-004` | Direct SamplerV2 + shared #001 CHSH | `f8bcf4ff0154c8b4091f01236509046004223ae4ca46e43a7f0836276a5780ae` |
| 005 | `2026-07-26` | Quantum Storm | `d9juap0ii2cc73efdch0` | `evidence/universe-005` | Direct SamplerV2 + shared #001 CHSH | `c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56` |

The five Job IDs are distinct, and strict verification also requires four distinct new runtime-raw results for #002–#005. Job IDs are provenance metadata, not authentication secrets, although provider-side inspection may require an authorized IBM account.

## Primitive provenance model

### Universe #001: direct dual primitive

The preserved run [`real-20260721t205417z`](../evidence/runs/real/real-20260721t205417z/) contains:

- a direct SamplerV2 Runtime result for entropy and one-basis correlation;
- a direct EstimatorV2 Runtime result for the multi-basis CHSH witness;
- canonical raw and derived records, manifest, provenance, submission metadata, and `SHA256SUMS`.

Its published source artifact remains byte-pinned. `frontend/public/data/universes/2026-07-22.json` has SHA-256 `9749d5b4a3092a3557adef9f13eb79e7b4bd78f3d957a959450a4d6ed84f1fbd`, and the compatibility copy is required to be byte-identical.

### Universes #002–#005: direct Sampler, shared CHSH

Each evidence directory contains its own direct SamplerV2 export, canonical result, accepted entropy, Bell-derived record, manifest, submission record, verification report, and hashes. Each published campaign entry uses provenance kind `DIRECT_SAMPLER_SHARED_CHSH` and links to Universe #001's fixed EstimatorV2 evidence:

- Estimator Job ID `d9ftp0kinv1c73arre9g`;
- `estimator-runtime-raw.json` SHA-256 `37c2b070651bef4d1663866e7dce132ac0efa1687c010e07d2554f9ce60266af`;
- `chsh-derived.json` SHA-256 `e9f1bb47b1528dc46d4ac2f90dd40f9f1118ba7acc134cc6c9e04cc542a09f6e`;
- Universe #001 published commitment `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579`.

The in-game provenance modal follows the selected universe and presents this distinction directly.

## Preserved measurements and limits

### Accepted entropy

Every universe records 1,024 accepted bits from its direct SamplerV2 evidence. The compiler consumes the accepted source material through a versioned derivation. Ordinary SamplerV2 harvest does not certify cryptographic, device-independent, perfectly unbiased, or unpredictable randomness.

### One-basis correlation

Each Sampler evidence pack records a 256-shot one-basis Bell correlation. A strong `00`/`11` correlation in one basis is not a Bell violation and does not conclusively certify physical entanglement. The artifacts use `ONE_BASIS_CORRELATION_ONLY_NOT_A_BELL_VIOLATION_OR_CONCLUSIVE_ENTANGLEMENT_CERTIFICATION`.

### Shared CHSH witness

The fixed Universe #001 EstimatorV2 record uses `E00 + E01 + E10 - E11` and reports:

- witness `S = 2.698628939348193`;
- propagated standard error `0.12161062756743832`;
- classical bound `2`;
- classification `STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT`;
- interpretation `REAL_WITH_UNCERTAINTY_NO_DEVICE_INDEPENDENT_OR_LOOPHOLE_FREE_CLAIM`.

For #002–#005 these values are shared scientific context only. They are not measurements made by those universes' direct Sampler jobs and are not represented as direct EstimatorV2 evidence.

## Deterministic compilation

For each entry, the compiler uses accepted source material as input to versioned, domain-separated SHA-256 counter-mode derivations:

1. `universe-attempt` selects the accepted compilation attempt.
2. `initial-state/v1` derives material for the 7×7 initial state.
3. `resolution-plan/v1` derives material for deterministic turn resolution.
4. `turn-resolution/v1` interprets the resolution stream during F1 actions.

The construction records domains, versions, counter starts, byte counts, and hashes in each universe. It extends material reproducibly; it does not create or certify new physical entropy. Published commitments bind the compiled artifacts, while acquisition commitments in #002–#005 manifests bind evidence inputs and are deliberately separate values.

Universe #005 illustrates that distinction:

| Fact | Value |
| --- | --- |
| Direct SamplerV2 Job ID | `d9juap0ii2cc73efdch0` |
| Completed | `2026-07-28T00:22:32.963685Z` |
| Evidence acquisition commitment | `bae7927d6e8a587c66c1e5ff5058d47cabcdabf4a347d71d32a26684dd5b724f` |
| Evidence manifest SHA-256 | `4266963aaf9662679521f7325d9efaf141550efb64336cd4a49406f4cb742294` |
| Runtime raw SHA-256 | `a08bd6c9702822dba974afe67003b496ff31e27b218ca0e19a7c6e59f038db7a` |
| Published universe commitment | `c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56` |

## Offline runtime and replay

The browser never contacts IBM Quantum. It validates the bundled campaign, selects a published universe, deserializes its F1 state, creates a deterministic resolution source, processes actions through the pure engine, and records a replayable transcript. Each universe has its own audited Guided Journey tied to that universe's published commitment and replayed with the 13-observation Guided budget. Universes #001–#003 use 23 actions; #004–#005 use 21.

Because each public artifact includes resolution material, a technically capable player can inspect future outcomes. This is intentional for an auditable educational release; there is no anti-cheat claim.

## Verify and finalize locally

The strict read-only verification path is:

```bash
npm run verify:campaign-evidence
npm run campaign:verify
node scripts/sync-f4a-universe.mjs --check
```

The complete repeatable offline finalization and release-preparation path is one command:

```bash
npm run release:finalize-offline
```

That command performs no IBM access, job submission, AWS call, deployment, commit, or push. It fails closed if preserved evidence, canonical artifacts, provenance links, commitments, the #001 byte pin, tests, build, or package checks do not match.

## Claims COLAPSO does not make

- No quantum job is executed for a player move or offline release validation.
- Separate Job IDs alone do not prove statistical independence.
- The one-basis correlations are not Bell violations.
- #002–#005 do not have direct EstimatorV2/CHSH evidence.
- The CHSH evidence is not loophole-free or device-independent certification.
- No quantum advantage is claimed.
- Tactical pairs are deterministic game mechanics, not asserted physical qubit pairs.
- Deterministic expansion does not manufacture physical entropy.
- The public client is not anti-cheat secure.
- Provider records are not guaranteed to be anonymously accessible.

See [CLAIMS.md](CLAIMS.md) for the normative claim ledger and [EVIDENCE.md](EVIDENCE.md) for evidence registration.