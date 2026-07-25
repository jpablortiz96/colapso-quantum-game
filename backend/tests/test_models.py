from datetime import datetime

import pytest
from conftest import (
    FIXED_TIMESTAMP,
    HASH_A,
    HASH_B,
    real_provenance,
    simulated_provenance,
)
from pydantic import ValidationError

from colapso_quantum.models import (
    BellCorrelationBatch,
    ChshEvidence,
    EntropyBatch,
    EvidenceManifest,
    QuantumMode,
    QuantumProvenance,
    VerificationStatus,
)


def test_provenance_round_trip_normalizes_to_utc() -> None:
    provenance = simulated_provenance()

    restored = QuantumProvenance.model_validate_json(provenance.model_dump_json())

    assert restored == provenance
    assert restored.timestamp_utc == FIXED_TIMESTAMP
    assert restored.mode is QuantumMode.SIMULATED


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"job_id": "not-allowed"}, "job ID"),
        ({"verification_status": VerificationStatus.UNVERIFIED}, "SIMULATED status"),
        ({"timestamp_utc": datetime(2026, 7, 20)}, "UTC offset"),
        ({"circuit_identifiers": ("duplicate", "duplicate")}, "unique"),
        ({"raw_artifact_hashes": ("not-a-hash",)}, "SHA-256"),
    ],
)
def test_simulated_provenance_rejects_invalid_claims(
    kwargs: dict[str, object], message: str
) -> None:
    payload = simulated_provenance().model_dump()
    payload.update(kwargs)

    with pytest.raises(ValidationError, match=message):
        QuantumProvenance.model_validate(payload)


def test_real_provenance_cannot_claim_simulated_status() -> None:
    payload = real_provenance().model_dump()
    payload["verification_status"] = VerificationStatus.SIMULATED

    with pytest.raises(ValidationError, match="real provenance"):
        QuantumProvenance.model_validate(payload)


def test_entropy_batch_serializes_and_rejects_invalid_measurements() -> None:
    batch = EntropyBatch(
        provenance=simulated_provenance(),
        circuit_identifier="entropy-h-4",
        raw_bitstrings=("00000000", "11111111"),
        entropy_bytes_hex="00ff",
        uint32_values=(255,),
        discarded_bits=0,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
    )

    assert EntropyBatch.model_validate_json(batch.model_dump_json()) == batch
    payload = batch.model_dump()
    payload["raw_bitstrings"] = ("bad",)
    with pytest.raises(ValidationError, match="binary"):
        EntropyBatch.model_validate(payload)


def test_bell_contract_checks_complete_counts_and_correlation() -> None:
    batch = BellCorrelationBatch(
        provenance=simulated_provenance(shots=4, circuit_identifier="bell-correlation-z"),
        circuit_identifier="bell-correlation-z",
        raw_bitstrings=("00", "11", "00", "11"),
        counts={"00": 2, "01": 0, "10": 0, "11": 2},
        observed_correlation=1.0,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
    )

    assert batch.observed_correlation == 1.0
    payload = batch.model_dump()
    payload["observed_correlation"] = 0.0
    with pytest.raises(ValidationError, match="does not match"):
        BellCorrelationBatch.model_validate(payload)


def test_chsh_contract_keeps_interpretation_bound_to_mode() -> None:
    expectations = {"E00": 0.6, "E01": 0.6, "E10": 0.6, "E11": -0.6}
    simulated = ChshEvidence(
        provenance=simulated_provenance(shots=1, circuit_identifier="bell-chsh-state"),
        circuit_identifier="bell-chsh-state",
        expectation_values=expectations,
        witness=2.4,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
        interpretation="SIMULATED_CHSH_WITNESS",
    )

    assert simulated.witness > simulated.classical_bound
    real = ChshEvidence(
        provenance=real_provenance(),
        circuit_identifier="bell-chsh-state",
        expectation_values=expectations,
        witness=2.4,
        standard_error=0.01,
        raw_sha256=HASH_A,
        derived_sha256=HASH_B,
        interpretation="REAL_WITH_UNCERTAINTY",
    )
    assert real.standard_error == 0.01
    payload = simulated.model_dump()
    payload["interpretation"] = "REAL_WITH_UNCERTAINTY"
    with pytest.raises(ValidationError, match="visibly simulated"):
        ChshEvidence.model_validate(payload)


def test_manifest_requires_matching_simulated_provenance() -> None:
    manifest = EvidenceManifest(
        run_id="model-manifest-001",
        mode=QuantumMode.SIMULATED,
        created_at_utc=FIXED_TIMESTAMP,
        provenance=(simulated_provenance(),),
        raw_artifacts={"raw-entropy.json": HASH_A},
        derived_artifacts={"derived-entropy.json": HASH_B},
        manifest_sha256=HASH_A,
    )

    assert EvidenceManifest.model_validate_json(manifest.model_dump_json()) == manifest
    payload = manifest.model_dump()
    payload["mode"] = QuantumMode.REAL
    with pytest.raises(ValidationError, match="must agree"):
        EvidenceManifest.model_validate(payload)
