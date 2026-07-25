from datetime import UTC, datetime

from colapso_quantum.models import (
    QuantumMode,
    QuantumProvenance,
    VerificationStatus,
)

FIXED_TIMESTAMP = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
HASH_A = "a" * 64
HASH_B = "b" * 64


def simulated_provenance(
    *,
    shots: int = 2,
    circuit_identifier: str = "test-circuit",
) -> QuantumProvenance:
    return QuantumProvenance(
        mode=QuantumMode.SIMULATED,
        provider="test-provider",
        backend="test-backend",
        timestamp_utc=FIXED_TIMESTAMP,
        shots=shots,
        circuit_identifiers=(circuit_identifier,),
        qiskit_versions={"qiskit": "2.5.0"},
        raw_artifact_hashes=(HASH_A,),
        derived_artifact_hashes=(HASH_B,),
        configuration={"seed": 42},
        verification_status=VerificationStatus.SIMULATED,
    )


def real_provenance() -> QuantumProvenance:
    return QuantumProvenance(
        mode=QuantumMode.REAL,
        provider="test-provider",
        backend="test-backend",
        job_id="approved-job-id",
        timestamp_utc=FIXED_TIMESTAMP,
        shots=1,
        circuit_identifiers=("real-circuit",),
        qiskit_versions={"qiskit": "2.5.0"},
        configuration={},
        verification_status=VerificationStatus.UNVERIFIED,
    )
