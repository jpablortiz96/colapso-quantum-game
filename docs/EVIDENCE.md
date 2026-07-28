# Evidence Register

This register began with the verified F1 baseline and now includes local tests, simulated evidence, preserved IBM Runtime V2 evidence, deterministic universe compilation, and the finalized five-universe campaign. Entries report only artifacts and commands actually observed; absence of a registered screenshot, new cloud deployment, or traction measurement remains explicit.

## Registration schema

Every future evidence record must contain:

| Field | Requirement |
| --- | --- |
| Evidence ID | Stable identifier such as `EV-YYYYMMDD-NNN`, never reused |
| Category | One of Kiro, Tests, Quantum jobs, CHSH, AWS, Gameplay, Public deployment, or User traction |
| Claim | Exact claim supported, linked to `docs/CLAIMS.md` where scientific |
| Observation | What was directly observed, without interpretation inflation |
| Source kind | Raw or derived |
| Real/simulated status | `REAL`, `SIMULATED`, or `NOT_APPLICABLE`; never inferred from a filename |
| Captured at | ISO 8601 UTC timestamp ending in `Z` |
| Source revision | Commit identifier and clean/dirty status, when repository-related |
| Environment | Relevant OS, runtime, dependency, provider, backend, and tool versions |
| Procedure | Exact command or reproducible manual procedure, including inputs and options |
| Artifact path | Stable repository or controlled-store path; no secret-bearing URL |
| SHA-256 | Digest and a statement of exact raw bytes or canonical serialization hashed |
| Raw parents | Evidence IDs and hashes of every input used by a derived artifact |
| Result | Factual result, including failures, uncertainty, counts, and limitations |
| Verified by | Verification procedure and UTC time; no invented reviewer identity |
| Redactions | What was removed and why, without reproducing the sensitive value |

## Entry checklist

- [ ] Raw input was captured before derivation and is immutable or versioned.
- [ ] Artifact contains no token, credential, authorization header, unnecessary personal data, or full bitstring linked to a personal identifier.
- [ ] UTC timestamps, dependency/runtime versions, source revision, procedure, and parameters are recorded.
- [ ] SHA-256 was calculated over clearly identified bytes or canonical data.
- [ ] Derived files can be regenerated from linked raw parents with the recorded method.
- [ ] Real hardware, simulation, local test, and documentation-only evidence are labeled correctly.
- [ ] Quantum entries include complete available job metadata and do not imply public Job ID access.
- [ ] The claim is no stronger than `docs/CLAIMS.md` permits.
- [ ] Failed, partial, noisy, discarded, substituted, or fallback results relevant to the claim are retained and disclosed.
- [ ] Visual evidence has sufficient context and no secrets or personal data.

Unchecked boxes define the checklist applied to future entries; they do not negate the completed records below.

## Kiro

No Kiro evidence is registered.

## Tests

The F1 baseline is registered as `EV-20260720-001`; checkpoint and final engine results are added as they are produced.

## Quantum jobs

Preserved real IBM Runtime evidence is registered in EV-20260722-013 and the finalized campaign entry below. Offline finalization did not submit or retrieve a job.

## CHSH

The direct Universe #001 EstimatorV2/CHSH record is registered in EV-20260722-013. Universes #002–#005 reference it as shared scientific provenance and do not claim direct EstimatorV2 jobs.

## AWS

AWS deployment is an operator-only action outside evidence acquisition and offline finalization. The tracked deployment workflow requires the named existing Amplify application, a clean committed tree, and post-deployment verification; it never creates another application.

## Gameplay

The deterministic frontend baseline is registered in EV-20260722-015; the finalized campaign entry below extends it to five selectable universes.

## Public deployment

Five-universe deployment evidence is established only by the clean-commit Amplify job and post-deployment read-only smoke verification. Offline evidence verification and a reachable historical URL are not substitutes for that production check.

## User traction

No user-traction evidence is registered, and no user count or engagement metric is claimed.

## F1 game-engine execution

