from datetime import UTC, datetime

import pytest

from colapso_quantum.evidence import sha256_hex
from colapso_quantum.models import (
    ProviderExecutionError,
    QuantumConfigurationError,
    QuantumMode,
)
from colapso_quantum.providers.aer import AerProvider
from colapso_quantum.providers.base import (
    BellMeasurement,
    ChshMeasurement,
    EntropyMeasurement,
)
from colapso_quantum.service import LocalQuantumService


class FakeProvider:
    provider_name = "fake-local-provider"
    backend_name = "fake-backend"

    def harvest_entropy(
        self, *, qubit_count: int, shots: int, seed: int | None
    ) -> EntropyMeasurement:
        assert (qubit_count, shots, seed) == (4, 4, 42)
        return EntropyMeasurement("entropy-h-4", ("0001", "0010", "0100", "1000"))

    def sample_bell(self, *, shots: int, seed: int | None) -> BellMeasurement:
        assert (shots, seed) == (4, 42)
        return BellMeasurement("bell-correlation-z", ("00", "11", "01", "10"))

    def estimate_chsh(self, *, seed: int | None) -> ChshMeasurement:
        assert seed == 42
        return ChshMeasurement(
            "bell-chsh-state",
            {"E00": 0.6, "E01": 0.6, "E10": 0.6, "E11": -0.6},
            0.01,
        )

    def qiskit_versions(self) -> dict[str, str]:
        return {"qiskit": "2.5.0", "qiskit-aer": "0.17.2"}


def test_service_builds_isolated_simulated_records_from_provider_data() -> None:
    timestamp = datetime(2026, 7, 20, tzinfo=UTC)
    service = LocalQuantumService(FakeProvider(), clock=lambda: timestamp)

    entropy = service.simulate_entropy(seed=42, shots=4)
    bell = service.simulate_bell(seed=42, shots=4)
    chsh = service.simulate_chsh(seed=42)

    assert entropy.provenance.mode is QuantumMode.SIMULATED
    assert entropy.entropy_bytes_hex == "1248"
    assert entropy.uint32_values == ()
    assert entropy.raw_sha256 == sha256_hex(
        {"circuit_identifier": "entropy-h-4", "shot_bitstrings": entropy.raw_bitstrings}
    )
    assert bell.counts == {"00": 1, "01": 1, "10": 1, "11": 1}
    assert bell.observed_correlation == 0.0
    assert bell.interpretation == "ONE_BASIS_CORRELATION_ONLY"
    assert chsh.witness == pytest.approx(2.4)
    assert chsh.standard_error == 0.01
    assert chsh.provenance.configuration["flow"] == "CHSH_EVIDENCE"


def test_aer_provider_is_seeded_local_and_returns_expected_shapes() -> None:
    provider = AerProvider()

    first = provider.harvest_entropy(qubit_count=2, shots=8, seed=42)
    second = provider.harvest_entropy(qubit_count=2, shots=8, seed=42)
    bell = provider.sample_bell(shots=8, seed=42)
    chsh = provider.estimate_chsh(seed=42)

    assert first.bitstrings == second.bitstrings
    assert len(first.bitstrings) == 8
    assert all(len(value) == 2 for value in first.bitstrings)
    assert set(bell.bitstrings) <= {"00", "01", "10", "11"}
    assert chsh.expectations.keys() == {"E00", "E01", "E10", "E11"}
    assert sum(chsh.expectations.values()) - 2 * chsh.expectations["E11"] > 2
    assert provider.qiskit_versions()["qiskit-aer"] == "0.17.2"


def test_aer_provider_rejects_invalid_results_and_shots() -> None:
    with pytest.raises(QuantumConfigurationError, match="1 through"):
        AerProvider().harvest_entropy(qubit_count=1, shots=0, seed=42)
    with pytest.raises(ProviderExecutionError, match="did not return"):
        AerProvider._bitstrings_from_result([])
