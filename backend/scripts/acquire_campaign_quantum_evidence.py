"""Explicit, resumable acquisition of four separate IBM hardware evidence jobs.

This module is operator-only. Importing it and offline verification do not create a
Runtime service; only explicit live action flags can access IBM Runtime.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import re
import sys
import time
import warnings
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import wraps
from pathlib import Path
from typing import Any

from colapso_quantum.evidence import canonical_json_bytes, sha256_file, sha256_hex
from colapso_quantum.providers.ibm_runtime import (
    IbmOpenPlanPreflight,
    IbmRealExecution,
    IbmRuntimeProvider,
    OpenPlanPreflightStatus,
)
from colapso_quantum.runtime_v2 import parse_sampler_v2

_ACCOUNT_NAME = "colapso"
_BACKEND_NAME = "ibm_fez"
_CHANNEL = "ibm_quantum_platform"
_CAMPAIGN_ID = "colapso-five-hardware-universes-v1"
_STATE_FILENAME = "campaign-acquisition-state.json"
_LOCK_FILENAME = ".campaign-acquisition.lock"
_SHOTS = 256
_ENTROPY_QUBITS = 4
_MAX_EXECUTION_TIME_SECONDS = 30
_REQUIRED_RESERVE_SECONDS = 300
_TERMINAL_FAILURES = {"CANCELLED", "ERROR", "FAILED"}
_SECRET_KEY = re.compile(
    r"(?:token|secret|authorization|password|api[_-]?key|cookie|account|instance|crn)",
    re.I,
)
_PRIVATE_VALUE = re.compile(r"(?:\bBearer\s+|crn:v1:)", re.I)
_JOB_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{4,239}$")

_UNIVERSES = {
    2: "Entangled Paths",
    3: "The Void Protocol",
    4: "Energy Crisis",
    5: "Quantum Storm",
}

_UNIVERSE_ONE_RUN = "runs/real/real-20260721t205417z"
_UNIVERSE_ONE_SAMPLER_JOB = "d9ftp02neu4c739q2u7g"
_UNIVERSE_ONE_ESTIMATOR_JOB = "d9ftp0kinv1c73arre9g"
_UNIVERSE_ONE_BASELINE = {
    "bell-derived.json": "80bd18f56730114f39a3a58784f59ec0b94d9a25ab003edb161ed2367d159849",
    "chsh-derived.json": "e9f1bb47b1528dc46d4ac2f90dd40f9f1118ba7acc134cc6c9e04cc542a09f6e",
    "entropy-derived.json": "fc0b8bd8886d373f8b64f45d04f13a480d57192975ac772dff8c3cfe7131bba5",
    "estimator-raw.json": "b539bc3ae3c90f544a09fedcb12ba8d96dd32efab9b0f3bff5b8bf39f7c52379",
    "estimator-runtime-raw.json": "37c2b070651bef4d1663866e7dce132ac0efa1687c010e07d2554f9ce60266af",
    "manifest.json": "81736afead94f165a6da9ad3ee644f3fe09076f52f091fe925f71a73289be4b9",
    "preflight.json": "4b4abdd0b7fe8aabb63ea0493bd5ba3884a823482cc41a6278ac57b47e77a657",
    "provenance.json": "f8d7f48b39c5678c655682cfb4b3ca55cc8b848c655c6c389bbac33fb9b7378a",
    "result-structure.json": "75c611145cc50251312563cad895bdf01e9ac4dbd6ac59213a3dd956e5d1fe5e",
    "sampler-raw.json": "cfb32286d745efe5bd28b115ebb0524110ddb3b11db139da81647611b8fefdb1",
    "sampler-runtime-raw.json": "d5ae7eb3e4aa784b4669dcf5387279982365d9b0a671cf424084a477324845b9",
    "SHA256SUMS": "bb76fc4fec44683ab6e42a0c692339ad602f01f0d4735aadfaee6224f7d4dd92",
    "submission.json": "2539344130ba1a55abc804eec914fe753fc8bf801b0d612ef030d42ad5f0bd5b",
}


class CampaignEvidenceError(RuntimeError):
    """A safe operator-facing failure represented only by a stable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class CampaignPreflight:
    plan: str
    usage_consumed_seconds: float
    usage_limit_seconds: float
    usage_remaining_seconds: float
    backend_name: str
    backend_version: str | None
    pending_jobs: int
    conservative_jobs: int

    @property
    def conservative_qpu_seconds(self) -> int:
        return self.conservative_jobs * _MAX_EXECUTION_TIME_SECONDS

    def as_evidence(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "status": "GREEN",
            "channel": _CHANNEL,
            "plan": self.plan,
            "usage_consumed_seconds": self.usage_consumed_seconds,
            "usage_limit_seconds": self.usage_limit_seconds,
            "usage_remaining_seconds": self.usage_remaining_seconds,
            "usage_limit_reached": False,
            "backend": self.backend_name,
            "backend_version": self.backend_version,
            "hardware_backend": True,
            "operational": True,
            "pending_jobs_observed": self.pending_jobs,
            "shots_per_job": _SHOTS,
            "conservative_jobs_remaining": self.conservative_jobs,
            "conservative_qpu_seconds_per_job": _MAX_EXECUTION_TIME_SECONDS,
            "conservative_qpu_seconds_total": self.conservative_qpu_seconds,
            "required_post_estimate_reserve_seconds": _REQUIRED_RESERVE_SECONDS,
        }

    def as_operator_report(self) -> dict[str, Any]:
        return {
            "saved_account_loaded": True,
            "plan": self.plan,
            "usage_consumed_seconds": self.usage_consumed_seconds,
            "usage_limit_seconds": self.usage_limit_seconds,
            "usage_remaining_seconds": self.usage_remaining_seconds,
            "usage_limit_reached": False,
            "backend": self.backend_name,
            "hardware_backend": True,
            "operational": True,
            "pending_jobs": self.pending_jobs,
            "conservative_four_job_usage_estimate_seconds": self.conservative_qpu_seconds,
        }


def _repository_evidence_root() -> Path:
    return Path(__file__).resolve().parents[2] / "evidence"


@contextmanager
def _campaign_lock(evidence_root: Path) -> Iterator[None]:
    lock_path = evidence_root.resolve() / _LOCK_FILENAME
    descriptor: int | None = None
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.write(descriptor, b"COLAPSO_CAMPAIGN_OPERATION_V1\n")
        os.fsync(descriptor)
    except FileExistsError as error:
        raise CampaignEvidenceError("CAMPAIGN_OPERATION_LOCKED") from error
    except OSError as error:
        if descriptor is not None:
            os.close(descriptor)
            lock_path.unlink(missing_ok=True)
        raise CampaignEvidenceError("CAMPAIGN_LOCK_UNAVAILABLE") from error
    try:
        yield
    finally:
        os.close(descriptor)
        try:
            lock_path.unlink()
        except OSError as error:
            raise CampaignEvidenceError("CAMPAIGN_LOCK_RELEASE_FAILED") from error