### EV-20260720-001 — F1 baseline

- **Category:** Tests
- **Claim:** F1 began from the approved Step 0 revision with a clean working tree and green baseline.
- **Observation:** `main` was clean at commit `6d48abaaaa0d34c81e0e13716e3735247938dff0`; no remote was configured. `npm run lint`, `npm run test`, `npm run build`, `npm run verify:step0`, and `npm run scan:secrets` all exited 0. The baseline test suite contained 1 passing test; Step 0 verification passed 21/21 checks and secret scan passed 1/1.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-20T23:29:45.456Z`
- **Source revision:** `6d48abaaaa0d34c81e0e13716e3735247938dff0`, clean.
- **Environment:** Windows 10.0.26200; Node.js 24.13.0; npm 11.8.0; Vitest 4.1.10; Vite 8.1.5.
- **Procedure:** Commands listed above, executed from the repository root without watch mode.
- **Artifact path:** Verification is reproducible from the tracked source, lockfiles, and exact commands above; no private execution log is required.
- **SHA-256:** Not applicable to the transient console stream; reproducibility is provided by the source revision, lockfile, and exact commands.
- **Result:** PASS.
- **Verified by:** Automated command exit codes at the captured UTC time.
- **Redactions:** None.

### EV-20260720-002 — Checkpoint 1: types and invariants

- **Category:** Tests
- **Claim:** Milestone 1 implements and verifies the strict domain, coordinate, distribution, error/event, and invariant foundations.
- **Observation:** Focused and full engine suites passed 111/111 tests across 4 files. Coverage was 97.30% statements, 96.36% branches, 97.22% functions, and 97.22% lines. Lint, strict TypeScript production build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-20T23:47:25.579Z`
- **Source revision:** Working tree based on `6d48abaaaa0d34c81e0e13716e3735247938dff0` before the Checkpoint 1 commit.
- **Procedure:** Focused Vitest files; `npm run test:engine --workspace frontend`; coverage; lint; build; secret scan; diff check.
- **Artifact path:** `frontend/coverage/` is generated and ignored; source tests are under `frontend/src/engine/`.
- **SHA-256:** Not applicable to transient console output; the checkpoint commit and lockfile make the run reproducible.
- **Result:** PASS.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-003 — Checkpoint 2: deterministic generation

- **Category:** Tests
- **Claim:** Milestone 2 implements deterministic entropy adapters, seeded PRNG, and reproducible board generation.
- **Observation:** Focused Milestone 2 suites passed 30/30 tests, including 500 explicit fast-check runs. The cumulative engine suite passed 141/141 tests across 8 files. Coverage was 95.07% statements, 92.57% branches, 96.15% functions, and 95.10% lines. Lint, build, secret scan, and diff check passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T00:05:17.957Z`
- **Source revision:** Working tree based on Checkpoint 1 commit `c14bdf4`.
- **Procedure:** Focused entropy/PRNG/generation suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS.
- **Verified by:** Automated exit codes and V8 coverage.
- **Redactions:** None.

### EV-20260721-004 — Checkpoint 3: collapse and entanglement

- **Category:** Tests
- **Claim:** Milestone 3 implements atomic unpaired collapse and canonical correlated/anti-correlated pair resolution.
- **Observation:** Focused Milestone 3 suites passed 30/30 tests, including 600 explicit fast-check runs. The cumulative engine suite passed 171/171 tests across 12 files and 1,100 cumulative property runs. Coverage was 94.68% statements, 91.87% branches, 95.95% functions, and 94.84% lines; the final F1 line threshold remains pending until Milestone 9. Lint, build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T00:30:07.585Z`
- **Source revision:** Working tree based on Checkpoint 2 commit `624fa41`.
- **Procedure:** Focused collapse/entanglement unit and property suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS for Checkpoint 3; F1 coverage gate not yet evaluated.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-005 — Checkpoint 4: gates

