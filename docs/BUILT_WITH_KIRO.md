# Built with Kiro

COLAPSO was developed with Kiro as an agentic, VS Code-based engineering environment. Kiro supported the work; it did not replace developer judgment or accountability.

![COLAPSO engineering workflow with Kiro](media/kiro-engineering-workflow.svg)

> The diagram is original COLAPSO project artwork. It does not use or represent an official Kiro logo.

## How Kiro contributed

Kiro helped maintain continuity across a deliberately staged engineering process:

1. **Requirements and boundaries** — turn product goals, scientific guardrails, security constraints, and explicit non-goals into reviewable acceptance criteria.
2. **Architecture** — separate evidence acquisition, deterministic universe compilation, the pure F1 engine, presentation state, and static deployment.
3. **Implementation** — make scoped changes while preserving typed contracts and immutable behavior outside the active stage.
4. **Verification** — run tests, property checks, builds, evidence audits, privacy scans, packaging checks, and live production smoke tests; correct failures before continuing.
5. **Evidence and documentation** — compare public claims against preserved artifacts and keep measurements distinct from interpretation.
6. **Deployment and release** — automate AWS Amplify packaging and verification, capture real production screenshots, sanitize public history, and gate publication on CI.

## Human control

The developer remained responsible for:

- choosing product behavior and game balance;
- approving scientific language and limitations;
- authorizing IBM Quantum and AWS access;
- deciding when infrastructure actions were permitted;
- reviewing source changes and generated artifacts;
- controlling Git commits, GitHub publication, and release creation.

Credentials were never delegated into public artifacts. Provider and cloud operations were explicit, bounded actions rather than background automation.

## Working method

### Specify before changing behavior

Complex stages began with requirements, architecture, and task decomposition. Implementation was checked against those constraints rather than inferred from visual output alone.

### Prefer executable evidence

A claim was considered ready only when supported by an artifact or check: deterministic tests, serialized evidence, SHA-256 integrity records, a production response, a rendered screenshot, or a repository verifier.

### Diagnose before retrying

When a check failed, the workflow isolated the failing contract and repeated only the affected validation until the full gate was due. Examples included Windows ZIP path normalization and choosing a persistent decoherence alert rather than fabricating a transient screenshot state.

### Protect immutable boundaries

Later presentation and publication work did not modify F1 rules, the published quantum evidence, game balance, or deployment infrastructure. Public release work changed documentation, media, verification, and repository packaging only.

## Public artifact policy

The public repository includes the materials needed to understand, run, test, audit, and contribute to COLAPSO. It does not publish raw agent conversations, private taskboards, local environment notes, credentials, workstation paths, or internal execution logs.

That distinction is intentional:

- **Public:** source, tests, evidence packs, architecture, claim boundaries, deployment tooling, screenshots, and reproducible verifiers.
- **Not public:** private planning history, raw prompts/conversations, local state, operator credentials, generated deployment packages, and machine-specific files.

The public Git history is a fresh, one-commit mirror so deleted private artifacts, author metadata, and internal iteration history cannot leak through Git objects.

## What “built with Kiro” does not mean

- Kiro is not a runtime dependency.
- No Kiro service is called by the game.
- The production application does not transmit player data to Kiro.
- Kiro did not generate or certify the IBM Quantum measurements.
- The project does not claim that agent assistance guarantees correctness.
- The original workflow diagram is not official Kiro brand material.

Correctness comes from inspectable design, tests, evidence, human review, and explicit release gates.