def _locked_campaign_operation(function: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(function)
    def locked(evidence_root: Path, *args: Any, **kwargs: Any) -> Any:
        with _campaign_lock(evidence_root):
            return function(evidence_root, *args, **kwargs)

    return locked


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise CampaignEvidenceError("TIMESTAMP_OFFSET_REQUIRED")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _safe_timestamp(value: Any) -> str | None:
    if isinstance(value, datetime):
        return _utc_text(value)
    if not isinstance(value, str) or not value or len(value) > 80:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _utc_text(parsed) if parsed.tzinfo is not None else None


def _reject_private_data(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if not isinstance(key, str) or _SECRET_KEY.search(key):
                raise CampaignEvidenceError("PRIVATE_EVIDENCE_KEY_REJECTED")
            _reject_private_data(nested)
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for nested in value:
            _reject_private_data(nested)
    elif isinstance(value, str) and _PRIVATE_VALUE.search(value):
        raise CampaignEvidenceError("PRIVATE_EVIDENCE_VALUE_REJECTED")


def _write_bytes_atomically(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    try:
        with temporary.open("wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            directory_descriptor = os.open(path.parent, flags)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
    except OSError as error:
        temporary.unlink(missing_ok=True)
        raise CampaignEvidenceError("EVIDENCE_WRITE_FAILED") from error


def _write_json(path: Path, value: Any) -> str:
    _reject_private_data(value)
    _write_bytes_atomically(path, canonical_json_bytes(value))
    return sha256_file(path)


def _write_json_once(path: Path, value: Any) -> str:
    expected = canonical_json_bytes(value)
    _reject_private_data(value)
    if path.exists():
        if path.read_bytes() != expected:
            raise CampaignEvidenceError("EXISTING_ARTIFACT_MISMATCH")
        return sha256_file(path)
    _write_bytes_atomically(path, expected)
    return sha256_file(path)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CampaignEvidenceError("EVIDENCE_JSON_UNREADABLE") from error
    if not isinstance(value, dict):
        raise CampaignEvidenceError("EVIDENCE_JSON_NOT_OBJECT")
    _reject_private_data(value)
    return value


def _write_ledger(directory: Path) -> None:
    files = sorted(path for path in directory.iterdir() if path.is_file() and path.suffix == ".json")
    lines = [f"{sha256_file(path)}  {path.name}" for path in files]
    _write_bytes_atomically(directory / "SHA256SUMS", ("\n".join(lines) + "\n").encode("ascii"))


def _read_ledger(directory: Path) -> dict[str, str]:
    try:
        lines = (directory / "SHA256SUMS").read_text("ascii").splitlines()
    except OSError as error:
        raise CampaignEvidenceError("EVIDENCE_LEDGER_MISSING") from error
    values: dict[str, str] = {}
    for line in lines:
        digest, separator, name = line.partition("  ")
        if (
            separator != "  "
            or re.fullmatch(r"[a-f0-9]{64}", digest) is None
            or not name.endswith(".json")
            or "/" in name
            or "\\" in name
            or name in values
        ):
            raise CampaignEvidenceError("EVIDENCE_LEDGER_INVALID")
        values[name] = digest
    return values


def _universe_directory(evidence_root: Path, universe_number: int) -> Path:
    if universe_number not in _UNIVERSES:
        raise CampaignEvidenceError("UNIVERSE_NUMBER_INVALID")
    root = evidence_root.resolve()
    destination = (root / f"universe-{universe_number:03d}").resolve()
    if root not in destination.parents:
        raise CampaignEvidenceError("EVIDENCE_PATH_INVALID")
    return destination


def _operator_state_template() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "campaign_id": _CAMPAIGN_ID,
        "universes": [
            {
                "universe_number": universe_number,
                "backend": _BACKEND_NAME,
                "job_id": None,
                "submission_timestamp": None,
                "current_status": "NOT_SUBMITTED",
                "result_preserved": False,
                "evidence_path": f"evidence/universe-{universe_number:03d}",
            }
            for universe_number in _UNIVERSES
        ],
    }


def _operator_state_path(evidence_root: Path) -> Path:
    return evidence_root.resolve() / _STATE_FILENAME


def _validate_operator_state(state: Mapping[str, Any]) -> None:
    if state.get("schema_version") != 1 or state.get("campaign_id") != _CAMPAIGN_ID:
        raise CampaignEvidenceError("ACQUISITION_STATE_IDENTITY_INVALID")
    universes = state.get("universes")
    if (
        not isinstance(universes, list)
        or any(not isinstance(item, Mapping) for item in universes)
        or [item.get("universe_number") for item in universes] != list(_UNIVERSES)
    ):
        raise CampaignEvidenceError("ACQUISITION_STATE_UNIVERSES_INVALID")
    allowed_keys = {
        "universe_number",
        "backend",
        "job_id",
        "submission_timestamp",
        "current_status",
        "result_preserved",
        "evidence_path",
    }
    allowed_statuses = {
        "NOT_SUBMITTED",
        "SUBMISSION_IN_PROGRESS",
        "SUBMITTED",
        "INITIALIZING",
        "QUEUED",
        "RUNNING",
        "DONE",
        "FAILED",
        "CANCELLED",
        "ERROR",
    }
    for entry in universes:
        if not isinstance(entry, Mapping) or set(entry) != allowed_keys:
            raise CampaignEvidenceError("ACQUISITION_STATE_ENTRY_INVALID")
        number = entry["universe_number"]
        job_id = entry["job_id"]
        if (
            number not in _UNIVERSES
            or entry["backend"] != _BACKEND_NAME
            or (job_id is not None and _JOB_ID.fullmatch(str(job_id)) is None)
            or entry["current_status"] not in allowed_statuses
            or not isinstance(entry["result_preserved"], bool)
            or entry["evidence_path"] != f"evidence/universe-{number:03d}"
        ):
            raise CampaignEvidenceError("ACQUISITION_STATE_ENTRY_INVALID")
        if entry["result_preserved"] and (job_id is None or entry["current_status"] != "DONE"):
            raise CampaignEvidenceError("ACQUISITION_STATE_RESULT_INVALID")
    _reject_private_data(state)


def _load_operator_state(evidence_root: Path, *, create: bool) -> dict[str, Any]:
    path = _operator_state_path(evidence_root)
    if not path.exists():
        if not create:
            raise CampaignEvidenceError("ACQUISITION_STATE_MISSING")
        state = _operator_state_template()
        _write_json(path, state)
        return state
    state = _read_json(path)
    _validate_operator_state(state)
    return state


def _write_operator_state(evidence_root: Path, state: dict[str, Any]) -> None:
    _validate_operator_state(state)
    _write_json(_operator_state_path(evidence_root), state)


def _operator_state_entry(state: Mapping[str, Any], universe_number: int) -> dict[str, Any]:
    entries = [
        entry
        for entry in state["universes"]
        if isinstance(entry, dict) and entry.get("universe_number") == universe_number
    ]
    if len(entries) != 1:
        raise CampaignEvidenceError("ACQUISITION_STATE_UNIVERSE_MISSING")
    return entries[0]


def _sync_operator_state(evidence_root: Path, universe_number: int) -> dict[str, Any]:
    state = _load_operator_state(evidence_root, create=True)
    entry = _operator_state_entry(state, universe_number)
    directory = _universe_directory(evidence_root, universe_number)
    if not directory.is_dir():
        return state
    manifest, _ = _load_state(directory)
    attempts = manifest.get("attempts")
    if not isinstance(attempts, list):
        raise CampaignEvidenceError("ACQUISITION_ATTEMPTS_INVALID")
    pending = manifest.get("pending_submission_intent")
    if pending is not None:
        entry["current_status"] = "SUBMISSION_IN_PROGRESS"
    if attempts:
        current = attempts[-1]
        current_job_id = current.get("job_id")
        existing_job_id = entry.get("job_id")
        if existing_job_id not in {None, current_job_id}:
            previous = attempts[-2] if len(attempts) == 2 else None
            if (
                not isinstance(previous, Mapping)
                or previous.get("job_id") != existing_job_id
                or previous.get("status") not in _TERMINAL_FAILURES
            ):
                raise CampaignEvidenceError("ACQUISITION_STATE_JOB_MISMATCH")
        entry["job_id"] = current_job_id
        entry["submission_timestamp"] = current.get("submitted_at_utc")
        entry["current_status"] = current.get("status")
        entry["result_preserved"] = manifest.get("state") == "COMPLETE"
    _write_operator_state(evidence_root, state)
    return state


def _sync_all_operator_state(evidence_root: Path) -> dict[str, Any]:
    state = _load_operator_state(evidence_root, create=True)
    for universe_number in _UNIVERSES:
        if _universe_directory(evidence_root, universe_number).is_dir():
            state = _sync_operator_state(evidence_root, universe_number)
    return state


def _short_job_id(job_id: str) -> str:
    return f"{job_id[:8]}...{job_id[-4:]}"


def _print_event(event: str, **details: Any) -> None:
    print(canonical_json_bytes({"event": event, **details}).decode("utf-8"), flush=True)


def _backend_version(backend: Any) -> str | None:
    value = getattr(backend, "version", None)
    value = value() if callable(value) else value
    return str(value) if value is not None else None


def _create_live_service(
    credentials_file: str,
    account_name: str,
    *,
    service_factory: Callable[..., Any] | None = None,
) -> Any:
    if not credentials_file:
        raise CampaignEvidenceError("CREDENTIAL_FILE_REQUIRED")
    credential_path = Path(credentials_file)
    if not credential_path.is_file() or not os.access(credential_path, os.R_OK):
        raise CampaignEvidenceError("CREDENTIAL_FILE_INACCESSIBLE")
    if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", account_name) is None:
        raise CampaignEvidenceError("ACCOUNT_NAME_INVALID")
    try:
        if service_factory is None:
            from qiskit_ibm_runtime import QiskitRuntimeService

            service_factory = QiskitRuntimeService
        return service_factory(name=account_name, filename=credentials_file)
    except Exception as error:
        raise CampaignEvidenceError("SAVED_ACCOUNT_UNAVAILABLE") from error


def _safe_preflight(service: Any, *, conservative_jobs: int) -> tuple[CampaignPreflight, Any]:
    try:
        active = service.active_instance()
        instances = service.instances()
        matching = [
            record
            for record in instances
            if isinstance(record, Mapping)
            and (record.get("crn") == active or record.get("name") == active)
        ]
        plan = str(matching[0].get("plan", "")).strip().lower() if len(matching) == 1 else ""
        usage = service.usage()
        consumed = usage.get("usage_consumed_seconds")
        limit = usage.get("usage_limit_seconds")
        remaining = usage.get("usage_remaining_seconds")
        limit_reached = usage.get("usage_limit_reached")
        numeric = all(
            isinstance(item, (int, float))
            and not isinstance(item, bool)
            and math.isfinite(float(item))
            and float(item) >= 0
            for item in (consumed, limit, remaining)
        )
        backend = service.backend(_BACKEND_NAME)
        configuration = backend.configuration()
        status = backend.status()
    except Exception as error:
        raise CampaignEvidenceError("PREFLIGHT_SERVICE_UNAVAILABLE") from error

    if plan != "open":
        raise CampaignEvidenceError("OPEN_PLAN_NOT_CONFIRMED")
    if not numeric:
        raise CampaignEvidenceError("ALLOWANCE_NOT_NUMERIC")
    if limit_reached is not False:
        raise CampaignEvidenceError("USAGE_LIMIT_REACHED")
    if getattr(configuration, "simulator", None) is not False:
        raise CampaignEvidenceError("IBM_FEZ_NOT_HARDWARE")
    if backend.name != _BACKEND_NAME or status.operational is not True:
        raise CampaignEvidenceError("IBM_FEZ_NOT_OPERATIONAL")

    estimate = conservative_jobs * _MAX_EXECUTION_TIME_SECONDS
    if float(remaining) - estimate < _REQUIRED_RESERVE_SECONDS:
        raise CampaignEvidenceError("ALLOWANCE_RESERVE_INSUFFICIENT")
    preflight = CampaignPreflight(
        plan=plan,
        usage_consumed_seconds=float(consumed),
        usage_limit_seconds=float(limit),
        usage_remaining_seconds=float(remaining),
        backend_name=backend.name,
        backend_version=_backend_version(backend),
        pending_jobs=int(status.pending_jobs),
        conservative_jobs=conservative_jobs,
    )
    return preflight, backend


def _verify_universe_one(evidence_root: Path) -> None:
    directory = evidence_root / _UNIVERSE_ONE_RUN
    present = {path.name for path in directory.iterdir() if path.is_file()} if directory.is_dir() else set()
    if present != set(_UNIVERSE_ONE_BASELINE):
        raise CampaignEvidenceError("UNIVERSE_ONE_INVENTORY_CHANGED")
    for name, expected in _UNIVERSE_ONE_BASELINE.items():
        if sha256_file(directory / name) != expected:
            raise CampaignEvidenceError("UNIVERSE_ONE_BYTES_CHANGED")


def _prepare_universe(
    evidence_root: Path,
    universe_number: int,
    preflight: CampaignPreflight,
) -> Path:
    directory = _universe_directory(evidence_root, universe_number)
    if directory.exists():
        manifest, submission = _load_state(directory)
        expected_identity = (
            manifest.get("campaign_id") == _CAMPAIGN_ID
            and manifest.get("universe_number") == universe_number
            and manifest.get("title") == _UNIVERSES[universe_number]
            and manifest.get("mode") == "REAL"
            and manifest.get("hardware_execution") == "SEPARATE_RUNTIME_JOB"
            and manifest.get("board_generation_started") is False
            and submission.get("campaign_id") == _CAMPAIGN_ID
            and submission.get("universe_number") == universe_number
            and submission.get("title") == _UNIVERSES[universe_number]
            and submission.get("primitive") == "SamplerV2"
            and submission.get("shots") == _SHOTS
            and submission.get("sampler_publications")
            == ["ENTROPY_HARVEST", "BELL_CORRELATION"]
        )
        if not expected_identity:
            raise CampaignEvidenceError("EXISTING_UNIVERSE_IDENTITY_MISMATCH")
        return directory
    directory.mkdir(parents=True, exist_ok=False)
    timestamp = _utc_text(_utc_now())
    manifest = {
        "schema_version": 1,
        "campaign_id": _CAMPAIGN_ID,
        "universe_number": universe_number,
        "title": _UNIVERSES[universe_number],
        "mode": "REAL",
        "state": "PREPARED",
        "hardware_execution": "SEPARATE_RUNTIME_JOB",
        "created_at_utc": timestamp,
        "updated_at_utc": timestamp,
        "attempts": [],
        "pending_submission_intent": None,
        "submission_errors": [],
        "artifacts": {},
        "board_generation_started": False,
    }
    submission = {
        "schema_version": 1,
        "campaign_id": _CAMPAIGN_ID,
        "universe_number": universe_number,
        "title": _UNIVERSES[universe_number],
        "primitive": "SamplerV2",
        "execution_mode": "JOB",
        "shots": _SHOTS,
        "entropy_qubits": _ENTROPY_QUBITS,
        "max_execution_time_seconds": _MAX_EXECUTION_TIME_SECONDS,
        "maximum_attempts": 2,
        "sampler_publications": ["ENTROPY_HARVEST", "BELL_CORRELATION"],
        "attempts": [],
        "pending_submission_intent": None,
        "submission_errors": [],
    }
    _write_json(directory / "preflight.json", preflight.as_evidence())
    _write_json(directory / "submission.json", submission)
    _write_json(directory / "manifest.json", manifest)
    _write_ledger(directory)
    return directory


def _load_state(directory: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = _read_json(directory / "manifest.json")
    submission = _read_json(directory / "submission.json")
    if (
        manifest.get("attempts") != submission.get("attempts")
        or manifest.get("pending_submission_intent")
        != submission.get("pending_submission_intent")
        or manifest.get("submission_errors") != submission.get("submission_errors")
    ):
        raise CampaignEvidenceError("CROSS_FILE_SUBMISSION_STATE_MISMATCH")
    return manifest, submission


def _write_state(directory: Path, manifest: dict[str, Any], submission: dict[str, Any]) -> None:
    manifest["updated_at_utc"] = _utc_text(_utc_now())
    _write_json(directory / "submission.json", submission)
    _write_json(directory / "manifest.json", manifest)
    _write_ledger(directory)


def _record_submission_intent(directory: Path, *, attempt_number: int) -> None:
    manifest, submission = _load_state(directory)
    if manifest.get("pending_submission_intent") is not None:
        raise CampaignEvidenceError("AMBIGUOUS_SUBMISSION_REQUIRES_RECONCILIATION")
    attempts = manifest.get("attempts")
    if not isinstance(attempts, list) or attempt_number != len(attempts) + 1:
        raise CampaignEvidenceError("SUBMISSION_ATTEMPT_ORDER_INVALID")
    if attempt_number == 2 and (
        len(attempts) != 1 or attempts[0].get("status") not in _TERMINAL_FAILURES
    ):
        raise CampaignEvidenceError("RETRY_REQUIRES_TERMINAL_FAILURE")
    if any(item.get("status") == "DONE" for item in attempts):
        raise CampaignEvidenceError("COMPLETED_JOB_REPLACEMENT_REJECTED")
    intent = {
        "attempt": attempt_number,
        "created_at_utc": _utc_text(_utc_now()),
        "state": "REMOTE_OUTCOME_NOT_YET_RECORDED",
    }
    manifest["pending_submission_intent"] = intent
    submission["pending_submission_intent"] = intent
    manifest["state"] = "SUBMISSION_IN_PROGRESS"
    _write_state(directory, manifest, submission)


def _record_submission(directory: Path, submitted: Any, *, attempt_number: int) -> None:
    manifest, submission = _load_state(directory)
    intent = manifest.get("pending_submission_intent")
    if not isinstance(intent, Mapping) or intent.get("attempt") != attempt_number:
        raise CampaignEvidenceError("SUBMISSION_INTENT_MISSING")
    if len(manifest["attempts"]) >= 2 or len(submission["attempts"]) >= 2:
        raise CampaignEvidenceError("RETRY_LIMIT_REACHED")
    if attempt_number != len(manifest["attempts"]) + 1:
        raise CampaignEvidenceError("SUBMISSION_ATTEMPT_ORDER_INVALID")
    if attempt_number == 2 and manifest["attempts"][0].get("status") not in _TERMINAL_FAILURES:
        raise CampaignEvidenceError("RETRY_REQUIRES_TERMINAL_FAILURE")
    if any(item.get("status") == "DONE" for item in manifest["attempts"]):
        raise CampaignEvidenceError("COMPLETED_JOB_REPLACEMENT_REJECTED")
    if any(item.get("job_id") == submitted.job_id for item in manifest["attempts"]):
        raise CampaignEvidenceError("RETRY_JOB_ID_NOT_DISTINCT")
    timestamp = _utc_text(_utc_now())
    attempt = {
        "attempt": attempt_number,
        "job_id": submitted.job_id,
        "job_id_short": _short_job_id(submitted.job_id),
        "primitive": submitted.primitive,
        "backend": submitted.backend,
        "backend_version": submitted.backend_version,
        "shots": _SHOTS,
        "submitted_at_utc": timestamp,
        "first_running_observed_at_utc": None,
        "completed_at_utc": None,
        "status": "SUBMITTED",
        "submission_metadata": dict(submitted.metadata),
        "provider_timestamps": {},
        "qpu_usage_seconds": None,
    }
    _reject_private_data(attempt)
    manifest["attempts"].append(attempt)
    submission["attempts"].append(attempt)
    manifest["pending_submission_intent"] = None
    submission["pending_submission_intent"] = None
    manifest["state"] = "SUBMITTED"
    _write_state(directory, manifest, submission)


def _record_submission_error(
    directory: Path,
    *,
    attempt_number: int,
    returned_job_id: str | None = None,
) -> None:
    manifest, submission = _load_state(directory)
    error = {
        "attempt": attempt_number,
        "error_code": "SAMPLER_SUBMISSION_FAILED",
        "occurred_at_utc": _utc_text(_utc_now()),
        "returned_job_id": returned_job_id,
    }
    manifest["submission_errors"].append(error)
    submission["submission_errors"].append(error)
    manifest["state"] = "BLOCKED"
    _write_state(directory, manifest, submission)


def _update_status(directory: Path, job_id: str, status: str) -> None:
    manifest, submission = _load_state(directory)
    matched = 0
    now = _utc_text(_utc_now())
    for document in (manifest, submission):
        for attempt in document["attempts"]:
            if attempt["job_id"] == job_id:
                matched += 1
                attempt["status"] = status
                if status == "RUNNING" and attempt["first_running_observed_at_utc"] is None:
                    attempt["first_running_observed_at_utc"] = now
                if status in _TERMINAL_FAILURES:
                    attempt["completed_at_utc"] = now
    if matched != 2:
        raise CampaignEvidenceError("JOB_ID_NOT_RECORDED")
    manifest["state"] = "FAILED" if status in _TERMINAL_FAILURES else status
    _write_state(directory, manifest, submission)


def _write_runtime_raw_once(path: Path, result: Any) -> str:
    if path.exists():
        try:
            parsed = json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise CampaignEvidenceError("RUNTIME_RAW_UNREADABLE") from error
        _reject_private_data(parsed)
        return sha256_file(path)
    from qiskit_ibm_runtime import RuntimeEncoder

    try:
        encoded = json.dumps(
            result,
            cls=RuntimeEncoder,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        parsed = json.loads(encoded)
        _reject_private_data(parsed)
    except CampaignEvidenceError:
        raise
    except Exception as error:
        raise CampaignEvidenceError("RUNTIME_RAW_SERIALIZATION_FAILED") from error
    _write_bytes_atomically(path, encoded.encode("utf-8"))
    return sha256_file(path)


def _safe_job_metrics(job: Any) -> dict[str, Any]:
    try:
        metrics = job.metrics()
    except Exception:
        return {"provider_timestamps": {}, "qpu_usage_seconds": None}
    if not isinstance(metrics, Mapping):
        return {"provider_timestamps": {}, "qpu_usage_seconds": None}
    timestamps = metrics.get("timestamps")
    safe_timestamps = {
        name: safe
        for name in ("created", "running", "finished")
        if isinstance(timestamps, Mapping)
        and (safe := _safe_timestamp(timestamps.get(name))) is not None
    }
    usage = metrics.get("usage")
    qpu_seconds = usage.get("quantum_seconds") if isinstance(usage, Mapping) else None
    if not isinstance(qpu_seconds, (int, float)) or isinstance(qpu_seconds, bool):
        qpu_seconds = None
    return {
        "provider_timestamps": safe_timestamps,
        "qpu_usage_seconds": float(qpu_seconds) if qpu_seconds is not None else None,
    }


def _record_completed_result(
    directory: Path,
    *,
    job: Any,
    result: Any,
) -> dict[str, Any]:
    manifest, submission = _load_state(directory)
    active = manifest["attempts"][-1]
    raw_hash = _write_runtime_raw_once(directory / "sampler-runtime-raw.json", result)
    circuits = active["submission_metadata"].get("circuits")
    if not isinstance(circuits, list) or len(circuits) != 2:
        raise CampaignEvidenceError("CIRCUIT_MAPPING_MISSING")
    labels = [item.get("name") for item in circuits if isinstance(item, Mapping)]
    if len(labels) != 2 or any(not isinstance(label, str) or not label for label in labels):
        raise CampaignEvidenceError("CIRCUIT_LABEL_INVALID")
    try:
        parsed = parse_sampler_v2(
            result,
            circuit_labels=labels,
            workloads=["ENTROPY_HARVEST", "BELL_CORRELATION"],
            runtime_raw_sha256=raw_hash,
        )
    except Exception as error:
        raise CampaignEvidenceError("SAMPLER_RESULT_PARSE_FAILED") from error

    pubs = parsed.sampler_raw.get("pubs")
    if not isinstance(pubs, list) or len(pubs) != 2:
        raise CampaignEvidenceError("SAMPLER_PUBLICATION_COUNT_INVALID")
    by_workload = {
        pub.get("workload"): pub
        for pub in pubs
        if isinstance(pub, Mapping) and isinstance(pub.get("workload"), str)
    }
    entropy_pub = by_workload.get("ENTROPY_HARVEST")
    bell_pub = by_workload.get("BELL_CORRELATION")
    if not isinstance(entropy_pub, Mapping) or not isinstance(bell_pub, Mapping):
        raise CampaignEvidenceError("SAMPLER_WORKLOAD_MAPPING_INVALID")
    entropy_combined = entropy_pub.get("combined")
    bell_combined = bell_pub.get("combined")
    if (
        not isinstance(entropy_combined, Mapping)
        or not isinstance(bell_combined, Mapping)
        or entropy_combined.get("num_shots") != _SHOTS
        or bell_combined.get("num_shots") != _SHOTS
        or entropy_combined.get("num_bits") != _ENTROPY_QUBITS
        or bell_combined.get("num_bits") != 2
    ):
        raise CampaignEvidenceError("SAMPLER_RESULT_SHAPE_INVALID")

    artifact_hashes = {
        "sampler-runtime-raw.json": raw_hash,
        "result-structure.json": _write_json_once(
            directory / "result-structure.json",
            {
                "schema_version": 1,
                "mode": "REAL",
                "role": "SAMPLER_ENTROPY_BELL",
                "structure": parsed.structure,
            },
        ),
        "sampler-raw.json": _write_json_once(directory / "sampler-raw.json", parsed.sampler_raw),
        "accepted-entropy.json": _write_json_once(
            directory / "accepted-entropy.json",
            parsed.entropy_derived,
        ),
        "bell-derived.json": _write_json_once(
            directory / "bell-derived.json",
            parsed.bell_derived,
        ),
    }
    commitment_payload = {
        "domain": "COLAPSO_UNIVERSE_ACQUISITION_V1",
        "campaign_id": _CAMPAIGN_ID,
        "universe_number": manifest["universe_number"],
        "runtime_raw_sha256": raw_hash,
        "canonical_raw_sha256": artifact_hashes["sampler-raw.json"],
        "accepted_entropy_sha256": artifact_hashes["accepted-entropy.json"],
    }
    universe_commitment = sha256_hex(commitment_payload)
    metrics = _safe_job_metrics(job)
    finished = metrics["provider_timestamps"].get("finished") or _utc_text(_utc_now())
    verification = {
        "schema_version": 1,
        "campaign_id": _CAMPAIGN_ID,
        "universe_number": manifest["universe_number"],
        "state": "EVIDENCE_ACQUIRED",
        "job_id": active["job_id"],
        "backend": active["backend"],
        "shots": active["shots"],
        "runtime_raw_sha256": raw_hash,
        "canonical_raw_sha256": artifact_hashes["sampler-raw.json"],
        "accepted_entropy_sha256": artifact_hashes["accepted-entropy.json"],
        "universe_commitment": universe_commitment,
        "commitment_scope": "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD",
        "checks": {
            "separate_runtime_job": True,
            "real_hardware": True,
            "raw_preserved_before_parsing": True,
            "canonical_result_preserved": True,
            "accepted_entropy_linked_to_raw": True,
            "board_generation_started": False,
        },
    }
    artifact_hashes["verification-report.json"] = _write_json_once(
        directory / "verification-report.json",
        verification,
    )

    for document in (manifest, submission):
        for attempt in document["attempts"]:
            if attempt["job_id"] == active["job_id"]:
                attempt["status"] = "DONE"
                attempt["completed_at_utc"] = finished
                attempt["provider_timestamps"] = metrics["provider_timestamps"]
                attempt["qpu_usage_seconds"] = metrics["qpu_usage_seconds"]
    manifest["state"] = "COMPLETE"
    manifest["artifacts"] = artifact_hashes
    manifest["runtime_raw_sha256"] = raw_hash
    manifest["canonical_raw_sha256"] = artifact_hashes["sampler-raw.json"]
    manifest["accepted_entropy_sha256"] = artifact_hashes["accepted-entropy.json"]
    manifest["universe_commitment"] = universe_commitment
    manifest["commitment_scope"] = "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD"
    manifest["board_generation_started"] = False
    _write_state(directory, manifest, submission)
    return _verify_universe_directory(directory)


def _verify_universe_directory(directory: Path) -> dict[str, Any]:
    required_json = {
        "accepted-entropy.json",
        "bell-derived.json",
        "manifest.json",
        "preflight.json",
        "result-structure.json",
        "sampler-raw.json",
        "sampler-runtime-raw.json",
        "submission.json",
        "verification-report.json",
    }
    present_json = {path.name for path in directory.iterdir() if path.is_file() and path.suffix == ".json"}
    if present_json != required_json:
        raise CampaignEvidenceError("UNIVERSE_EVIDENCE_INVENTORY_INVALID")
    ledger = _read_ledger(directory)
    if set(ledger) != present_json:
        raise CampaignEvidenceError("UNIVERSE_LEDGER_INVENTORY_INVALID")
    for name, expected in ledger.items():
        if sha256_file(directory / name) != expected:
            raise CampaignEvidenceError("UNIVERSE_ARTIFACT_HASH_MISMATCH")
        _read_json(directory / name)
    manifest = _read_json(directory / "manifest.json")
    submission = _read_json(directory / "submission.json")
    directory_match = re.fullmatch(r"universe-(\d{3})", directory.name)
    expected_number = int(directory_match.group(1)) if directory_match else -1
    expected_title = _UNIVERSES.get(expected_number)
    identity_valid = (
        expected_title is not None
        and manifest.get("campaign_id") == _CAMPAIGN_ID
        and manifest.get("universe_number") == expected_number
        and manifest.get("title") == expected_title
        and manifest.get("mode") == "REAL"
        and manifest.get("hardware_execution") == "SEPARATE_RUNTIME_JOB"
        and submission.get("campaign_id") == _CAMPAIGN_ID
        and submission.get("universe_number") == expected_number
        and submission.get("title") == expected_title
        and submission.get("primitive") == "SamplerV2"
        and submission.get("shots") == _SHOTS
        and submission.get("sampler_publications")
        == ["ENTROPY_HARVEST", "BELL_CORRELATION"]
    )
    if not identity_valid:
        raise CampaignEvidenceError("UNIVERSE_PATH_IDENTITY_INVALID")
    if (
        manifest.get("state") != "COMPLETE"
        or manifest.get("board_generation_started") is not False
        or manifest.get("pending_submission_intent") is not None
        or submission.get("pending_submission_intent") is not None
        or manifest.get("attempts") != submission.get("attempts")
        or manifest.get("submission_errors") != submission.get("submission_errors")
    ):
        raise CampaignEvidenceError("UNIVERSE_EVIDENCE_NOT_COMPLETE")
    attempts = manifest.get("attempts")
    if not isinstance(attempts, list) or not 1 <= len(attempts) <= 2:
        raise CampaignEvidenceError("UNIVERSE_JOB_ATTEMPTS_INVALID")
    if len(attempts) == 1:
        valid_history = attempts[0].get("attempt") == 1 and attempts[0].get("status") == "DONE"
    else:
        valid_history = (
            attempts[0].get("attempt") == 1
            and attempts[0].get("status") in _TERMINAL_FAILURES
            and attempts[0].get("completed_at_utc") is not None
            and attempts[1].get("attempt") == 2
            and attempts[1].get("status") == "DONE"
            and attempts[0].get("job_id") != attempts[1].get("job_id")
        )
    completed = [item for item in attempts if isinstance(item, Mapping) and item.get("status") == "DONE"]
    if not valid_history or len(completed) != 1:
        raise CampaignEvidenceError("UNIVERSE_JOB_ATTEMPTS_INVALID")
    job = completed[0]
    if _JOB_ID.fullmatch(str(job.get("job_id", ""))) is None:
        raise CampaignEvidenceError("UNIVERSE_JOB_ID_INVALID")
    if job.get("backend") != _BACKEND_NAME or job.get("shots") != _SHOTS:
        raise CampaignEvidenceError("UNIVERSE_EXECUTION_METADATA_INVALID")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, Mapping) or any(ledger.get(name) != digest for name, digest in artifacts.items()):
        raise CampaignEvidenceError("UNIVERSE_MANIFEST_LINKAGE_INVALID")
    runtime_hash = ledger["sampler-runtime-raw.json"]
    canonical_hash = ledger["sampler-raw.json"]
    entropy_hash = ledger["accepted-entropy.json"]
    if (
        manifest.get("runtime_raw_sha256") != runtime_hash
        or manifest.get("canonical_raw_sha256") != canonical_hash
        or manifest.get("accepted_entropy_sha256") != entropy_hash
    ):
        raise CampaignEvidenceError("UNIVERSE_PRIMARY_HASH_INVALID")
    expected_commitment = sha256_hex(
        {
            "domain": "COLAPSO_UNIVERSE_ACQUISITION_V1",
            "campaign_id": _CAMPAIGN_ID,
            "universe_number": manifest["universe_number"],
            "runtime_raw_sha256": runtime_hash,
            "canonical_raw_sha256": canonical_hash,
            "accepted_entropy_sha256": entropy_hash,
        }
    )
    if (
        manifest.get("universe_commitment") != expected_commitment
        or manifest.get("commitment_scope")
        != "ACQUISITION_EVIDENCE_INPUTS_NOT_COMPILED_BOARD"
    ):
        raise CampaignEvidenceError("UNIVERSE_COMMITMENT_INVALID")
    entropy = _read_json(directory / "accepted-entropy.json")
    if entropy.get("source_runtime_raw_sha256") != runtime_hash or entropy.get("shots") != _SHOTS:
        raise CampaignEvidenceError("UNIVERSE_ENTROPY_SOURCE_INVALID")
    sampler_raw = _read_json(directory / "sampler-raw.json")
    pubs = sampler_raw.get("pubs")
    if not isinstance(pubs, list) or len(pubs) != 2:
        raise CampaignEvidenceError("UNIVERSE_CANONICAL_RESULT_INVALID")
    by_workload = {
        pub.get("workload"): pub
        for pub in pubs
        if isinstance(pub, Mapping) and isinstance(pub.get("workload"), str)
    }
    entropy_pub = by_workload.get("ENTROPY_HARVEST")
    bell_pub = by_workload.get("BELL_CORRELATION")
    if not isinstance(entropy_pub, Mapping) or not isinstance(bell_pub, Mapping):
        raise CampaignEvidenceError("UNIVERSE_CANONICAL_RESULT_INVALID")
    entropy_combined = entropy_pub.get("combined")
    bell_combined = bell_pub.get("combined")
    if (
        not isinstance(entropy_combined, Mapping)
        or not isinstance(bell_combined, Mapping)
        or entropy_combined.get("num_shots") != _SHOTS
        or bell_combined.get("num_shots") != _SHOTS
        or entropy_combined.get("num_bits") != _ENTROPY_QUBITS
        or bell_combined.get("num_bits") != 2
    ):
        raise CampaignEvidenceError("UNIVERSE_CANONICAL_RESULT_INVALID")
    return {
        "universe_number": manifest["universe_number"],
        "title": manifest["title"],
        "job_id": job["job_id"],
        "job_id_short": _short_job_id(job["job_id"]),
        "status": job["status"],
        "backend": job["backend"],
        "shots": job["shots"],
        "qpu_usage_seconds": job.get("qpu_usage_seconds"),
        "submitted_at_utc": job["submitted_at_utc"],
        "completed_at_utc": job["completed_at_utc"],
        "runtime_raw_sha256": runtime_hash,
        "canonical_raw_sha256": canonical_hash,
        "accepted_entropy_sha256": entropy_hash,
        "universe_commitment": expected_commitment,
        "manifest_sha256": ledger["manifest.json"],
        "evidence_path": f"evidence/{directory.name}",
    }


def _current_attempt(directory: Path) -> dict[str, Any] | None:
    manifest, _ = _load_state(directory)
    if manifest.get("pending_submission_intent") is not None:
        raise CampaignEvidenceError("AMBIGUOUS_SUBMISSION_REQUIRES_RECONCILIATION")
    attempts = manifest.get("attempts")
    return attempts[-1] if isinstance(attempts, list) and attempts else None


def _submit_attempt(
    directory: Path,
    *,
    service: Any,
    backend: Any,
    preflight: CampaignPreflight,
    attempt_number: int,
    provider: Any | None = None,
) -> dict[str, Any]:
    provider = provider or IbmRuntimeProvider()
    universe_number = _read_json(directory / "manifest.json")["universe_number"]
    execution = IbmRealExecution(
        preflight=IbmOpenPlanPreflight(
            status=OpenPlanPreflightStatus.AUTHENTICATED_OPEN_PLAN,
            channel=_CHANNEL,
            region="us-east",
            open_plan_confirmed=True,
        ),
        service=service,
        backend=backend,
        backend_name=preflight.backend_name,
        backend_version=preflight.backend_version,
    )
    _record_submission_intent(directory, attempt_number=attempt_number)
    _sync_operator_state(directory.parent, universe_number)
    submitted = None
    try:
        submitted = provider.submit_sampler_job(
            execution,
            entropy_qubits=_ENTROPY_QUBITS,
            shots=_SHOTS,
            transpiler_seed=None,
            max_execution_time=_MAX_EXECUTION_TIME_SECONDS,
        )
        _record_submission(directory, submitted, attempt_number=attempt_number)
        _sync_operator_state(directory.parent, universe_number)
    except Exception as error:
        returned_job_id = submitted.job_id if submitted is not None else None
        _record_submission_error(
            directory,
            attempt_number=attempt_number,
            returned_job_id=returned_job_id,
        )
        _sync_operator_state(directory.parent, universe_number)
        raise CampaignEvidenceError("SAMPLER_SUBMISSION_FAILED") from error
    print(
        canonical_json_bytes(
            {
                "universe_number": universe_number,
                "job_id_short": _short_job_id(submitted.job_id),
                "backend": submitted.backend,
                "status": "SUBMITTED",
            }
        ).decode("utf-8"),
        flush=True,
    )
    return _current_attempt(directory) or {}


def _poll_attempt_once(
    directory: Path,
    *,
    service: Any,
    provider: Any | None = None,
) -> tuple[str, dict[str, Any] | None]:
    provider = provider or IbmRuntimeProvider()
    universe_number = _read_json(directory / "manifest.json")["universe_number"]
    attempt = _current_attempt(directory)
    if attempt is None:
        raise CampaignEvidenceError("SUBMITTED_ATTEMPT_MISSING")
    job_id = attempt["job_id"]
    try:
        job = service.job(job_id)
        status = provider.job_status(job)
    except Exception as error:
        raise CampaignEvidenceError("JOB_STATUS_UNAVAILABLE") from error
    if status != attempt["status"]:
        _update_status(directory, job_id, status)
        _sync_operator_state(directory.parent, universe_number)
        _print_event(
            "SAMPLER_STATUS",
            universe_number=universe_number,
            job_id_short=_short_job_id(job_id),
            status=status,
        )
    if status == "DONE":
        try:
            result = provider.job_result(job)
        except Exception as error:
            raise CampaignEvidenceError("RESULT_RETRIEVAL_FAILED") from error
        summary = _record_completed_result(directory, job=job, result=result)
        _sync_operator_state(directory.parent, universe_number)
        return "DONE", summary
    if status in _TERMINAL_FAILURES:
        _sync_operator_state(directory.parent, universe_number)
    return status, None


def _wait_for_attempt(
    directory: Path,
    *,
    service: Any,
    poll_interval_seconds: int,
    deadline: float,
    provider: Any | None = None,
) -> tuple[str, dict[str, Any] | None]:
    provider = provider or IbmRuntimeProvider()
    while time.monotonic() < deadline:
        status, summary = _poll_attempt_once(
            directory,
            service=service,
            provider=provider,
        )
        if status == "DONE" or status in _TERMINAL_FAILURES:
            return status, summary
        time.sleep(poll_interval_seconds)
    raise CampaignEvidenceError("WAIT_WINDOW_EXPIRED")


def _completed_universe_count(evidence_root: Path) -> int:
    count = 0
    for universe_number in _UNIVERSES:
        directory = _universe_directory(evidence_root, universe_number)
        if directory.is_dir():
            try:
                _verify_universe_directory(directory)
            except CampaignEvidenceError:
                continue
            count += 1
    return count


def _write_campaign_index(evidence_root: Path, summaries: list[dict[str, Any]]) -> str:
    completed_at = max(str(item["completed_at_utc"]) for item in summaries)
    index = {
        "schema_version": 1,
        "campaign_id": _CAMPAIGN_ID,
        "state": "EVIDENCE_ACQUIRED",
        "hardware_execution_count": 5,
        "completed_at_utc": completed_at,
        "board_generation_started": False,
        "scientific_statement": (
            "Each COLAPSO universe was compiled from a separately submitted and preserved "
            "IBM Quantum hardware execution."
        ),
        "scientific_limitation": (
            "The executions may share a backend and circuit family. The project describes them "
            "as separate hardware workloads and does not claim statistical independence beyond "
            "the preserved execution records."
        ),
        "claims_excluded": [
            "quantum advantage",
            "statistical independence proved solely by separate Job IDs",
        ],
        "shared_estimator_provenance": {
            "job_id": _UNIVERSE_ONE_ESTIMATOR_JOB,
            "backend": _BACKEND_NAME,
            "role": "SHARED_CHSH_SCIENTIFIC_PROVENANCE",
        },
        "universes": [
            {
                "universe_number": 1,
                "state": "PRESERVED_EXISTING_EVIDENCE",
                "sampler_job_id": _UNIVERSE_ONE_SAMPLER_JOB,
                "backend": _BACKEND_NAME,
                "evidence_path": _UNIVERSE_ONE_RUN,
                "manifest_sha256": _UNIVERSE_ONE_BASELINE["manifest.json"],
            },
            *[
                {
                    "universe_number": item["universe_number"],
                    "title": item["title"],
                    "state": "EVIDENCE_ACQUIRED",
                    "sampler_job_id": item["job_id"],
                    "backend": item["backend"],
                    "evidence_path": f"universe-{item['universe_number']:03d}",
                    "manifest_sha256": item["manifest_sha256"],
                    "runtime_raw_sha256": item["runtime_raw_sha256"],
                    "accepted_entropy_sha256": item["accepted_entropy_sha256"],
                    "universe_commitment": item["universe_commitment"],
                }
                for item in sorted(summaries, key=lambda value: value["universe_number"])
            ],
        ],
    }
    index_path = evidence_root / "campaign-index.json"
    index_hash = _write_json_once(index_path, index)
    sidecar = evidence_root / "campaign-index.sha256"
    expected = f"{index_hash}  campaign-index.json\n".encode("ascii")
    if sidecar.exists() and sidecar.read_bytes() != expected:
        raise CampaignEvidenceError("CAMPAIGN_INDEX_SIDECAR_MISMATCH")
    if not sidecar.exists():
        _write_bytes_atomically(sidecar, expected)
    return index_hash


def _operator_entries(evidence_root: Path) -> dict[int, dict[str, Any]]:
    state = _load_operator_state(evidence_root, create=False)
    return {
        universe_number: _operator_state_entry(state, universe_number)
        for universe_number in _UNIVERSES
    }


def _verify_preserved_operator_entry(
    entry: Mapping[str, Any], summary: Mapping[str, Any]
) -> None:
    if (
        entry.get("current_status") != "DONE"
        or entry.get("result_preserved") is not True
        or entry.get("job_id") != summary.get("job_id")
        or entry.get("backend") != summary.get("backend")
        or entry.get("submission_timestamp") != summary.get("submitted_at_utc")
    ):
        raise CampaignEvidenceError("CAMPAIGN_OPERATOR_STATE_NOT_COMPLETE")


def _verify_pending_universe_five(
    evidence_root: Path, operator_entry: Mapping[str, Any]
) -> dict[str, Any]:
    directory = _universe_directory(evidence_root, 5)
    required_files = {"manifest.json", "preflight.json", "submission.json", "SHA256SUMS"}
    present_files = {path.name for path in directory.iterdir() if path.is_file()}
    if present_files != required_files:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_INVENTORY_INVALID")
    ledger = _read_ledger(directory)
    required_json = required_files - {"SHA256SUMS"}
    if set(ledger) != required_json:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_LEDGER_INVALID")
    for name, expected in ledger.items():
        if sha256_file(directory / name) != expected:
            raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_HASH_MISMATCH")
        _read_json(directory / name)

    manifest, submission = _load_state(directory)
    identity_valid = (
        manifest.get("campaign_id") == _CAMPAIGN_ID
        and manifest.get("universe_number") == 5
        and manifest.get("title") == _UNIVERSES[5]
        and manifest.get("mode") == "REAL"
        and manifest.get("hardware_execution") == "SEPARATE_RUNTIME_JOB"
        and submission.get("campaign_id") == _CAMPAIGN_ID
        and submission.get("universe_number") == 5
        and submission.get("title") == _UNIVERSES[5]
        and submission.get("primitive") == "SamplerV2"
        and submission.get("shots") == _SHOTS
        and submission.get("sampler_publications")
        == ["ENTROPY_HARVEST", "BELL_CORRELATION"]
    )
    explicitly_pending = (
        operator_entry.get("current_status") != "DONE"
        and operator_entry.get("result_preserved") is False
        and manifest.get("state") != "COMPLETE"
        and manifest.get("artifacts") == {}
        and manifest.get("board_generation_started") is False
    )
    if not identity_valid or not explicitly_pending:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_STATE_INVALID")

    attempts = manifest.get("attempts")
    if not isinstance(attempts, list) or len(attempts) > 2:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_ATTEMPTS_INVALID")
    for index, attempt in enumerate(attempts, start=1):
        if (
            not isinstance(attempt, Mapping)
            or attempt.get("attempt") != index
            or attempt.get("status") == "DONE"
            or _JOB_ID.fullmatch(str(attempt.get("job_id", ""))) is None
            or attempt.get("backend") != _BACKEND_NAME
            or attempt.get("shots") != _SHOTS
        ):
            raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_ATTEMPTS_INVALID")
    if len(attempts) == 2 and attempts[0].get("status") not in _TERMINAL_FAILURES:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_ATTEMPTS_INVALID")

    pending_intent = manifest.get("pending_submission_intent")
    if pending_intent is not None:
        linkage_valid = (
            operator_entry.get("current_status") == "SUBMISSION_IN_PROGRESS"
            and manifest.get("state") == "SUBMISSION_IN_PROGRESS"
            and (
                not attempts
                or operator_entry.get("job_id") == attempts[-1].get("job_id")
            )
        )
    elif attempts:
        current = attempts[-1]
        linkage_valid = (
            operator_entry.get("job_id") == current.get("job_id")
            and operator_entry.get("submission_timestamp")
            == current.get("submitted_at_utc")
            and operator_entry.get("current_status") == current.get("status")
            and manifest.get("state") == current.get("status")
        )
    else:
        linkage_valid = (
            operator_entry.get("job_id") is None
            and operator_entry.get("submission_timestamp") is None
            and operator_entry.get("current_status") == "NOT_SUBMITTED"
        )
    if not linkage_valid:
        raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING_LINKAGE_INVALID")

    job_id = operator_entry.get("job_id")
    return {
        "universe_number": 5,
        "title": _UNIVERSES[5],
        "status": "PENDING",
        "operator_status": operator_entry["current_status"],
        "manifest_state": manifest["state"],
        "result_preserved": False,
        "artifacts_empty": True,
        "board_generation_started": False,
        "job_id_short": _short_job_id(job_id) if isinstance(job_id, str) else None,
        "evidence_path": "evidence/universe-005",
    }


def _complete_campaign_verification(
    evidence_root: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    _verify_universe_one(evidence_root)
    operator_entries = _operator_entries(evidence_root)
    for universe_number in _UNIVERSES:
        entry = operator_entries[universe_number]
        if entry.get("current_status") != "DONE" or entry.get("result_preserved") is not True:
            if (
                universe_number == 5
                and entry.get("current_status") != "DONE"
                and entry.get("result_preserved") is False
            ):
                raise CampaignEvidenceError("UNIVERSE_FIVE_PENDING")
            raise CampaignEvidenceError("CAMPAIGN_OPERATOR_STATE_NOT_COMPLETE")

    summaries = [
        _verify_universe_directory(_universe_directory(evidence_root, universe_number))
        for universe_number in _UNIVERSES
    ]
    for summary in summaries:
        _verify_preserved_operator_entry(
            operator_entries[summary["universe_number"]], summary
        )
    job_ids = {_UNIVERSE_ONE_SAMPLER_JOB, *(item["job_id"] for item in summaries)}
    raw_hashes = {item["runtime_raw_sha256"] for item in summaries}
    if len(job_ids) != 5:
        raise CampaignEvidenceError("CAMPAIGN_JOB_IDS_NOT_DISTINCT")
    if len(raw_hashes) != 4:
        raise CampaignEvidenceError("CAMPAIGN_RAW_RESULTS_NOT_DISTINCT")
    report = {
        "status": "PASS",
        "campaign_id": _CAMPAIGN_ID,
        "campaign_state": "COMPLETE",
        "hardware_execution_count": 5,
        "new_sampler_jobs": 4,
        "distinct_job_ids": 5,
        "distinct_new_raw_results": 4,
        "universe_one_byte_identical": True,
        "board_generation_started": False,
        "campaign_index_ready": True,
        "universes": [
            {key: value for key, value in item.items() if key != "job_id"}
            for item in summaries
        ],
    }
    return report, summaries


def verify_campaign(evidence_root: Path) -> dict[str, Any]:
    report, _ = _complete_campaign_verification(evidence_root)
    return report


def verify_available_campaign(evidence_root: Path) -> dict[str, Any]:
    _verify_universe_one(evidence_root)
    operator_entries = _operator_entries(evidence_root)
    summaries = [
        _verify_universe_directory(_universe_directory(evidence_root, universe_number))
        for universe_number in (2, 3, 4)
    ]
    for summary in summaries:
        _verify_preserved_operator_entry(
            operator_entries[summary["universe_number"]], summary
        )
    pending = _verify_pending_universe_five(evidence_root, operator_entries[5])

    recorded_job_ids = [
        _UNIVERSE_ONE_SAMPLER_JOB,
        *(item["job_id"] for item in summaries),
    ]
    pending_job_id = operator_entries[5].get("job_id")
    if isinstance(pending_job_id, str):
        recorded_job_ids.append(pending_job_id)
    if len(set(recorded_job_ids)) != len(recorded_job_ids):
        raise CampaignEvidenceError("CAMPAIGN_JOB_IDS_NOT_DISTINCT")
    if len({item["runtime_raw_sha256"] for item in summaries}) != 3:
        raise CampaignEvidenceError("CAMPAIGN_RAW_RESULTS_NOT_DISTINCT")

    return {
        "status": "PASS",
        "campaign_id": _CAMPAIGN_ID,
        "campaign_state": "AVAILABLE_WITH_UNIVERSE_FIVE_PENDING",
        "preserved_hardware_execution_count": 4,
        "preserved_new_sampler_jobs": 3,
        "distinct_recorded_job_ids": len(recorded_job_ids),
        "distinct_preserved_new_raw_results": 3,
        "universe_one_byte_identical": True,
        "board_generation_started": False,
        "preserved_universes": [
            {key: value for key, value in item.items() if key != "job_id"}
            for item in summaries
        ],
        "pending_universe": pending,
    }


def finalize_campaign_offline(evidence_root: Path) -> dict[str, Any]:
    report, summaries = _complete_campaign_verification(evidence_root)
    index_hash = _write_campaign_index(evidence_root, summaries)
    return {
        **report,
        "finalized": True,
        "campaign_index_sha256": index_hash,
    }


def _live_preflight(
    credentials_file: str,
    account_name: str,
    *,
    planned_jobs: int,
    service_factory: Callable[..., Any] | None = None,
) -> tuple[Any, CampaignPreflight, Any]:
    service = _create_live_service(
        credentials_file,
        account_name,
        service_factory=service_factory,
    )
    preflight, backend = _safe_preflight(service, conservative_jobs=planned_jobs)
    return service, preflight, backend


def run_preflight_only(
    credentials_file: str,
    account_name: str = _ACCOUNT_NAME,
    *,
    service_factory: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    _, preflight, _ = _live_preflight(
        credentials_file,
        account_name,
        planned_jobs=4,
        service_factory=service_factory,
    )
    return preflight.as_operator_report()


def _print_operator_preflight(preflight: CampaignPreflight) -> None:
    print(canonical_json_bytes(preflight.as_operator_report()).decode("utf-8"), flush=True)


@_locked_campaign_operation
def submit_next_universe(
    evidence_root: Path,
    credentials_file: str,
    account_name: str = _ACCOUNT_NAME,
    *,
    confirmed: bool,
    service_factory: Callable[..., Any] | None = None,
    provider: Any | None = None,
) -> dict[str, Any]:
    _verify_universe_one(evidence_root)
    if not confirmed:
        raise CampaignEvidenceError("EXPLICIT_HARDWARE_CONFIRMATION_REQUIRED")
    service, preflight, backend = _live_preflight(
        credentials_file,
        account_name,
        planned_jobs=4,
        service_factory=service_factory,
    )
    _print_operator_preflight(preflight)
    state = _sync_all_operator_state(evidence_root)
    for entry in state["universes"]:
        if entry["job_id"] is None:
            continue
        if entry["result_preserved"]:
            continue
        if entry["current_status"] in _TERMINAL_FAILURES:
            raise CampaignEvidenceError("FAILED_UNIVERSE_REQUIRES_RESUME")
        raise CampaignEvidenceError("EXISTING_JOB_REQUIRES_RESUME")
    candidates = [entry for entry in state["universes"] if entry["job_id"] is None]
    if not candidates:
        raise CampaignEvidenceError("ALL_CAMPAIGN_JOBS_ALREADY_SUBMITTED")
    universe_number = candidates[0]["universe_number"]
    directory = _prepare_universe(evidence_root, universe_number, preflight)
    if _current_attempt(directory) is not None:
        _sync_operator_state(evidence_root, universe_number)
        raise CampaignEvidenceError("EXISTING_JOB_REQUIRES_RESUME")
    return _submit_attempt(
        directory,
        service=service,
        backend=backend,
        preflight=preflight,
        attempt_number=1,
        provider=provider,
    )


@_locked_campaign_operation
def resume_existing_universe(
    evidence_root: Path,
    credentials_file: str,
    account_name: str = _ACCOUNT_NAME,
    *,
    confirmed: bool,
    poll_interval_seconds: int,
    max_wait_hours: float,
    service_factory: Callable[..., Any] | None = None,
    provider: Any | None = None,
) -> dict[str, Any]:
    _verify_universe_one(evidence_root)
    state = _sync_all_operator_state(evidence_root)
    pending_entries = [
        entry
        for entry in state["universes"]
        if entry["job_id"] is not None and not entry["result_preserved"]
    ]
    if not pending_entries:
        raise CampaignEvidenceError("NO_EXISTING_JOB_TO_RESUME")
    entry = pending_entries[0]
    universe_number = entry["universe_number"]
    directory = _universe_directory(evidence_root, universe_number)
    current = _current_attempt(directory)
    if current is None:
        raise CampaignEvidenceError("ACQUISITION_STATE_JOB_MISMATCH")
    if current["status"] in _TERMINAL_FAILURES:
        if len(_read_json(directory / "manifest.json")["attempts"]) >= 2:
            raise CampaignEvidenceError("HARDWARE_JOB_FAILED")
        if not confirmed:
            raise CampaignEvidenceError("EXPLICIT_RETRY_CONFIRMATION_REQUIRED")
        service, preflight, backend = _live_preflight(
            credentials_file,
            account_name,
            planned_jobs=4,
            service_factory=service_factory,
        )
        _print_operator_preflight(preflight)
        return _submit_attempt(
            directory,
            service=service,
            backend=backend,
            preflight=preflight,
            attempt_number=2,
            provider=provider,
        )
    service = _create_live_service(
        credentials_file,
        account_name,
        service_factory=service_factory,
    )
    deadline = time.monotonic() + max_wait_hours * 3600
    status, summary = _wait_for_attempt(
        directory,
        service=service,
        poll_interval_seconds=poll_interval_seconds,
        deadline=deadline,
        provider=provider,
    )
    if status in _TERMINAL_FAILURES:
        raise CampaignEvidenceError("FAILED_UNIVERSE_REQUIRES_CONFIRMED_RESUME")
    if status != "DONE" or summary is None:
        raise CampaignEvidenceError("JOB_NOT_COMPLETE")
    _print_event(
        "EVIDENCE_PRESERVED",
        universe_number=universe_number,
        job_id_short=summary["job_id_short"],
        runtime_raw_sha256=summary["runtime_raw_sha256"],
        accepted_entropy_sha256=summary["accepted_entropy_sha256"],
    )
    if _completed_universe_count(evidence_root) == len(_UNIVERSES):
        finalize_campaign_offline(evidence_root)
    return summary


@_locked_campaign_operation
def poll_existing_jobs_once(
    evidence_root: Path,
    credentials_file: str,
    account_name: str = _ACCOUNT_NAME,
    *,
    service_factory: Callable[..., Any] | None = None,
    provider: Any | None = None,
) -> dict[str, Any]:
    _verify_universe_one(evidence_root)
    _load_operator_state(evidence_root, create=False)
    state = _sync_all_operator_state(evidence_root)
    service = _create_live_service(
        credentials_file,
        account_name,
        service_factory=service_factory,
    )
    jobs: list[dict[str, Any]] = []
    for entry in state["universes"]:
        if entry["job_id"] is None or entry["result_preserved"]:
            continue
        universe_number = entry["universe_number"]
        directory = _universe_directory(evidence_root, universe_number)
        status, summary = _poll_attempt_once(
            directory,
            service=service,
            provider=provider,
        )
        jobs.append(
            {
                "universe_number": universe_number,
                "job_id_short": _short_job_id(entry["job_id"]),
                "status": status,
                "result_preserved": summary is not None,
            }
        )
    if _completed_universe_count(evidence_root) == len(_UNIVERSES):
        finalize_campaign_offline(evidence_root)
    return {"poll_only": True, "jobs": jobs}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="colapso-campaign-evidence",
        description="Operator-only sequential IBM campaign evidence workflow.",
    )
    parser.add_argument(
        "--evidence-root",
        type=Path,
        default=_repository_evidence_root(),
    )
    parser.add_argument("--credentials-file")
    parser.add_argument("--account-name", default=_ACCOUNT_NAME)
    parser.add_argument("--poll-interval-seconds", type=int, default=60)
    parser.add_argument("--max-wait-hours", type=float, default=72.0)
    parser.add_argument(
        "--confirm-hardware-submission",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--preflight-only", action="store_true")
    actions.add_argument("--submit", action="store_true")
    actions.add_argument("--resume", action="store_true")
    actions.add_argument("--poll-only", action="store_true")
    actions.add_argument("--verify-offline", action="store_true")
    actions.add_argument("--verify-available-offline", action="store_true")
    actions.add_argument("--finalize-offline", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.verify_offline:
            report = verify_campaign(args.evidence_root)
            print(canonical_json_bytes(report).decode("utf-8"))
            return 0
        if args.verify_available_offline:
            report = verify_available_campaign(args.evidence_root)
            print(canonical_json_bytes(report).decode("utf-8"))
            return 0
        if args.finalize_offline:
            report = finalize_campaign_offline(args.evidence_root)
            print(canonical_json_bytes(report).decode("utf-8"))
            return 0
        if not args.credentials_file:
            raise CampaignEvidenceError("CREDENTIAL_FILE_REQUIRED")
        if not 30 <= args.poll_interval_seconds <= 300:
            raise CampaignEvidenceError("POLL_INTERVAL_OUT_OF_RANGE")
        if not 1 <= args.max_wait_hours <= 168:
            raise CampaignEvidenceError("WAIT_WINDOW_OUT_OF_RANGE")
        logging.disable(logging.CRITICAL)
        warnings.filterwarnings("ignore")
        if args.preflight_only:
            report = run_preflight_only(args.credentials_file, args.account_name)
            print(canonical_json_bytes(report).decode("utf-8"), flush=True)
            return 0
        if args.submit:
            submit_next_universe(
                args.evidence_root,
                args.credentials_file,
                args.account_name,
                confirmed=args.confirm_hardware_submission,
            )
            return 0
        if args.resume:
            resume_existing_universe(
                args.evidence_root,
                args.credentials_file,
                args.account_name,
                confirmed=args.confirm_hardware_submission,
                poll_interval_seconds=args.poll_interval_seconds,
                max_wait_hours=args.max_wait_hours,
            )
            return 0
        report = poll_existing_jobs_once(
            args.evidence_root,
            args.credentials_file,
            args.account_name,
        )
        print(canonical_json_bytes(report).decode("utf-8"), flush=True)
        return 0
    except CampaignEvidenceError as error:
        print(
            canonical_json_bytes(
                {"status": "BLOCKED", "safe_error_code": error.code}
            ).decode("utf-8")
        )
        return 2
    except Exception:
        print(
            canonical_json_bytes(
                {"status": "BLOCKED", "safe_error_code": "UNEXPECTED_SAFE_FAILURE"}
            ).decode("utf-8")
        )
        return 3


if __name__ == "__main__":
    sys.exit(main())