- **Category:** Tests
- **Claim:** Milestone 4 implements the canonical X and H transforms plus stable, atomic gate-inventory consumption.
- **Observation:** Focused gate suites passed 26/26 tests, including 200 explicit fast-check runs. The cumulative engine suite passed 197/197 tests across 14 files and 1,300 cumulative property runs. Coverage was 94.87% statements, 91.90% branches, 96.52% functions, and 95.00% lines. Lint, build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T00:42:13.824Z`
- **Source revision:** Working tree based on Checkpoint 3 commit `ccdf0a7`.
- **Procedure:** Focused X/H gate unit and property suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-006 — Checkpoint 5: movement and resources

- **Category:** Tests
- **Claim:** Milestone 5 implements orthogonal movement, one-time resources, canonical VOID effects, and the authoritative direct-action/turn pipeline.
- **Observation:** Focused Milestone 5 suites passed 42/42 tests, including 400 explicit fast-check runs. The cumulative engine suite passed 239/239 tests across 19 files and 1,700 cumulative property runs. Coverage was 94.59% statements, 91.73% branches, 97.10% functions, and 94.69% lines; final F1 line closure remains assigned to Milestone 9. Lint, build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T01:05:28.787Z`
- **Source revision:** Working tree based on Checkpoint 4 commit `54d093b`.
- **Procedure:** Focused movement/resource/VOID/turn unit and property suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS for Checkpoint 5; final F1 coverage gate remains pending.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-007 — Checkpoint 6: decoherence

- **Category:** Tests
- **Claim:** Milestone 6 implements turn-scheduled row-major decoherence with unbiased selection and atomic entropy accounting.
- **Observation:** Focused decoherence/turn suites passed 42/42 tests, including 600 new explicit fast-check runs. The cumulative engine suite passed 266/266 tests across 21 files and 2,300 cumulative property runs. Coverage was 94.91% statements, 92.65% branches, 97.24% functions, and 95.02% lines. Lint, build, secret scan, and `git diff --check` passed. One parallel non-coverage suite process was externally interrupted (`^C`, exit 1); the same command was immediately rerun alone and passed 266/266, while the independent coverage run also passed all 266 tests.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T01:17:15.553Z`
- **Source revision:** Working tree based on Checkpoint 5 commit `56ede9e`.
- **Procedure:** Focused decoherence and integrated turn suites; complete engine suite rerun alone; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS; the interrupted duplicate run is disclosed and superseded by two complete passing runs.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-008 — Checkpoint 7: routes and endings

- **Category:** Tests
- **Claim:** Milestone 7 implements bounded current/structural/legal route analysis and ordered terminal evaluation integrated after decoherence.
- **Observation:** Focused route/ending/turn/invariant suites passed 108/108 tests, including 900 new explicit fast-check runs. The cumulative engine suite passed 302/302 tests across 25 files and 3,200 cumulative property runs. Coverage was 95.26% statements, 93.17% branches, 97.54% functions, and 95.36% lines. Lint, build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T01:48:12.396Z`
- **Source revision:** Working tree based on Checkpoint 6 commit `a92fa13`.
- **Procedure:** Focused routes/endings/turn/invariant suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-009 — Checkpoint 8: score and replay

