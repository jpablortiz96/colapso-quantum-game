"""Local-only Aer V2 provider. Every result is simulated by construction."""

from __future__ import annotations

from importlib.metadata import version
from typing import Any

from qiskit_aer.primitives import EstimatorV2, SamplerV2

from ..circuits import (
    build_bell_sampling_circuit,
    build_bell_state_circuit,
    build_chsh_observables,
    build_entropy_circuit,
)
from ..models import ProviderExecutionError, QuantumConfigurationError
from .base import BellMeasurement, ChshMeasurement, EntropyMeasurement


class AerProvider:
    provider_name = "qiskit-aer"
    backend_name = "aer_simulator"

    @staticmethod
    def _validate_shots(shots: int) -> None:
        if not 1 <= shots <= 1_000_000:
            raise QuantumConfigurationError("shots must be from 1 through 1,000,000")

    @staticmethod
    def _bitstrings_from_result(result: Any) -> tuple[str, ...]:
        try:
            data = result[0].data
            register = data.c
            bitstrings = tuple(register.get_bitstrings())
        except (AttributeError, IndexError, TypeError) as error:
            raise ProviderExecutionError(
                "Aer SamplerV2 did not return ordered c-register bitstrings"
            ) from error
        if not bitstrings:
            raise ProviderExecutionError("Aer SamplerV2 returned no shot bitstrings")
        return tuple(item.replace(" ", "") for item in bitstrings)

    @staticmethod
    def _sampler(seed: int | None) -> SamplerV2:
        """Use Aer V2's dedicated sampler seed to avoid duplicate run options."""
        return SamplerV2(seed=seed)

    @staticmethod
    def _estimator(seed: int | None) -> EstimatorV2:
        options = {"run_options": {"seed_simulator": seed}} if seed is not None else {}
        return EstimatorV2(options=options)

    def harvest_entropy(
        self, *, qubit_count: int, shots: int, seed: int | None
    ) -> EntropyMeasurement:
        self._validate_shots(shots)
        circuit = build_entropy_circuit(qubit_count)
        result = self._sampler(seed).run([circuit], shots=shots).result()
        return EntropyMeasurement(
            circuit_identifier=circuit.name,
            bitstrings=self._bitstrings_from_result(result),
        )

    def sample_bell(self, *, shots: int, seed: int | None) -> BellMeasurement:
        self._validate_shots(shots)
        circuit = build_bell_sampling_circuit()
        result = self._sampler(seed).run([circuit], shots=shots).result()
        return BellMeasurement(
            circuit_identifier=circuit.name,
            bitstrings=self._bitstrings_from_result(result),
        )

    def estimate_chsh(self, *, seed: int | None) -> ChshMeasurement:
        circuit = build_bell_state_circuit()
        observables = build_chsh_observables()
        pubs = [(circuit, observable) for observable in observables.values()]
        result = self._estimator(seed).run(pubs).result()
        expectations: dict[str, float] = {}
        standard_errors: list[float] = []
        for identifier, pub_result in zip(observables, result, strict=True):
            expectations[identifier] = float(pub_result.data.evs)
            standard_error = getattr(pub_result.data, "stds", None)
            if standard_error is not None:
                standard_errors.append(float(standard_error))
        return ChshMeasurement(
            circuit_identifier=circuit.name,
            expectations=expectations,
            standard_error=max(standard_errors) if standard_errors else None,
        )

    def qiskit_versions(self) -> dict[str, str]:
        return {
            "qiskit": version("qiskit"),
            "qiskit-aer": version("qiskit-aer"),
        }
