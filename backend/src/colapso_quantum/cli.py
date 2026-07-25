"""Local F2A simulation CLI plus the bounded, auditable F2B real-run commands."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from datetime import datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from .evidence import canonical_json_bytes, utc_now
from .providers.ibm_runtime import (
    IbmRuntimeProvider,
    OpenPlanPreflightError,
)
from .real_evidence import RealEvidenceStore
from .runtime_v2 import (
    RuntimeV2FormatError,
    inventory_result,
    parse_estimator_v2,
    parse_sampler_v2,
)
from .service import LocalQuantumService


def _repository_evidence_root() -> Path:
    return Path(__file__).resolve().parents[3] / "evidence"


def _parse_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("timestamp must be ISO 8601 UTC with an offset")
    return parsed


def _run_id(prefix: str, timestamp: datetime, supplied: str | None) -> str:
    return supplied or f"{prefix}-{timestamp.strftime('%Y%m%dt%H%M%Sz').lower()}"


def _runtime_provider() -> IbmRuntimeProvider:
    """Pass environment credentials only to Runtime; this function never prints or persists them."""
    return IbmRuntimeProvider(
        token=os.environ.get("QISKIT_IBM_TOKEN"),
        instance=os.environ.get("QISKIT_IBM_INSTANCE"),
    )


def _print_real_package(store: RealEvidenceStore) -> None:
    package = store.package()
    print(
        canonical_json_bytes(
            {
                "mode": "REAL",
                "state": package.manifest["state"],
                "path": str(package.path),
                "job_count": len(package.manifest["jobs"]),
            }
        ).decode("utf-8")
    )


def _record_submission(
    store: RealEvidenceStore,
    submission: Any,
    *,
    at_utc: datetime,
) -> None:
    store.record_job(
        role=submission.role,
        job_id=submission.job_id,
        backend=submission.backend,
        backend_version=submission.backend_version,
        primitive=submission.primitive,
        submission_metadata=submission.metadata,
        submitted_at_utc=at_utc,
    )


def _submit_real(args: argparse.Namespace) -> int:
    provider = _runtime_provider()
    try:
        execution = provider.prepare_real_execution(required_qubits=args.entropy_qubits)
    except OpenPlanPreflightError as error:
        print(error.status.value)
        return 3
    except Exception:
        print("REAL_EXECUTION_UNAVAILABLE")
        return 2

    timestamp = utc_now()
    run_id = _run_id("real", timestamp, args.run_id)
    store = RealEvidenceStore.create_prepared(
        evidence_root=args.evidence_root,
        run_id=run_id,
        created_at_utc=timestamp,
        preflight=execution.preflight.as_evidence(),
        submission_configuration={
            "channel": provider.channel,
            "region": execution.preflight.region,
            "backend": execution.backend_name,
            "backend_version": execution.backend_version,
            "entropy_qubits": args.entropy_qubits,
            "shots": args.shots,
            "transpiler_seed": args.transpiler_seed,
            "sampler_workloads_grouped": ["ENTROPY_HARVEST", "BELL_CORRELATION"],
            "chsh_workload": "CHSH_EVIDENCE",
            "no_session_mode": True,
        },
    )
    try:
        sampler = provider.submit_sampler_job(
            execution,
            entropy_qubits=args.entropy_qubits,
            shots=args.shots,
            transpiler_seed=args.transpiler_seed,
        )
        _record_submission(store, sampler, at_utc=utc_now())
    except Exception:
        store.record_submission_failure(
            role="SAMPLER_ENTROPY_BELL",
            error_code="SAMPLER_SUBMISSION_FAILED",
            occurred_at_utc=utc_now(),
        )
        _print_real_package(store)
        return 2

    try:
        estimator = provider.submit_chsh_job(
            execution,
            shots=args.shots,
            transpiler_seed=args.transpiler_seed,
        )
        _record_submission(store, estimator, at_utc=utc_now())
    except Exception:
        store.record_submission_failure(
            role="ESTIMATOR_CHSH",
            error_code="ESTIMATOR_SUBMISSION_FAILED",
            occurred_at_utc=utc_now(),
        )
        _print_real_package(store)
        return 2

    _print_real_package(store)
    return 0


def _retrieve_manifest(store: RealEvidenceStore, run_id: str) -> list[dict[str, Any]]:
    """Allow retrieval only for the exact bounded real run already persisted locally."""
    manifest = store.manifest()
    jobs = manifest.get("jobs")
    if (
        manifest.get("mode") != "REAL"
        or manifest.get("run_id") != run_id
        or not isinstance(jobs, list)
        or len(jobs) != 2
    ):
        raise ValueError("retrieval target is not the persisted two-job real run")
    if {job.get("role") for job in jobs if isinstance(job, dict)} != {
        "SAMPLER_ENTROPY_BELL",
        "ESTIMATOR_CHSH",
    }:
        raise ValueError("retrieval target has invalid job roles")
    backends = {job.get("backend") for job in jobs if isinstance(job, dict)}
    if len(backends) != 1 or not isinstance(next(iter(backends)), str):
        raise ValueError("retrieval target does not use one persisted backend")
    return jobs


def _submission_document(store: RealEvidenceStore) -> dict[str, Any]:
    try:
        document = json.loads((store.path / "submission.json").read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("retrieval submission metadata is unreadable") from error
    if not isinstance(document, dict):
        raise ValueError("retrieval submission metadata is invalid")
    return document


def _sampler_mapping(job: Mapping[str, Any], submission: Mapping[str, Any]) -> tuple[list[str], list[str]]:
    metadata = job.get("submission_metadata")
    configuration = submission.get("configuration")
    if not isinstance(metadata, Mapping) or not isinstance(configuration, Mapping):
        raise RuntimeV2FormatError("Sampler circuit mapping metadata is absent")
    circuits = metadata.get("circuits")
    workloads = configuration.get("sampler_workloads_grouped")
    if not isinstance(circuits, list) or not isinstance(workloads, list) or len(circuits) != len(workloads):
        raise RuntimeV2FormatError("Sampler circuit order is not explicitly persisted")
    labels = [item.get("name") for item in circuits if isinstance(item, Mapping)]
    if len(labels) != len(circuits) or any(not isinstance(label, str) or not label for label in labels):
        raise RuntimeV2FormatError("Sampler circuit identifiers are invalid")
    if any(not isinstance(workload, str) or not workload for workload in workloads):
        raise RuntimeV2FormatError("Sampler workload order is invalid")
    return labels, list(workloads)


def _estimator_mapping(job: Mapping[str, Any]) -> tuple[list[str], str]:
    metadata = job.get("submission_metadata")
    if not isinstance(metadata, Mapping):
        raise RuntimeV2FormatError("CHSH observable mapping metadata is absent")
    labels = metadata.get("observable_identifiers")
    convention = metadata.get("sign_convention")
    if not isinstance(labels, list) or any(not isinstance(label, str) for label in labels):
        raise RuntimeV2FormatError("CHSH observable order is not explicitly persisted")
    if not isinstance(convention, str) or not convention:
        raise RuntimeV2FormatError("CHSH sign convention is not explicitly persisted")
    return list(labels), convention


def _runtime_versions() -> dict[str, str | None]:
    versions: dict[str, str | None] = {}
    for distribution in ("qiskit", "qiskit-ibm-runtime"):
        try:
            versions[distribution] = version(distribution)
        except PackageNotFoundError:
            versions[distribution] = None
    return versions


def _retrieve_real(args: argparse.Namespace) -> int:
    """Download each persisted DONE result once; retrieval never consults the instance catalog."""
    try:
        store = RealEvidenceStore.open(evidence_root=args.evidence_root, run_id=args.run_id)
        jobs = _retrieve_manifest(store, args.run_id)
        submission = _submission_document(store)
    except Exception:
        print("REAL_RETRIEVAL_MANIFEST_INVALID")
        return 2
    if any(job.get("runtime_raw_artifact") is not None for job in jobs):
        print("RUNTIME_RAW_ALREADY_PRESERVED")
        return 2
    provider = _runtime_provider()
    try:
        service = provider.create_retrieval_service()
    except Exception:
        print("REAL_RETRIEVAL_UNAVAILABLE")
        return 2

    downloads: list[tuple[dict[str, Any], Any, str, str]] = []
    for job in jobs:
        try:
            remote_job = provider.get_job(service, job["job_id"])
            if provider.job_status(remote_job) != "DONE":
                print("REAL_JOB_NOT_DONE")
                return 2
            result = provider.job_result(remote_job)
            raw_filename = (
                "sampler-runtime-raw.json"
                if job["role"] == "SAMPLER_ENTROPY_BELL"
                else "estimator-runtime-raw.json"
            )
            raw_hash = store.record_runtime_raw(
                job_id=job["job_id"],
                raw_filename=raw_filename,
                result=result,
                retrieved_at_utc=utc_now(),
            )
            downloads.append((job, result, raw_filename, raw_hash))
        except Exception:
            print("REAL_RESULT_DOWNLOAD_UNAVAILABLE")
            return 2

    try:
        inventories = {
            job["role"]: inventory_result(result, role=job["role"])
            for job, result, _, _ in downloads
        }
        store.record_result_structure(
            structure_document={
                "schema_version": 2,
                "mode": "REAL",
                "run_id": args.run_id,
                "results": inventories,
            },
            recorded_at_utc=utc_now(),
        )
    except RuntimeV2FormatError as error:
        for job, _, _, _ in downloads:
            store.record_result_preservation_failure(
                job_id=job["job_id"],
                error_code="V2_STRUCTURE_INVENTORY_FAILED",
                structural_error=str(error),
                occurred_at_utc=utc_now(),
            )
        _print_real_package(store)
        return 2

    failures: list[tuple[dict[str, Any], RuntimeV2FormatError]] = []
    for job, result, _, raw_hash in downloads:
        try:
            if job["role"] == "SAMPLER_ENTROPY_BELL":
                labels, workloads = _sampler_mapping(job, submission)
                parsed = parse_sampler_v2(
                    result,
                    circuit_labels=labels,
                    workloads=workloads,
                    runtime_raw_sha256=raw_hash,
                )
                store.record_parsed_result(
                    job_id=job["job_id"],
                    derived_documents={
                        "sampler-raw.json": parsed.sampler_raw,
                        "entropy-derived.json": parsed.entropy_derived,
                        "bell-derived.json": parsed.bell_derived,
                    },
                    retrieved_at_utc=utc_now(),
                )
            else:
                labels, convention = _estimator_mapping(job)
                parsed = parse_estimator_v2(
                    result,
                    observable_labels=labels,
                    convention=convention,
                    runtime_raw_sha256=raw_hash,
                )
                store.record_parsed_result(
                    job_id=job["job_id"],
                    derived_documents={
                        "estimator-raw.json": parsed.estimator_raw,
                        "chsh-derived.json": parsed.chsh_derived,
                    },
                    retrieved_at_utc=utc_now(),
                )
        except RuntimeV2FormatError as error:
            failures.append((job, error))
    for job, error in failures:
        store.record_result_preservation_failure(
            job_id=job["job_id"],
            error_code="V2_RESULT_PARSER_FAILED",
            structural_error=str(error),
            occurred_at_utc=utc_now(),
        )
    if failures:
        _print_real_package(store)
        return 2

    details = {
        "qiskit_versions": _runtime_versions(),
        "runtime_raw_to_derived": [
            {
                "role": job["role"],
                "runtime_raw": raw_filename,
                "runtime_raw_sha256": raw_hash,
                "derived_artifacts": next(
                    item["derived_artifacts"]
                    for item in store.manifest()["jobs"]
                    if item["job_id"] == job["job_id"]
                ),
            }
            for job, _, raw_filename, raw_hash in downloads
        ],
    }
    if store.manifest()["state"] == "COMPLETE":
        store.record_provenance(completed_at_utc=utc_now(), details=details)
    _print_real_package(store)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="colapso-quantum")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("simulate", "chsh-simulate"):
        command = commands.add_parser(name)
        command.add_argument("--seed", type=int, required=True)
        command.add_argument("--shots", type=int, default=128)
        command.add_argument("--run-id")
        command.add_argument("--evidence-root", type=Path, default=_repository_evidence_root())
        command.add_argument("--timestamp")
    dry_run = commands.add_parser("real-dry-run")
    dry_run.add_argument("--entropy-qubits", type=int, default=4)

    commands.add_parser("real-preflight")
    submit = commands.add_parser("real-submit")
    submit.add_argument("--run-id")
    submit.add_argument("--evidence-root", type=Path, default=_repository_evidence_root())
    submit.add_argument("--entropy-qubits", type=int, default=4)
    submit.add_argument("--shots", type=int, default=256, choices=range(256, 513))
    submit.add_argument("--transpiler-seed", type=int)

    retrieve = commands.add_parser("real-retrieve")
    retrieve.add_argument("--run-id", required=True)
    retrieve.add_argument("--evidence-root", type=Path, default=_repository_evidence_root())
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "real-dry-run":
        plan = IbmRuntimeProvider().dry_run(entropy_qubits=args.entropy_qubits)
        print(canonical_json_bytes(plan.__dict__).decode("utf-8"))
        return 0
    if args.command == "real-preflight":
        preflight = _runtime_provider().real_preflight()
        print(preflight.status.value)
        return 0 if preflight.open_plan_confirmed else 3
    if args.command == "real-submit":
        return _submit_real(args)
    if args.command == "real-retrieve":
        return _retrieve_real(args)

    timestamp = _parse_timestamp(args.timestamp) or utc_now()
    service = LocalQuantumService(clock=lambda: timestamp)
    if args.command == "simulate":
        entropy = service.simulate_entropy(seed=args.seed, shots=args.shots)
        bell = service.simulate_bell(seed=args.seed, shots=args.shots)
        package = service.write_simulated_package(
            evidence_root=str(args.evidence_root),
            run_id=_run_id("simulated", timestamp, args.run_id),
            entropy=entropy,
            bell=bell,
        )
    else:
        chsh = service.simulate_chsh(seed=args.seed)
        package = service.write_simulated_package(
            evidence_root=str(args.evidence_root),
            run_id=_run_id("chsh-simulated", timestamp, args.run_id),
            chsh=chsh,
        )
    print(canonical_json_bytes({"mode": "SIMULATED", "path": str(package.path), "manifest": package.manifest}).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