- **Category:** Tests
- **Claim:** Milestone 8 implements exact scoring, canonical owned serialization, strict seed/universe replay, invalid-action atomicity, and persistent immutable histories.
- **Observation:** Focused Milestone 8 suites passed 52/52 tests; the integration-focused command including `turn.test.ts` passed 77/77. The cumulative engine suite passed 354/354 tests across 33 files, including 1,000 new and 4,200 cumulative explicit fast-check runs. Coverage was 91.56% statements, 87.53% branches, 98.02% functions, and 91.54% lines; the newly added strict parsers exposed measured branch gaps assigned to Milestone 9, so the final F1 coverage gate is not yet claimed. Independent review found and fixed one strict-replay defect: an unused out-of-range transcript word had been reported as unused entropy instead of `ENTROPY_RANGE`; semantic transcript coordinates, scheduled turns, and candidate counts were also hardened. Lint, build, secret scan, and `git diff --check` passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T02:33:03.730Z`
- **Source revision:** Working tree based on Checkpoint 7 commit `eea26a1`.
- **Procedure:** Focused score/serialization/replay/invalid-action/immutability/turn suites; complete engine suite; V8 coverage; lint; build; secret scan; diff check.
- **Artifact path:** Engine source/tests and ignored `frontend/coverage/` output.
- **SHA-256:** Not applicable to transient console output; commit, tests, explicit property seeds, and lockfile provide reproduction.
- **Result:** PASS for Checkpoint 8; final F1 coverage thresholds remain pending for Milestone 9.
- **Verified by:** Automated exit codes and V8 coverage at the captured UTC time.
- **Redactions:** None.

### EV-20260721-010 — Checkpoint 9: complete deterministic engine suite

- **Category:** Tests
- **Claim:** Milestone 9 completes the supported public API, behavior-driven coverage closure, pure-engine boundary audit, and real F1 coverage verifier.
- **Observation:** The focused serialization/replay closure suites passed 32/32 tests and the public API suite passed 1/1. The cumulative engine suite passed 363/363 tests across 34 files, with 4,200 cumulative explicit fast-check runs. V8 coverage over `src/engine/**/*.ts`, excluding only test files and the type-only `types.ts`/`errors.ts` modules, was 96.17% statements, 94.51% branches, 98.02% functions, and 96.24% lines (1,333/1,385). `verify:f1` read `frontend/coverage/coverage-summary.json` and passed 5/5 checks, including 95% line and 90% branch thresholds, relative-only imports, forbidden-dependency scan, and cycle detection. Lint, strict build, non-coverage suite, secret scan, `git diff --check`, and adapted Step 0 verification passed; Step 0 reported 39/39 completed spec items, 9/9 checkpoints, and 21/21 checks. A preliminary build failed because the new API test widened an export-name tuple to `string`; it was corrected with a const tuple and the full build passed. A preliminary `verify:f1` invocation before generating coverage correctly failed on the missing summary; after the coverage command produced the real JSON report, it passed.
- **Source kind:** Derived summary of transient console observations; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T03:09:53.140Z`
- **Source revision:** Working tree based on Checkpoint 8 commit `2a2895f397ba9a5737bdb3b8bc3ad06ae48d7419` before the Checkpoint 9 commit.
- **Environment:** Windows 10.0.26200; Node.js 24.13.0; npm 11.8.0; Vitest 4.1.10; Vite 8.1.5; TypeScript 5.9.3; fast-check 4.9.0.
- **Procedure:** Focused serialization/replay and API suites; `npm run test:engine --workspace frontend`; `npm run test:engine --workspace frontend -- --coverage`; `npm run lint`; `npm run build`; `npm run verify:f1`; `npm run verify:step0`; `npm run scan:secrets`; `git diff --check`.
- **Artifact path:** `frontend/coverage/coverage-summary.json` is generated and ignored; engine source/tests, `scripts/verify-f1.mjs`, and this evidence remain versioned.
- **SHA-256:** Not applicable to transient console output; the real generated coverage summary is reproducible from the checkpoint commit, lockfile, and exact command and is not retained as a source artifact.
- **Result:** PASS.
- **Verified by:** Automated exit codes, Vitest/V8 report, F1 verifier output, and Step 0 verifier output at the captured UTC time.
- **Redactions:** None.

### EV-20260721-011 — Final clean F1 validation and semantic review

