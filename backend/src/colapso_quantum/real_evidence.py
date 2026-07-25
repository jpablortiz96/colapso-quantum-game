"""Separate, raw-first persistence for the bounded F2B real IBM evidence run."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .evidence import canonical_json_bytes, sha256_file

_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
_RESULT_FILE = re.compile(r"^[a-z][a-z0-9-]{1,47}-(?:raw|derived)\.json$")
_SECRET_KEY = re.compile(r"(?:token|secret|authorization|password|api[_-]?key|cookie)", re.I)
_PLANNED_ROLES = ("SAMPLER_ENTROPY_BELL", "ESTIMATOR_CHSH")
_TERMINAL_FAILURES = {"CANCELLED", "ERROR", "FAILED"}
_VALID_STATES = {"PREPARED", "SUBMITTED", "PARTIAL", "PARTIAL_RESULTS_PRESERVED", "COMPLETE"}


class RealEvidenceError(ValueError):
    """A deterministic local-evidence error that contains no provider payload."""


@dataclass(frozen=True)
class RealEvidencePackage:
    """The latest immutable-on-disk state of a single real-hardware run."""

    path: Path
    manifest: Mapping[str, Any]


def _utc_text(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise RealEvidenceError("timestamps must include a UTC offset")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_utc(value: object) -> datetime:
    if not isinstance(value, str):
        raise RealEvidenceError("stored timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise RealEvidenceError("stored timestamp must include a UTC offset")
    return parsed.astimezone(UTC)


def _safe_directory(evidence_root: Path, run_id: str) -> Path:
    if _RUN_ID.fullmatch(run_id) is None:
        raise RealEvidenceError("run_id must be a lowercase safe provenance identifier")
    root = evidence_root.resolve()
    destination = (root / "runs" / "real" / run_id).resolve()
    if root not in destination.parents:
        raise RealEvidenceError("real evidence must remain below the evidence root")
    return destination


def _reject_secret_keys(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if not isinstance(key, str):
                raise RealEvidenceError("evidence object keys must be strings")
            if _SECRET_KEY.search(key):
                raise RealEvidenceError("real evidence may not contain secret-bearing keys")
            _reject_secret_keys(nested)
    elif isinstance(value, (tuple, list)):
        for nested in value:
            _reject_secret_keys(nested)


def _write_bytes_atomically(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def _write_json(path: Path, value: Any) -> str:
    _reject_secret_keys(value)
    _write_bytes_atomically(path, canonical_json_bytes(value))
    return sha256_file(path)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RealEvidenceError("real evidence JSON is unreadable") from error
    if not isinstance(value, dict):
        raise RealEvidenceError("real evidence JSON must contain an object")
    return value


def _write_sha256sums(directory: Path) -> None:
    files = sorted(
        path for path in directory.iterdir() if path.is_file() and path.suffix == ".json"
    )
    lines = [f"{sha256_file(path)}  {path.name}" for path in files]
    _write_bytes_atomically(directory / "SHA256SUMS", ("\n".join(lines) + "\n").encode("ascii"))


def _read_sha256sums(directory: Path) -> dict[str, str]:
    try:
        lines = (directory / "SHA256SUMS").read_text("ascii").splitlines()
    except OSError as error:
        raise RealEvidenceError("SHA256SUMS is missing") from error
    sums: dict[str, str] = {}
    for line in lines:
        digest, separator, name = line.partition("  ")
        if separator != "  " or re.fullmatch(r"[a-f0-9]{64}", digest) is None:
            raise RealEvidenceError("SHA256SUMS has an invalid line")
        if not name.endswith(".json") or "/" in name or "\\" in name or name in sums:
            raise RealEvidenceError("SHA256SUMS has an unsafe file name")
        sums[name] = digest
    return sums


def _manifest_state(manifest: Mapping[str, Any]) -> str:
    jobs = manifest.get("jobs")
    errors = manifest.get("submission_errors", [])
    preservation_errors = manifest.get("result_preservation_errors", [])
    if (
        not isinstance(jobs, list)
        or not isinstance(errors, list)
        or not isinstance(preservation_errors, list)
    ):
        raise RealEvidenceError("manifest jobs and error lists must be lists")
    by_role = {
        item.get("role"): item
        for item in jobs
        if isinstance(item, Mapping) and isinstance(item.get("role"), str)
    }
    complete = all(
        role in by_role
        and by_role[role].get("status") == "DONE"
        and isinstance(by_role[role].get("retrieved_at_utc"), str)
        for role in _PLANNED_ROLES
    )
    if preservation_errors:
        return "PARTIAL_RESULTS_PRESERVED"
    if complete:
        return "COMPLETE"
    if errors or any(
        item.get("status") in _TERMINAL_FAILURES
        for item in jobs
        if isinstance(item, Mapping)
    ):
        return "PARTIAL"
    if jobs:
        return "SUBMITTED"
    return "PREPARED"


def _provenance_execution_parameters(job: Mapping[str, Any]) -> dict[str, int | float]:
    """Expose only persisted numeric execution settings needed to interpret a completed job."""
    metadata = job.get("submission_metadata")
    if not isinstance(metadata, Mapping):
        return {}
    names = (
        ("shots",)
        if job.get("role") == "SAMPLER_ENTROPY_BELL"
        else ("requested_shots", "requested_precision")
    )
    return {
        name: value
        for name in names
        if isinstance((value := metadata.get(name)), (int, float)) and not isinstance(value, bool)
    }


def _validate_manifest(manifest: Mapping[str, Any]) -> None:
    if manifest.get("schema_version") != 1 or manifest.get("mode") != "REAL":
        raise RealEvidenceError("manifest must be schema 1 and visibly REAL")
    if _RUN_ID.fullmatch(str(manifest.get("run_id", ""))) is None:
        raise RealEvidenceError("manifest run_id is unsafe")
    if manifest.get("state") not in _VALID_STATES:
        raise RealEvidenceError("manifest state is invalid")
    _parse_utc(manifest.get("created_at_utc"))
    _parse_utc(manifest.get("updated_at_utc"))
    if manifest.get("planned_job_roles") != list(_PLANNED_ROLES):
        raise RealEvidenceError("manifest planned-job roles are invalid")
    jobs = manifest.get("jobs")
    if not isinstance(jobs, list) or len(jobs) > len(_PLANNED_ROLES):
        raise RealEvidenceError("manifest job list is invalid")
    roles: set[str] = set()
    for job in jobs:
        if not isinstance(job, dict):
            raise RealEvidenceError("manifest job is invalid")
        role = job.get("role")
        job_id = job.get("job_id")
        if role not in _PLANNED_ROLES or role in roles:
            raise RealEvidenceError("manifest job role is invalid")
        if not isinstance(job_id, str) or not job_id.strip() or len(job_id) > 240:
            raise RealEvidenceError("manifest job identifier is invalid")
        roles.add(role)
        if not isinstance(job.get("poll_count"), int) or not 0 <= job["poll_count"] <= 3:
            raise RealEvidenceError("manifest poll count is invalid")
        for timestamp_name in (
            "submitted_at_utc",
            "first_polled_at_utc",
            "last_polled_at_utc",
            "retrieved_at_utc",
        ):
            timestamp = job.get(timestamp_name)
            if timestamp is not None:
                _parse_utc(timestamp)
    if manifest.get("state") != _manifest_state(manifest):
        raise RealEvidenceError("manifest state does not match persisted job outcomes")
    _reject_secret_keys(manifest)


class RealEvidenceStore:
    """Mutates one bounded real-run directory and refreshes its SHA-256 ledger."""

    def __init__(self, package_directory: Path) -> None:
        self._directory = package_directory

    @property
    def path(self) -> Path:
        return self._directory

    @classmethod
    def create_prepared(
        cls,
        *,
        evidence_root: Path,
        run_id: str,
        created_at_utc: datetime,
        preflight: Mapping[str, Any],
        submission_configuration: Mapping[str, Any],
    ) -> RealEvidenceStore:
        directory = _safe_directory(evidence_root, run_id)
        directory.mkdir(parents=True, exist_ok=False)
        timestamp = _utc_text(created_at_utc)
        manifest = {
            "schema_version": 1,
            "mode": "REAL",
            "run_id": run_id,
            "state": "PREPARED",
            "created_at_utc": timestamp,
            "updated_at_utc": timestamp,
            "planned_job_roles": list(_PLANNED_ROLES),
            "preflight_artifact": "preflight.json",
            "submission_artifact": "submission.json",
            "jobs": [],
            "submission_errors": [],
            "result_preservation_errors": [],
            "runtime_raw_artifacts": {},
            "raw_artifacts": {},
            "derived_artifacts": {},
            "derivation_version": "f2b-real-v1",
        }
        submission = {
            "schema_version": 1,
            "execution_mode": "JOB",
            "maximum_real_jobs": 2,
            "planned_job_roles": list(_PLANNED_ROLES),
            "configuration": dict(submission_configuration),
            "jobs": [],
            "submission_errors": [],
        }
        _validate_manifest(manifest)
        _write_json(directory / "preflight.json", dict(preflight))
        _write_json(directory / "submission.json", submission)
        _write_json(directory / "manifest.json", manifest)
        _write_sha256sums(directory)
        return cls(directory)

    @classmethod
    def open(cls, *, evidence_root: Path, run_id: str) -> RealEvidenceStore:
        store = cls(_safe_directory(evidence_root, run_id))
        store.validate()
        return store

    def manifest(self) -> dict[str, Any]:
        manifest = _read_json(self._directory / "manifest.json")
        _validate_manifest(manifest)
        return manifest

    def package(self) -> RealEvidencePackage:
        return RealEvidencePackage(path=self._directory, manifest=self.manifest())

    def _write_current(self, manifest: dict[str, Any], submission: dict[str, Any]) -> None:
        manifest["state"] = _manifest_state(manifest)
        _validate_manifest(manifest)
        _write_json(self._directory / "submission.json", submission)
        _write_json(self._directory / "manifest.json", manifest)
        _write_sha256sums(self._directory)

    def _documents(self) -> tuple[dict[str, Any], dict[str, Any]]:
        return self.manifest(), _read_json(self._directory / "submission.json")

    @staticmethod
    def _touch(manifest: dict[str, Any], at_utc: datetime) -> str:
        timestamp = _utc_text(at_utc)
        manifest["updated_at_utc"] = timestamp
        return timestamp

    def record_job(
        self,
        *,
        role: str,
        job_id: str,
        backend: str,
        backend_version: str | None,
        primitive: str,
        submission_metadata: Mapping[str, Any],
        submitted_at_utc: datetime,
    ) -> RealEvidencePackage:
        if role not in _PLANNED_ROLES:
            raise RealEvidenceError("job role is not part of the bounded F2B run")
        if not isinstance(job_id, str) or not job_id.strip() or len(job_id) > 240:
            raise RealEvidenceError("provider did not return a usable job identifier")
        manifest, submission = self._documents()
        if any(item["role"] == role for item in manifest["jobs"]):
            raise RealEvidenceError("a submitted role cannot be submitted again")
        if len(manifest["jobs"]) >= 2:
            raise RealEvidenceError("the real-run job limit has already been reached")
        timestamp = self._touch(manifest, submitted_at_utc)
        job = {
            "role": role,
            "job_id": job_id,
            "backend": backend,
            "backend_version": backend_version,
            "primitive": primitive,
            "submission_metadata": dict(submission_metadata),
            "submitted_at_utc": timestamp,
            "status": "SUBMITTED",
            "poll_count": 0,
            "first_polled_at_utc": None,
            "last_polled_at_utc": None,
            "retrieved_at_utc": None,
            "raw_artifacts": [],
            "derived_artifacts": [],
        }
        _reject_secret_keys(job)
        manifest["jobs"].append(job)
        submission["jobs"].append(job)
        self._write_current(manifest, submission)
        return self.package()

    def record_submission_failure(
        self,
        *,
        role: str,
        error_code: str,
        occurred_at_utc: datetime,
    ) -> RealEvidencePackage:
        if role not in _PLANNED_ROLES:
            raise RealEvidenceError("submission failure role is invalid")
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,79}", error_code):
            raise RealEvidenceError("submission failure code is invalid")
        manifest, submission = self._documents()
        failure = {
            "role": role,
            "error_code": error_code,
            "occurred_at_utc": self._touch(manifest, occurred_at_utc),
        }
        manifest["submission_errors"].append(failure)
        submission["submission_errors"].append(failure)
        self._write_current(manifest, submission)
        return self.package()

    def poll_allowed(self, *, job_id: str, at_utc: datetime) -> tuple[bool, str]:
        timestamp = at_utc.astimezone(UTC)
        for job in self.manifest()["jobs"]:
            if job["job_id"] != job_id:
                continue
            if job["status"] in _TERMINAL_FAILURES or job["retrieved_at_utc"] is not None:
                return False, "TERMINAL_OR_RETRIEVED"
            if job["poll_count"] >= 3:
                return False, "POLL_LIMIT_REACHED"
            first = job["first_polled_at_utc"]
            last = job["last_polled_at_utc"]
            if first is not None and (timestamp - _parse_utc(first)).total_seconds() > 300:
                return False, "POLL_WINDOW_EXPIRED"
            if last is not None and (timestamp - _parse_utc(last)).total_seconds() < 30:
                return False, "POLL_INTERVAL_NOT_ELAPSED"
            return True, "ALLOWED"
        raise RealEvidenceError("job identifier is not recorded in this run")

    def record_poll(
        self,
        *,
        job_id: str,
        status: str,
        polled_at_utc: datetime,
    ) -> RealEvidencePackage:
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,79}", status):
            raise RealEvidenceError("provider status is invalid")
        allowed, _ = self.poll_allowed(job_id=job_id, at_utc=polled_at_utc)
        if not allowed:
            raise RealEvidenceError("poll is outside the persisted bounded policy")
        manifest, submission = self._documents()
        timestamp = self._touch(manifest, polled_at_utc)
        for document in (manifest, submission):
            for job in document["jobs"]:
                if job["job_id"] == job_id:
                    job["status"] = status
                    job["poll_count"] += 1
                    if job["first_polled_at_utc"] is None:
                        job["first_polled_at_utc"] = timestamp
                    job["last_polled_at_utc"] = timestamp
        self._write_current(manifest, submission)
        return self.package()

    def record_result(
        self,
        *,
        job_id: str,
        raw_filename: str,
        raw_document: Mapping[str, Any],
        derived_documents: Mapping[str, Mapping[str, Any]],
        retrieved_at_utc: datetime,
    ) -> RealEvidencePackage:
        if _RESULT_FILE.fullmatch(raw_filename) is None or not raw_filename.endswith("-raw.json"):
            raise RealEvidenceError("raw result filename is invalid")
        if not derived_documents or any(
            _RESULT_FILE.fullmatch(name) is None or not name.endswith("-derived.json")
            for name in derived_documents
        ):
            raise RealEvidenceError("derived result filenames are invalid")
        manifest, submission = self._documents()
        matching = [job for job in manifest["jobs"] if job["job_id"] == job_id]
        if len(matching) != 1:
            raise RealEvidenceError("result job identifier is not recorded exactly once")
        if matching[0]["retrieved_at_utc"] is not None:
            raise RealEvidenceError("a job result cannot be persisted twice")
        for filename in (raw_filename, *derived_documents):
            if (self._directory / filename).exists():
                raise RealEvidenceError("result artifact already exists")
        raw_hash = _write_json(self._directory / raw_filename, dict(raw_document))
        derived_hashes = {
            name: _write_json(self._directory / name, dict(document))
            for name, document in derived_documents.items()
        }
        manifest["raw_artifacts"][raw_filename] = raw_hash
        manifest["derived_artifacts"].update(derived_hashes)
        timestamp = self._touch(manifest, retrieved_at_utc)
        for document in (manifest, submission):
            for job in document["jobs"]:
                if job["job_id"] == job_id:
                    job["status"] = "DONE"
                    job["retrieved_at_utc"] = timestamp
                    job["raw_artifacts"] = [raw_filename]
                    job["derived_artifacts"] = list(derived_documents)
        self._write_current(manifest, submission)
        return self.package()

    @staticmethod
    def _write_runtime_json(path: Path, result: Any) -> str:
        """Persist the provider object verbatim through Qiskit's supported RuntimeEncoder."""
        from qiskit_ibm_runtime import RuntimeEncoder

        temporary = path.with_suffix(f"{path.suffix}.tmp")
        with temporary.open("w", encoding="utf-8", newline="\n") as output:
            json.dump(
                result,
                output,
                cls=RuntimeEncoder,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
        return sha256_file(path)

    def record_runtime_raw(
        self,
        *,
        job_id: str,
        raw_filename: str,
        result: Any,
        retrieved_at_utc: datetime,
    ) -> str:
        """Write the original Runtime V2 result before any structural inspection or parsing."""
        expected_filenames = {
            "SAMPLER_ENTROPY_BELL": "sampler-runtime-raw.json",
            "ESTIMATOR_CHSH": "estimator-runtime-raw.json",
        }
        manifest, submission = self._documents()
        matching = [job for job in manifest["jobs"] if job["job_id"] == job_id]
        if len(matching) != 1 or expected_filenames.get(matching[0]["role"]) != raw_filename:
            raise RealEvidenceError("runtime raw artifact does not match a persisted job role")
        if matching[0].get("runtime_raw_artifact") is not None or (self._directory / raw_filename).exists():
            raise RealEvidenceError("runtime raw result is already persisted")
        raw_hash = self._write_runtime_json(self._directory / raw_filename, result)
        manifest.setdefault("runtime_raw_artifacts", {})[raw_filename] = raw_hash
        self._touch(manifest, retrieved_at_utc)
        for document in (manifest, submission):
            for job in document["jobs"]:
                if job["job_id"] == job_id:
                    job["runtime_raw_artifact"] = raw_filename
                    job["runtime_raw_sha256"] = raw_hash
                    job["raw_artifacts"] = [raw_filename]
        self._write_current(manifest, submission)
        return raw_hash

    def record_parsed_result(
        self,
        *,
        job_id: str,
        derived_documents: Mapping[str, Mapping[str, Any]],
        retrieved_at_utc: datetime,
    ) -> RealEvidencePackage:
        """Persist structural and derived records only after the RuntimeEncoder raw file exists."""
        if not derived_documents or any(_RESULT_FILE.fullmatch(name) is None for name in derived_documents):
            raise RealEvidenceError("derived result filenames are invalid")
        manifest, submission = self._documents()
        matching = [job for job in manifest["jobs"] if job["job_id"] == job_id]
        if len(matching) != 1 or matching[0].get("runtime_raw_artifact") is None:
            raise RealEvidenceError("parsed results require persisted runtime raw evidence")
        if matching[0]["retrieved_at_utc"] is not None:
            raise RealEvidenceError("a job result cannot be persisted twice")
        if any((self._directory / name).exists() for name in derived_documents):
            raise RealEvidenceError("derived result artifact already exists")
        hashes = {
            name: _write_json(self._directory / name, dict(document))
            for name, document in derived_documents.items()
        }
        manifest["derived_artifacts"].update(hashes)
        timestamp = self._touch(manifest, retrieved_at_utc)
        for document in (manifest, submission):
            for job in document["jobs"]:
                if job["job_id"] == job_id:
                    job["status"] = "DONE"
                    job["retrieved_at_utc"] = timestamp
                    job["derived_artifacts"] = list(derived_documents)
        self._write_current(manifest, submission)
        return self.package()

    def record_result_structure(
        self,
        *,
        structure_document: Mapping[str, Any],
        recorded_at_utc: datetime,
    ) -> RealEvidencePackage:
        """Store the compact V2 shape inventory separately from the verbatim Runtime raw files."""
        filename = "result-structure.json"
        manifest, submission = self._documents()
        if (self._directory / filename).exists():
            raise RealEvidenceError("result structure is already persisted")
        structure_hash = _write_json(self._directory / filename, dict(structure_document))
        manifest["derived_artifacts"][filename] = structure_hash
        manifest["result_structure_artifact"] = filename
        manifest["result_structure_sha256"] = structure_hash
        self._touch(manifest, recorded_at_utc)
        self._write_current(manifest, submission)
        return self.package()

    def record_result_preservation_failure(
        self,
        *,
        job_id: str,
        error_code: str,
        structural_error: str,
        occurred_at_utc: datetime,
    ) -> RealEvidencePackage:
        """Keep already-written Runtime raw evidence when a deterministic V2 parser check fails."""
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{2,79}", error_code):
            raise RealEvidenceError("result preservation error code is invalid")
        if not structural_error or len(structural_error) > 500:
            raise RealEvidenceError("result preservation structural error is invalid")
        manifest, submission = self._documents()
        matching = [job for job in manifest["jobs"] if job["job_id"] == job_id]
        if len(matching) != 1 or matching[0].get("runtime_raw_artifact") is None:
            raise RealEvidenceError("result preservation requires persisted runtime raw evidence")
        entry = {
            "role": matching[0]["role"],
            "error_code": error_code,
            "structural_error": structural_error,
            "occurred_at_utc": self._touch(manifest, occurred_at_utc),
        }
        manifest.setdefault("result_preservation_errors", []).append(entry)
        submission.setdefault("result_preservation_errors", []).append(entry)
        self._write_current(manifest, submission)
        return self.package()

    def record_provenance(
        self,
        *,
        completed_at_utc: datetime,
        details: Mapping[str, Any] | None = None,
        replace_existing: bool = False,
    ) -> RealEvidencePackage:
        """Link completed jobs to their hashes; replacement is explicit and never contacts Runtime."""
        manifest, submission = self._documents()
        if _manifest_state(manifest) != "COMPLETE":
            raise RealEvidenceError("provenance requires both real-job results")
        if manifest.get("provenance_artifact") is not None and not replace_existing:
            raise RealEvidenceError("provenance is already persisted")
        timestamp = self._touch(manifest, completed_at_utc)
        provenance = {
            "schema_version": 1,
            "mode": "REAL",
            "run_id": manifest["run_id"],
            "completed_at_utc": timestamp,
            "backend": {
                "name": manifest["jobs"][0]["backend"],
                "version": manifest["jobs"][0]["backend_version"],
            },
            "jobs": [
                {
                    "role": job["role"],
                    "job_id": job["job_id"],
                    "primitive": job["primitive"],
                    "submitted_at_utc": job["submitted_at_utc"],
                    "retrieved_at_utc": job["retrieved_at_utc"],
                    "raw_artifacts": job["raw_artifacts"],
                    "runtime_raw_artifact": job.get("runtime_raw_artifact"),
                    "runtime_raw_sha256": job.get("runtime_raw_sha256"),
                    "derived_artifacts": job["derived_artifacts"],
                    "derived_artifact_hashes": {
                        artifact: manifest["derived_artifacts"][artifact]
                        for artifact in job["derived_artifacts"]
                    },
                    "execution_parameters": _provenance_execution_parameters(job),
                }
                for job in manifest["jobs"]
            ],
            "interpretation": "RAW_HARDWARE_RESULTS_WITH_CONSERVATIVE_DERIVATIONS",
            "details": dict(details or {}),
        }
        provenance_hash = _write_json(self._directory / "provenance.json", provenance)
        manifest["provenance_artifact"] = "provenance.json"
        manifest["provenance_sha256"] = provenance_hash
        self._write_current(manifest, submission)
        return self.package()

    def validate(self) -> RealEvidencePackage:
        manifest = self.manifest()
        required = {"manifest.json", "preflight.json", "submission.json", "SHA256SUMS"}
        present = {path.name for path in self._directory.iterdir() if path.is_file()}
        if not required.issubset(present):
            raise RealEvidenceError("real evidence package is missing required files")
        sums = _read_sha256sums(self._directory)
        expected_names = {
            path.name
            for path in self._directory.iterdir()
            if path.is_file() and path.suffix == ".json"
        }
        if set(sums) != expected_names:
            raise RealEvidenceError("SHA256SUMS does not exactly cover JSON evidence files")
        for name, expected in sums.items():
            if sha256_file(self._directory / name) != expected:
                raise RealEvidenceError("SHA256SUMS does not match an evidence file")
        runtime_raw_artifacts = manifest.get("runtime_raw_artifacts", {})
        raw_artifacts = manifest.get("raw_artifacts", {})
        derived_artifacts = manifest.get("derived_artifacts", {})
        if (
            not isinstance(runtime_raw_artifacts, dict)
            or not isinstance(raw_artifacts, dict)
            or not isinstance(derived_artifacts, dict)
        ):
            raise RealEvidenceError("manifest artifacts are invalid")
        artifacts = {**runtime_raw_artifacts, **raw_artifacts, **derived_artifacts}
        for name, expected in artifacts.items():
            if not isinstance(name, str) or not isinstance(expected, str):
                raise RealEvidenceError("manifest artifact index is invalid")
            if sums.get(name) != expected:
                raise RealEvidenceError("manifest artifact hash is not in SHA256SUMS")
        if manifest["state"] == "COMPLETE":
            if manifest.get("provenance_artifact") != "provenance.json":
                raise RealEvidenceError("complete real evidence requires provenance.json")
            provenance_hash = manifest.get("provenance_sha256")
            if not isinstance(provenance_hash, str) or sums.get("provenance.json") != provenance_hash:
                raise RealEvidenceError("complete real evidence has invalid provenance linkage")
            _reject_secret_keys(_read_json(self._directory / "provenance.json"))
            if runtime_raw_artifacts:
                expected_runtime_raw = {"sampler-runtime-raw.json", "estimator-runtime-raw.json"}
                expected_derived = {
                    "sampler-raw.json",
                    "estimator-raw.json",
                    "entropy-derived.json",
                    "bell-derived.json",
                    "chsh-derived.json",
                    "result-structure.json",
                }
                if set(runtime_raw_artifacts) != expected_runtime_raw or not expected_derived.issubset(derived_artifacts):
                    raise RealEvidenceError("complete V2 evidence is missing required raw or derived artifacts")
        _reject_secret_keys(_read_json(self._directory / "preflight.json"))
        _reject_secret_keys(_read_json(self._directory / "submission.json"))
        return RealEvidencePackage(path=self._directory, manifest=manifest)
