# COLAPSO quantum evidence tooling

This Python 3.12 package creates, retrieves, parses, derives, and verifies quantum evidence for COLAPSO. It is an offline/operator toolchain, not the production game's runtime backend.

The deployed browser application does not import this package, call IBM Quantum, expose a token, or require a server.

## Capabilities

- deterministic Aer-based simulated entropy and correlation evidence;
- simulated multi-basis CHSH evidence;
- credential-free IBM Runtime dry-run planning;
- explicit IBM Runtime preflight for an eligible configured instance;
- separate SamplerV2 and EstimatorV2 submission paths;
- retrieval and canonical preservation of runtime results;
- entropy, one-basis correlation, and CHSH derivation;
- canonical JSON, manifests, provenance, and SHA-256 integrity records;
- provider abstraction and typed Pydantic contracts.

Real and simulated evidence are always stored under different paths and labeled by mode.

## Requirements

- Python `>=3.12,<3.13`
- [uv](https://docs.astral.sh/uv/) for the pinned development environment
- IBM Quantum access only for the optional real-provider commands

## Install and test

```bash
cd backend
uv sync --frozen
uv run ruff check .
uv run pytest
```

Pytest enforces at least 90% branch-aware coverage for `colapso_quantum`.

## Simulated evidence

Create deterministic local packages without credentials or network access:

```bash
uv run python -m colapso_quantum.cli simulate --seed 7 --shots 256
uv run python -m colapso_quantum.cli chsh-simulate --seed 7 --shots 256
```

Optional arguments include `--run-id`, `--evidence-root`, and an offset-aware ISO 8601 `--timestamp`. Simulation artifacts must never be relabeled as real.

## Real-provider workflow

Live execution can consume paid or limited provider capacity. Review the code, account plan, backend choice, shot count, and evidence destination before submitting.

### Credentials

The CLI reads two process environment variables only at runtime:

- `QISKIT_IBM_TOKEN`
- `QISKIT_IBM_INSTANCE`

They are passed to Qiskit Runtime and are never printed or written to an evidence pack. Do not put values in source, command history, issue reports, screenshots, `.env` files committed to Git, or CI.

### Plan without credentials

```bash
uv run python -m colapso_quantum.cli real-dry-run --entropy-qubits 4
```

This prints a canonical execution plan and performs no provider call.

### Preflight

```bash
uv run python -m colapso_quantum.cli real-preflight
```

Preflight validates the configured account/instance and required open-plan constraints. It does not submit a workload.

### Submit

```bash
uv run python -m colapso_quantum.cli real-submit --shots 256 --entropy-qubits 4
```

Submission creates independent SamplerV2 and EstimatorV2 jobs and records their references. Shot count is restricted to 256–512. Use `--run-id` only when a stable operator-selected ID is required.

### Retrieve

```bash
uv run python -m colapso_quantum.cli real-retrieve --run-id <run-id>
```

Retrieval resolves the persisted provider jobs, preserves raw structures before derivation, computes the evidence records, and finalizes manifest/checksum state. Provider authorization is required.

## Evidence layout

The default evidence root is the repository `evidence/` directory:

```text
evidence/
  runs/
    simulated/
      <run-id>/
    real/
      <run-id>/
```

The current public real run is documented in [`docs/QUANTUM_PROVENANCE.md`](../docs/QUANTUM_PROVENANCE.md).

## Serverless placeholders

`backend/functions/` contains reserved directories only. There is no deployed Lambda handler, API Gateway integration, scheduled pool refiller, SAM template, database, or secret manager dependency in the current release.

## Scientific boundaries

The package preserves measurement and uncertainty data; it does not certify device-independent randomness, a loophole-free Bell test, conclusive entanglement from one basis, or quantum advantage. See [`docs/CLAIMS.md`](../docs/CLAIMS.md).