- **Category:** Tests
- **Claim:** The completed F1 engine, verification gates, scope boundary, checkpoint history, and closure documentation pass from a locked clean dependency installation.
- **Observation:** `npm ci` installed 271 packages from the committed lockfile, audited 273 packages, and reported 0 vulnerabilities. The clean engine suite passed 363/363 tests across 34 files; the repository `check` suite passed 364/364 tests across 35 files. A freshly generated V8 report measured 96.17% statements, 94.51% branches, 98.02% functions, and 96.24% lines (1,333/1,385), with exactly 20 expected production modules. `verify:f1` removed prior coverage output, regenerated the report, and passed 7/7 checks; Step 0 passed 21/21 with 39/39 spec items and 9/9 checkpoints; lint, strict TypeScript/build, production build, secret scan, and `git diff --check` passed. Independent semantic review found no functional or blocking defect. Its two initial findings—stale coverage acceptance and raw classification of unretained console streams—were corrected; follow-up review confirmed both resolved with no behavioral regression. No graphical capture was made; all eight requested F1 Kiro captures remain explicitly future and unchecked.
- **Source kind:** Derived summary of transient console observations and semantic-review output; the raw console stream was not retained.
- **Real/simulated status:** `NOT_APPLICABLE`
- **Captured at:** `2026-07-21T04:08:06.622Z`
- **Source revision:** Working tree based on Checkpoint 9 commit `51fa5fad9165fb72bd1cf2123ed6e38f7ec7ac55`, containing only the documented closure/gate-remediation changes before their local commit.
- **Environment:** Windows 10.0.26200; Node.js 24.13.0; npm 11.8.0; Vitest 4.1.10; Vite 8.1.5; TypeScript 5.9.3; fast-check 4.9.0.
- **Procedure:** `npm ci`; `npm run lint`; `npm run build`; `npm run test:engine --workspace frontend`; `npm run test:engine --workspace frontend -- --coverage`; `npm run build`; `npm run verify:f1`; `npm run verify:step0`; `npm run scan:secrets`; `npm run check`; `git diff --check`; Git status/remotes audit; two-pass semantic review.
- **Artifact path:** `frontend/coverage/coverage-summary.json` was regenerated from current source and remains ignored/non-versioned; `package-lock.json`, source, tests, verifiers, checkpoint hashes, and this derived register are versioned.
- **SHA-256:** Generated `frontend/coverage/coverage-summary.json` bytes: `d217f8e999e7c95012f5d7d488605bf9e88f49e13db4addb48dae42be03a31c2` (artifact not retained in Git). Committed `package-lock.json` bytes: `be1dcb41b0baf34a9368ab788b9df50f9590c25a298582996777e6640a6c5dce`.
- **Raw parents:** None retained; this limitation prevents the console summaries from being treated as raw evidence and is explicitly disclosed.
- **Result:** PASS; all prior semantic-review findings resolved.
- **Verified by:** Automated command exit codes, the freshly generated Vitest/V8 JSON report, F1/Step 0 verifier output, immutable Git history, and independent semantic-review follow-up at the captured UTC time.
- **Redactions:** None.

## F2A local quantum core

### EV-20260720-012 — Versioned simulated quantum evidence packages

