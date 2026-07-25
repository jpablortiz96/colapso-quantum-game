import json
from datetime import datetime

import pytest
from conftest import FIXED_TIMESTAMP, HASH_A, HASH_B, real_provenance, simulated_provenance
from pydantic import BaseModel, ValidationError

from colapso_quantum.evidence import canonical_json_bytes, validate_evidence_package, write_evidence_package
from colapso_quantum.models import (
    BellCorrelationBatch,
    ChshEvidence,
    EntropyBatch,
    EvidenceManifest,
    QuantumMode,
)
from colapso_quantum.service import LocalQuantumService


def _entropy() -> EntropyBatch:
    return EntropyBatch(
        provenance=simulated_provenance(shots=2, circuit_identifier="entropy-h-4"),
        circuit_identifier="entropy-h-4",
        raw_bitstrings=("00000000", "11111111"),
        entropy_bytes_hex="00ff",
        uint32_values=(255,),
        discarded_bits=0,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
    )


def _bell() -> BellCorrelationBatch:
    return BellCorrelationBatch(
        provenance=simulated_provenance(shots=2, circuit_identifier="bell-correlation-z"),
        circuit_identifier="bell-correlation-z",
        raw_bitstrings=("00", "11"),
        counts={"00": 1, "01": 0, "10": 0, "11": 1},
        observed_correlation=1.0,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
    )


def _chsh(*, real: bool = False) -> ChshEvidence:
    provenance = real_provenance() if real else simulated_provenance(shots=1)
    return ChshEvidence(
        provenance=provenance,
        circuit_identifier="bell-chsh-state",
        expectation_values={"E00": 0.6, "E01": 0.6, "E10": 0.6, "E11": -0.6},
        witness=2.4,
        standard_error=0.01 if real else None,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
        interpretation="REAL_WITH_UNCERTAINTY" if real else "SIMULATED_CHSH_WITNESS",
    )


def _records(entropy: EntropyBatch) -> dict[str, tuple[BaseModel, dict[str, object]]]:
    return {
        "entropy": (
            entropy,
            {
                "circuit_identifier": entropy.circuit_identifier,
                "shot_bitstrings": entropy.raw_bitstrings,
            },
        )
    }


def test_contract_models_reject_all_audited_invalid_statistics() -> None:
    provenance_payload = simulated_provenance().model_dump()
    provenance_payload["circuit_identifiers"] = (" ",)
    with pytest.raises(ValidationError, match="non-empty"):
        simulated_provenance().model_validate(provenance_payload)

    entropy = _entropy()
    for field, value, message in (
        ("entropy_bytes_hex", "0", "whole-byte"),
        ("uint32_values", (-1,), "in range"),
        ("raw_sha256", "bad", "lowercase"),
    ):
        payload = entropy.model_dump()
        payload[field] = value
        with pytest.raises(ValidationError, match=message):
            EntropyBatch.model_validate(payload)

    bell = _bell()
    for field, value, message in (
        ("raw_bitstrings", ("bad", "11"), "two-bit"),
        ("raw_sha256", "bad", "lowercase"),
        ("counts", {"00": 1, "01": 0, "10": 0}, "exactly"),
        ("counts", {"00": -1, "01": 0, "10": 0, "11": 3}, "non-negative"),
        ("counts", {"00": 0, "01": 0, "10": 0, "11": 0}, "sum"),
        ("raw_bitstrings", ("00",), "preserve every shot"),
    ):
        payload = bell.model_dump()
        payload[field] = value
        with pytest.raises(ValidationError, match=message):
            BellCorrelationBatch.model_validate(payload)

    chsh = _chsh()
    for field, value, message in (
        ("expectation_values", {"E00": 0.0}, "exactly"),
        (
            "expectation_values",
            {"E00": 2.0, "E01": 0.0, "E10": 0.0, "E11": 0.0},
            "within",
        ),
        ("witness", 0.0, "sign convention"),
    ):
        payload = chsh.model_dump()
        payload[field] = value
        with pytest.raises(ValidationError, match=message):
            ChshEvidence.model_validate(payload)
    real_payload = _chsh(real=True).model_dump()
    real_payload["interpretation"] = "SIMULATED_CHSH_WITNESS"
    with pytest.raises(ValidationError, match="uncertainty label"):
        ChshEvidence.model_validate(real_payload)


def test_manifest_rejects_timestamp_and_artifact_guards() -> None:
    manifest = EvidenceManifest(
        run_id="guards-manifest-001",
        mode=QuantumMode.SIMULATED,
        created_at_utc=FIXED_TIMESTAMP,
        provenance=(simulated_provenance(),),
        raw_artifacts={"raw-entropy.json": HASH_A},
        derived_artifacts={"derived-entropy.json": HASH_B},
        manifest_sha256=HASH_A,
    )
    for field, value, message in (
        ("created_at_utc", datetime(2026, 7, 20), "UTC offset"),
        ("raw_artifacts", {"raw-entropy.txt": HASH_A}, "JSON file"),
        ("derived_artifacts", {"derived-entropy.json": "bad"}, "SHA-256"),
        ("manifest_sha256", "bad", "lowercase"),
    ):
        payload = manifest.model_dump()
        payload[field] = value
        with pytest.raises(ValidationError, match=message):
            EvidenceManifest.model_validate(payload)


def test_evidence_guard_paths_reject_bad_records_and_hash_maps(tmp_path) -> None:
    entropy = _entropy()
    records = _records(entropy)
    with pytest.raises(ValueError, match="at least one"):
        write_evidence_package(tmp_path, "empty-record-001", FIXED_TIMESTAMP, {})
    with pytest.raises(ValueError, match="record names"):
        write_evidence_package(
            tmp_path,
            "bad-name-record-001",
            FIXED_TIMESTAMP,
            {"1bad": records["entropy"]},
        )

    class WithoutProvenance(BaseModel):
        value: int = 1

    with pytest.raises(ValueError, match="carry QuantumProvenance"):
        write_evidence_package(
            tmp_path,
            "plain-record-001",
            FIXED_TIMESTAMP,
            {"plain": (WithoutProvenance(), {})},
        )
    with pytest.raises(ValueError, match="only contain simulated"):
        write_evidence_package(
            tmp_path,
            "real-record-001",
            FIXED_TIMESTAMP,
            {"real": (_chsh(real=True), {})},
        )
    with pytest.raises(TypeError, match="canonical JSON"):
        canonical_json_bytes(object())

    package = write_evidence_package(
        tmp_path,
        "invalid-hashes-record-001",
        FIXED_TIMESTAMP,
        records,
    )
    (package.path / "hashes.json").write_text(json.dumps([]), encoding="utf-8")
    with pytest.raises(ValueError, match="must contain an object"):
        validate_evidence_package(package.path)


def test_service_rejects_an_empty_evidence_selection(tmp_path) -> None:
    with pytest.raises(ValueError, match="at least one isolated flow"):
        LocalQuantumService().write_simulated_package(
            evidence_root=str(tmp_path),
            run_id="empty-service-001",
        )
