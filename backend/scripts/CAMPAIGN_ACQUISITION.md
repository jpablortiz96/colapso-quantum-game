# Campaign quantum evidence acquisition

This workflow is for a human operator running the repository's pinned Windows environment. It acquires one distinct IBM SamplerV2 hardware job at a time for Universes #2 through #5. It never creates an Estimator job, combines universes into one job, or starts board generation.

## Security boundary

Run these commands only in an approved operator terminal, never from CI, application startup, tests, or normal build commands. The wrapper calculates the credential-store location internally from `[Environment]::GetFolderPath("UserProfile")` and `.qiskit\qiskit-ibm.json`. It accepts no credential path or token parameter, does not set credential environment variables, and never reads or prints the credential file. The Python runner checks only that the file exists and is readable before passing its filename directly to `QiskitRuntimeService(name="colapso", filename=credentials_file)`.

Console output is sanitized. Job IDs are shortened in console events; complete Job IDs are retained only in the scientific evidence and local acquisition state. Do not redirect output to a repository file. Credential files and operator-log directories are ignored by Git.

## Prerequisites

- Use Windows PowerShell from the `backend` directory.
- Keep the pinned environment at `.venv\Scripts\python.exe` intact.
- Ensure the saved `colapso` account exists in the standard user-profile Qiskit credential store.
- Confirm that no other operator is running this campaign.
- Do not edit `evidence\campaign-acquisition-state.json` or a universe evidence directory manually.

State-changing and polling actions hold `evidence\.campaign-acquisition.lock` for their full process lifetime. A concurrent operator is rejected before preflight or submission. A process crash intentionally leaves the lock in place; remove a stale lock only after independently confirming that no campaign process is still running.

## Exact operator commands

Run a sanitized, non-submitting preflight:

```powershell
.\scripts\run_campaign_acquisition.ps1 -PreflightOnly
```

Submit only the next eligible universe:

```powershell
.\scripts\run_campaign_acquisition.ps1 -Submit
```

Resume the currently recorded job and preserve its result, or explicitly authorize its single retry after a terminal failure:

```powershell
.\scripts\run_campaign_acquisition.ps1 -Resume
```

A non-submitting, single status pass is also available:

```powershell
.\scripts\run_campaign_acquisition.ps1 -PollOnly
```

## Sequential acquisition procedure

1. Run `-PreflightOnly`. Continue only when the sanitized report confirms the Open plan, available allowance, real operational `ibm_fez`, and sufficient post-estimate reserve.
2. Run `-Submit`. At the prompt, type `SUBMIT ONE HARDWARE JOB` exactly. This submits only the next eligible universe and durably records its returned Job ID before the command exits.
3. Do not run `-Submit` again while that Job ID is queued, initializing, running, terminal-but-unpreserved, or otherwise unresolved.
4. Run `-Resume`. At the prompt, type `RESUME OR RETRY ONE HARDWARE JOB` exactly. A nonterminal existing job is retrieved by its recorded Job ID and waited on; no replacement is submitted. If the recorded attempt has already reached `FAILED`, `CANCELLED`, or `ERROR`, this confirmation permits exactly one distinct retry.
5. If the resume wait window expires, run `-Resume` again. If a retry was submitted, run `-Resume` again later to preserve that retry's result.
6. Wait for the `EVIDENCE_PRESERVED` event before returning to step 1 for the next universe.
7. Repeat until Universes #2, #3, #4, and #5 each have one independently preserved evidence chain.

The runner refuses a second retry, refuses replacement of queued or running jobs, and blocks when a submission intent has an ambiguous remote outcome. Resolve ambiguous state by reconciling the recorded provider job outside this automation; never submit a guessed replacement.

## State and offline verification

Sanitized resumable state is stored at repository-root `evidence\campaign-acquisition-state.json`. Per-universe evidence is stored at repository-root `evidence\universe-002` through `evidence\universe-005`. Universe #1 remains pinned at `evidence\runs\real\real-20260721t205417z` and is hash-checked before every submit, resume, and poll action. The non-mutating preflight does not inspect evidence files.

After all four new evidence chains are preserved, run the credential-free verifier from the repository root:

```powershell
npm run verify:campaign-evidence
```

This verification mode does not construct an IBM Runtime service. It checks distinct Job IDs and raw results, artifact hashes and commitments, the acquisition-only commitment scope, no board generation, and byte identity of Universe #1.