- **Category:** Quantum jobs and CHSH
- **Claim:** F2A produced local, reproducible, hash-linked simulation artifacts for independent-qubit entropy extraction, one-basis Bell correlation, and a separate four-setting CHSH calculation. These artifacts are not hardware evidence and do not certify a physical device.
- **Observation:** Aer 0.17.2 with Qiskit 2.5.0 wrote two packages with the declared UTC timestamp `2026-07-20T12:00:00Z`. `f2a-simulated-001` records 128 independent four-qubit measurements and 128 Bell measurements; its Bell counts are 68 `00`, 0 `01`, 0 `10`, and 60 `11`, with `ONE_BASIS_CORRELATION_ONLY` and observed correlation 1.0. `f2a-chsh-simulated-001` records a distinct Bell-state estimator calculation with `E00=E01=E10=0.7071067811865476`, `E11=-0.7071067811865476`, witness `2.8284271247461903`, and `SIMULATED_CHSH_WITNESS`. The IBM `real-dry-run` output declared `submits_jobs: false`; no IBM service, credentials, backend selection, job, QPU, AWS resource, or network call was used.
- **Source kind:** Raw and derived JSON artifacts, plus canonical JSON manifests and file-hash maps.
- **Real/simulated status:** `SIMULATED`
- **Captured at:** `2026-07-20T12:00:00Z` (explicit provenance timestamp supplied to both simulation commands).
- **Source revision:** Working tree based on F1 commit `c1f5d47d319dae3011381a4d42aba6c8ad2a4a9e`, before the single F2A commit.
- **Environment:** Windows; CPython 3.12.13 through uv; Qiskit 2.5.0; qiskit-aer 0.17.2; qiskit-ibm-runtime 0.48.0.
- **Procedure:** `uv run python -m colapso_quantum.cli simulate --seed 42 --shots 128 --run-id f2a-simulated-001 --timestamp 2026-07-20T12:00:00Z`; `uv run python -m colapso_quantum.cli chsh-simulate --seed 42 --run-id f2a-chsh-simulated-001 --timestamp 2026-07-20T12:00:00Z`; `uv run python -m colapso_quantum.cli real-dry-run`.
- **Artifact path:** `evidence/runs/simulated/f2a-simulated-001/` and `evidence/runs/simulated/f2a-chsh-simulated-001/`.
- **SHA-256:** Canonical manifest digests are `189f5d6d2361dc66cefeef9cb038f6ac6d2a8407d3c1ba1813686e90acce5673` and `41545197350f8c222e3d59f66c271cf5e44b6094d92d450d720d736a5f19d6ab`. Each package's `hashes.json` contains exact byte hashes for all raw, derived, and manifest JSON files.
- **Raw parents:** The first manifest links `raw-entropy.json` (`a869863f6d4ed4657aad48d7367bc26022f010453c9b6726c8eeaa499754db00`) and `raw-bell.json` (`54ffb3b2ba74d7fdad8d878f5117d9a5378dcdeeee9e191345160379c6973de8`); the CHSH manifest links `raw-chsh.json` (`62e8f8a95b8bb90bf2443bf3eab1c57f2af7142098d985336a774ba273a88a54`).
- **Result:** PASS for local simulated artifact generation only. A one-basis correlation is retained as correlation, not a Bell-violation claim; the ideal CHSH value is visibly simulated, not hardware certification.
- **Verified by:** `validate_evidence_package` model/hash validation and the offline `verify:f2a` gate consume the stored artifact bytes; neither invokes a provider.
- **Redactions:** None; the artifacts contain no credentials or personal identifiers.

## F2B controlled IBM Quantum evidence

### EV-20260722-013 — First preserved real IBM Runtime V2 package

- **Category:** Quantum jobs and CHSH
- **Claim:** The F2B Evidence Pack preserves two completed real-hardware IBM Runtime V2 results without implying public Job-ID access, certified randomness, a loophole-free result, or a Bell claim from one-basis counts.
- **Observation:** `real-20260721t205417z` contains one `SamplerV2` job (`d9ftp02neu4c739q2u7g`) and one `EstimatorV2` job (`d9ftp0kinv1c73arre9g`), both `DONE` on `ibm_fez`. Official `RuntimeEncoder` exports, derived entropy/Bell/CHSH records, provenance, manifest, and exact `SHA256SUMS` are present. The estimator CHSH witness is `2.698628939348193` with propagated standard error `0.12161062756743832`; its classification is `STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT` with the recorded uncertainty limitation.
- **Source kind:** Raw RuntimeEncoder JSON plus linked derived JSON artifacts.
- **Real/simulated status:** `REAL`
- **Captured at:** `2026-07-22T15:03:39.867076Z` (persisted evidence completion time).
- **Source revision:** `69a9e38`, clean before F3 work.
- **Procedure:** The bounded F2B retrieval persisted raw objects before parsing; its offline verifier validates artifact bytes without provider access.
- **Artifact path:** `evidence/runs/real/real-20260721t205417z/`.
- **SHA-256:** `SHA256SUMS` covers exactly every JSON artifact; RuntimeEncoder raw digests are `d5ae7eb3e4aa784b4669dcf5387279982365d9b0a671cf424084a477324845b9` (sampler) and `37c2b070651bef4d1663866e7dce132ac0efa1687c010e07d2554f9ce60266af` (estimator).
- **Result:** Complete real evidence package. A Job ID remains provenance metadata and is not claimed as anonymously public.
- **Verified by:** `npm run verify:f2b` consumes local artifact bytes only.
- **Redactions:** None.

