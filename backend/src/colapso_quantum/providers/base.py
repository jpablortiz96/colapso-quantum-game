"""Provider protocol and raw measurement records independent of Runtime SDKs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class EntropyMeasurement:
    circuit_identifier: str
    bitstrings: tuple[str, ...]


@dataclass(frozen=True)
class BellMeasurement:
    circuit_identifier: str
    bitstrings: tuple[str, ...]


@dataclass(frozen=True)
class ChshMeasurement:
    circuit_identifier: str
    expectations: dict[str, float]
    standard_error: float | None


class QuantumProvider(Protocol):
    """A provider returns raw local/remote measurements; service owns contracts."""

    provider_name: str
    backend_name: str

    def harvest_entropy(
        self, *, qubit_count: int, shots: int, seed: int | None
    ) -> EntropyMeasurement: ...

    def sample_bell(self, *, shots: int, seed: int | None) -> BellMeasurement: ...

    def estimate_chsh(self, *, seed: int | None) -> ChshMeasurement: ...

    def qiskit_versions(self) -> dict[str, str]: ...
