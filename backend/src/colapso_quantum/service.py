"""Provider-neutral orchestration for F2A's three isolated local flows."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .chsh import calculate_chsh
from .entropy import extract_independent_entropy
from .evidence import EvidencePackage, sha256_hex, utc_now, write_evidence_package
from .models import (
    BellCorrelationBatch,
    ChshEvidence,
    EntropyBatch,
    QuantumMode,
    QuantumProvenance,
    VerificationStatus,
)
from .providers.aer import AerProvider
from .providers.base import QuantumProvider


class LocalQuantumService:
    """Builds only simulated, local F2A results; no runtime provider is selected."""

    def __init__(
        self,
        provider: QuantumProvider | None = None,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._provider = provider or AerProvider()
        self._clock = clock

    def _provenance(
        self,
        *,
        shots: int,
        circuit_identifiers: tuple[str, ...],
        raw_hash: str,
        derived_hash: str,
        configuration: dict[str, object],
    ) -> QuantumProvenance:
        return QuantumProvenance(
            mode=QuantumMode.SIMULATED,
            provider=self._provider.provider_name,
            backend=self._provider.backend_name,
            timestamp_utc=self._clock(),
            shots=shots,
            circuit_identifiers=circuit_identifiers,
            qiskit_versions=self._provider.qiskit_versions(),
            raw_artifact_hashes=(raw_hash,),
            derived_artifact_hashes=(derived_hash,),
            configuration=configuration,
            verification_status=VerificationStatus.SIMULATED,
        )

    def simulate_entropy(
        self, *, seed: int | None, shots: int = 128, qubit_count: int = 4
    ) -> EntropyBatch:
        measurement = self._provider.harvest_entropy(
            qubit_count=qubit_count,
            shots=shots,
            seed=seed,
        )
        extraction = extract_independent_entropy(
            measurement.bitstrings,
            independent_qubits=True,
        )
        raw_document = {
            "circuit_identifier": measurement.circuit_identifier,
            "shot_bitstrings": extraction.bitstrings,
        }
        derived_document = {
            "entropy_bytes_hex": extraction.entropy_bytes.hex(),
            "uint32_values": extraction.uint32_values,
            "discarded_bits": extraction.discarded_bits,
            "extractor_version": 1,
        }
        raw_hash = sha256_hex(raw_document)
        derived_hash = sha256_hex(derived_document)
        return EntropyBatch(
            provenance=self._provenance(
                shots=shots,
                circuit_identifiers=(measurement.circuit_identifier,),
                raw_hash=raw_hash,
                derived_hash=derived_hash,
                configuration={
                    "seed": seed,
                    "qubit_count": qubit_count,
                    "flow": "ENTROPY_HARVEST",
                    "conditioner": "none",
                    "bit_order": "SamplerV2 c-register string order",
                },
            ),
            circuit_identifier=measurement.circuit_identifier,
            raw_bitstrings=extraction.bitstrings,
            entropy_bytes_hex=extraction.entropy_bytes.hex(),
            uint32_values=extraction.uint32_values,
            discarded_bits=extraction.discarded_bits,
            raw_sha256=raw_hash,
            derived_sha256=derived_hash,
        )

    def simulate_bell(self, *, seed: int | None, shots: int = 128) -> BellCorrelationBatch:
        measurement = self._provider.sample_bell(shots=shots, seed=seed)
        counts = Counter(measurement.bitstrings)
        complete_counts = {outcome: counts.get(outcome, 0) for outcome in ("00", "01", "10", "11")}
        correlation = (
            complete_counts["00"]
            + complete_counts["11"]
            - complete_counts["01"]
            - complete_counts["10"]
        ) / shots
        raw_document = {
            "circuit_identifier": measurement.circuit_identifier,
            "shot_bitstrings": measurement.bitstrings,
        }
        derived_document = {
            "counts": complete_counts,
            "observed_correlation": correlation,
            "interpretation": "ONE_BASIS_CORRELATION_ONLY",
        }
        raw_hash = sha256_hex(raw_document)
        derived_hash = sha256_hex(derived_document)
        return BellCorrelationBatch(
            provenance=self._provenance(
                shots=shots,
                circuit_identifiers=(measurement.circuit_identifier,),
                raw_hash=raw_hash,
                derived_hash=derived_hash,
                configuration={
                    "seed": seed,
                    "flow": "BELL_CORRELATION_SAMPLING",
                    "measurement_basis": "computational",
                },
            ),
            circuit_identifier=measurement.circuit_identifier,
            raw_bitstrings=measurement.bitstrings,
            counts=complete_counts,
            observed_correlation=correlation,
            raw_sha256=raw_hash,
            derived_sha256=derived_hash,
        )

    def simulate_chsh(self, *, seed: int | None) -> ChshEvidence:
        measurement = self._provider.estimate_chsh(seed=seed)
        calculation = calculate_chsh(measurement.expectations)
        raw_document = {
            "circuit_identifier": measurement.circuit_identifier,
            "expectation_values": calculation.expectations,
            "standard_error": measurement.standard_error,
        }
        derived_document = {
            "witness": calculation.witness,
            "classical_bound": calculation.classical_bound,
            "tsirelson_bound": calculation.tsirelson_bound,
            "tolerance": 1e-9,
        }
        raw_hash = sha256_hex(raw_document)
        derived_hash = sha256_hex(derived_document)
        return ChshEvidence(
            provenance=self._provenance(
                shots=1,
                circuit_identifiers=(measurement.circuit_identifier,),
                raw_hash=raw_hash,
                derived_hash=derived_hash,
                configuration={
                    "seed": seed,
                    "flow": "CHSH_EVIDENCE",
                    "sign_convention": "E00 + E01 + E10 - E11",
                },
            ),
            circuit_identifier=measurement.circuit_identifier,
            expectation_values=calculation.expectations,
            witness=calculation.witness,
            standard_error=measurement.standard_error,
            raw_sha256=raw_hash,
            derived_sha256=derived_hash,
            interpretation="SIMULATED_CHSH_WITNESS",
        )

    def write_simulated_package(
        self,
        *,
        evidence_root: str,
        run_id: str,
        entropy: EntropyBatch | None = None,
        bell: BellCorrelationBatch | None = None,
        chsh: ChshEvidence | None = None,
    ) -> EvidencePackage:
        records: dict[str, tuple[BaseModel, Mapping[str, Any]]] = {}
        created_at: datetime | None = None
        if entropy is not None:
            records["entropy"] = (
                entropy,
                {
                    "circuit_identifier": entropy.circuit_identifier,
                    "shot_bitstrings": entropy.raw_bitstrings,
                },
            )
            created_at = entropy.provenance.timestamp_utc
        if bell is not None:
            records["bell"] = (
                bell,
                {
                    "circuit_identifier": bell.circuit_identifier,
                    "shot_bitstrings": bell.raw_bitstrings,
                },
            )
            created_at = bell.provenance.timestamp_utc
        if chsh is not None:
            records["chsh"] = (
                chsh,
                {
                    "circuit_identifier": chsh.circuit_identifier,
                    "expectation_values": chsh.expectation_values,
                    "standard_error": chsh.standard_error,
                },
            )
            created_at = chsh.provenance.timestamp_utc
        if created_at is None:
            raise ValueError("a simulated package needs at least one isolated flow")
        return write_evidence_package(Path(evidence_root), run_id, created_at, records)