## F3 Daily Universe compiler

### EV-20260722-014 — First deterministic universe from preserved real evidence

- **Category:** Gameplay and Quantum jobs
- **Claim:** `colapso-2026-07-22-001` is a deterministic F1 universe derived solely from the 1,024 accepted entropy bits in the locked F2B package, with Bell/CHSH values retained as provenance rather than gameplay entropy.
- **Observation:** The local compiler produced a 7×7, nonterminal initial state with 10 observations, five disjoint pairs, traversable endpoints, and a public-F1 legal potential route at deterministic `attemptIndex: 0`. The canonical payload commitment is `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579`.
- **Source kind:** Derived canonical JSON from immutable F2B artifacts.
- **Real/simulated status:** `REAL` source provenance; no new hardware execution occurred.
- **Generated at:** `2026-07-22T15:03:39.867076Z`, deliberately derived from persisted F2B provenance rather than the build clock.
- **Source revision:** Working tree based on `69a9e38` before the single F3 commit.
- **Procedure:** `npm run universe:build -- --date 2026-07-22 --run-id real-20260721t205417z`.
- **Artifact path:** `frontend/public/data/universes/2026-07-22.json` and `frontend/public/data/universes/index.json`.
- **SHA-256:** The listed commitment is SHA-256 over sorted-key UTF-8 canonical universe JSON excluding only the `commitment` field; source hashes are embedded in `evidenceHashes`.
- **Raw parents:** `entropy-derived.json` and its linked sampler RuntimeEncoder export; `bell-derived.json`, `chsh-derived.json`, manifest, provenance, and both official raw exports remain linked as provenance.
- **Result:** The expansion is deterministic SHA-256 counter mode and does not create or certify additional physical entropy. The client can inspect published state/plan; no anti-cheat claim is made and a future leaderboard must validate replays server-side.
- **Verified by:** `npm run universe:verify` reads the artifact without regenerating it; `npm run verify:f3` performs byte-identical offline regeneration.
- **Redactions:** None.


## F4A local playable daily universe

### EV-20260722-015 — F4A static daily-play integration

- **Category:** Gameplay and Tests
- **Claim:** The F3 `colapso-2026-07-22-001` artifact can be played locally in Spanish through React/Zustand while F1 remains the sole authority for state transitions and scoring.
- **Observation:** F4A statically imports a reproducibly synchronized byte-identical copy of the published universe, deserializes its initial state through F1, and routes Observe, Move, X, and H to public `processAction` with F3's public counter-mode resolution source. The interface exposes the board, HUD, accessibility labels, help, terminal result/restart, and auditable real-hardware provenance. It contains no runtime network client or ambient randomness.
- **Source kind:** Derived local UI, test, and verifier evidence; no new quantum measurement occurred.
- **Real/simulated status:** `REAL` source provenance only; the browser feature performs no provider access.
- **Procedure:** `npm run universe:sync-f4a`; targeted `npm run test --workspace frontend -- App.test.tsx`; `npm run verify:f4a`; final repository commands listed in the delivery report.
- **Artifact path:** `frontend/src/daily-game/`, `frontend/src/store/daily-game-store.ts`, `frontend/src/components/DailyGame.tsx`, `scripts/sync-f4a-universe.mjs`, and `scripts/verify-f4a.mjs`.
- **SHA-256:** F4A verifies byte equality rather than introducing a duplicate digest; the source copy must exactly equal `frontend/public/data/universes/2026-07-22.json`, whose F3 commitment is `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579`.
- **Raw parents:** The immutable F3 public universe artifact and its preserved F2B evidence links.
- **Result:** Local-only user interface; no anti-cheat, physical-entanglement, quantum-advantage, leaderboard, authentication, backend, or network claim is made.
- **Verified by:** Focused RTL/Vitest and the offline `verify:f4a` gate; final quality-gate outputs remain reproducible from the delivery commit.
- **Redactions:** None.

