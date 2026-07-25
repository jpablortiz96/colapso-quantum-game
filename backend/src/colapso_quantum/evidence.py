"""Canonical JSON hashing and safe local evidence-package writing."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .models import EvidenceManifest, QuantumMode, QuantumProvenance

_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")


def _json_default(value: Any) -> Any:
    """Normalize nested contract values that the standard JSON encoder cannot emit."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    raise TypeError(f"{type(value).__name__} is not canonical JSON data")


def canonical_json_bytes(value: Any) -> bytes:
    """Serialize nested contracts as stable, compact UTF-8 JSON bytes."""
    return json.dumps(
        value,
        default=_json_default,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_hex(value: Any) -> str:
    return sha256(canonical_json_bytes(value)).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class EvidencePackage:
    path: Path
    manifest: EvidenceManifest
    file_hashes: Mapping[str, str]


def _safe_package_directory(evidence_root: Path, run_id: str) -> Path:
    if _RUN_ID.fullmatch(run_id) is None:
        raise ValueError("run_id must be a lowercase safe provenance identifier")
    root = evidence_root.resolve()
    destination = (root / "runs" / "simulated" / run_id).resolve()
    if root not in destination.parents:
        raise ValueError("evidence package must remain below the evidence root")
    return destination


def _write_json(path: Path, value: Any) -> str:
    path.write_bytes(canonical_json_bytes(value))
    return sha256_file(path)


def write_evidence_package(
    evidence_root: Path,
    run_id: str,
    created_at_utc: datetime,
    records: Mapping[str, tuple[BaseModel, Mapping[str, Any]]],
) -> EvidencePackage:
    """Persist raw and derived simulated documents before their manifest."""
    if not records:
        raise ValueError("at least one evidence record is required")
    if created_at_utc.tzinfo is None or created_at_utc.utcoffset() is None:
        raise ValueError("created_at_utc must include a UTC offset")
    package_directory = _safe_package_directory(evidence_root, run_id)
    package_directory.mkdir(parents=True, exist_ok=False)

    raw_hashes: dict[str, str] = {}
    derived_hashes: dict[str, str] = {}
    provenances: list[QuantumProvenance] = []
    modes: set[QuantumMode] = set()
    for name, (derived, raw) in records.items():
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,47}", name):
            raise ValueError("record names must be safe lowercase identifiers")
        provenance = getattr(derived, "provenance", None)
        if not isinstance(provenance, QuantumProvenance):
            raise ValueError("every derived record must carry QuantumProvenance")
        raw_name = f"raw-{name}.json"
        derived_name = f"derived-{name}.json"
        raw_hashes[raw_name] = _write_json(package_directory / raw_name, raw)
        derived_hashes[derived_name] = _write_json(
            package_directory / derived_name,
            derived,
        )
        provenances.append(provenance)
        modes.add(provenance.mode)

    if modes != {QuantumMode.SIMULATED}:
        raise ValueError("F2A evidence packages can only contain simulated records")

    manifest_base = {
        "schema_version": 1,
        "run_id": run_id,
        "mode": QuantumMode.SIMULATED,
        "created_at_utc": created_at_utc.astimezone(UTC),
        "provenance": provenances,
        "raw_artifacts": raw_hashes,
        "derived_artifacts": derived_hashes,
    }
    manifest = EvidenceManifest(
        **manifest_base,
        manifest_sha256=sha256_hex(manifest_base),
    )
    manifest_file_hash = _write_json(package_directory / "manifest.json", manifest)
    file_hashes = {**raw_hashes, **derived_hashes, "manifest.json": manifest_file_hash}
    _write_json(package_directory / "hashes.json", file_hashes)
    return EvidencePackage(package_directory, manifest, file_hashes)


def validate_evidence_package(package_directory: Path) -> EvidenceManifest:
    """Validate a committed/generated package without changing it."""
    manifest_path = package_directory / "manifest.json"
    hashes_path = package_directory / "hashes.json"
    manifest = EvidenceManifest.model_validate_json(manifest_path.read_text("utf-8"))
    recorded_file_hashes = json.loads(hashes_path.read_text("utf-8"))
    if not isinstance(recorded_file_hashes, dict):
        raise ValueError("hashes.json must contain an object")
    expected_manifest_base = manifest.model_dump(mode="json", exclude={"manifest_sha256"})
    if sha256_hex(expected_manifest_base) != manifest.manifest_sha256:
        raise ValueError("manifest canonical hash does not match")
    artifact_hashes = {**manifest.raw_artifacts, **manifest.derived_artifacts}
    for name, expected_hash in artifact_hashes.items():
        if sha256_file(package_directory / name) != expected_hash:
            raise ValueError(f"artifact hash does not match for {name}")
    expected_file_hashes = {
        **artifact_hashes,
        "manifest.json": sha256_file(manifest_path),
    }
    if recorded_file_hashes != expected_file_hashes:
        raise ValueError("hashes.json does not exactly match package file hashes")
    if manifest.mode is not QuantumMode.SIMULATED:
        raise ValueError("F2A evidence package is not visibly simulated")
    return manifest