## Five-universe campaign

### EV-20260728-016 — Offline finalization of five preserved hardware universes

- **Category:** Quantum jobs, Gameplay, and Tests
- **Claim:** The repository's finalized campaign contains five playable deterministic universes derived from five separately submitted and preserved IBM Quantum SamplerV2 executions; Universe #001 supplies the direct EstimatorV2/CHSH record shared explicitly by #002–#005.
- **Observation:** Strict backend finalization verified five distinct Sampler Job IDs, four distinct new runtime-raw results, five preserved results, and a byte-identical Universe #001 baseline before writing `evidence/campaign-index.json`. Strict frontend finalization wrote five dated artifacts, `campaign.json`, `index.json`, and the bundled compatibility copy. All entries are `published`, `verified`, and playable. Focused campaign tests passed 23/23; the repaired App/playtest regression run passed 42/42.
- **Source kind:** Preserved raw/derived provider exports plus derived canonical campaign and universe artifacts.
- **Real/simulated status:** `REAL` source provenance; finalization itself was offline and created no measurement.
- **Captured at:** `2026-07-28T00:22:32.963685Z` is the latest preserved hardware completion and campaign-index completion value. The later offline command's wall-clock time was not stored as a separate evidence artifact.
- **Source revision:** Working tree based on `e099ee226046ebee44d532c2da29511f80a5f509`; final release changes remained uncommitted during verification.
- **Environment:** Windows; CPython 3.12 through uv; Node.js/npm and pinned frontend dependencies from the repository lockfiles. No IBM or AWS credential was used by finalization.
- **Procedure:** `uv run --frozen --directory backend python scripts/acquire_campaign_quantum_evidence.py --finalize-offline`; `npx --no-install jiti frontend/src/daily-universe/cli.ts campaign-finalize`; strict backend/frontend verification commands; focused Vitest campaign and App/playtest suites.
- **Artifact path:** `evidence/campaign-index.json`, `evidence/campaign-index.sha256`, `evidence/universe-002/` through `evidence/universe-005/`, `frontend/public/data/universes/2026-07-22.json` through `2026-07-26.json`, `frontend/public/data/universes/campaign.json`, and `frontend/src/daily-game/published-campaign.json`.
- **SHA-256:** Campaign index `bc3cb080daed5c29eaed6caf14cc7fb9ee7a6b2ed6091038e1c67c141755577d`. Published commitments: #001 `bcff83aade29774587a84df10a9e168f5828e705728981d4eb8caf4075875579`; #002 `bd5f8c97b66339df9f453c4a527bf6e68654c0472be133170aaf0c30b304cb27`; #003 `be311b3567602eaa3bfd4da7881d5830b9ffc07bad97452e52b3c340d408eebe`; #004 `f8bcf4ff0154c8b4091f01236509046004223ae4ca46e43a7f0836276a5780ae`; #005 `c4cfc1afeb0da6b7223fa1a994bf240883a465d18c9a3acf48234696badf2a56`.
- **Raw parents:** Universe #001 uses `evidence/runs/real/real-20260721t205417z/`; #002–#005 use their numbered evidence directories and each links its direct SamplerV2 export to accepted entropy and a manifest. Their CHSH field links to #001 Estimator Job `d9ftp0kinv1c73arre9g`, not a direct estimator execution for those entries.
- **Result:** PASS for offline finalization and focused integration verification. Separate Job IDs are not presented as proof of statistical independence. No IBM access, job submission, AWS action, deployment, commit, push, or remote screenshot capture occurred.
- **Verified by:** Fail-closed backend and frontend campaign verifiers, canonical artifact checks, #001 byte pin/sync checks, and focused automated tests.
- **Redactions:** None; credentials and private provider values are rejected by the evidence workflow.