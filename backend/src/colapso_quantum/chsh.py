"""Explicit CHSH derivation; no one-basis correlation is promoted to a witness."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from math import isfinite, sqrt

from .models import QuantumConfigurationError

CLASSICAL_BOUND = 2.0
TSIRELSON_BOUND = 2 * sqrt(2)
_EXPECTED_KEYS = frozenset({"E00", "E01", "E10", "E11"})


@dataclass(frozen=True)
class ChshCalculation:
    expectations: dict[str, float]
    witness: float
    classical_bound: float = CLASSICAL_BOUND
    tsirelson_bound: float = TSIRELSON_BOUND


def calculate_chsh(expectations: Mapping[str, float]) -> ChshCalculation:
    if set(expectations) != _EXPECTED_KEYS:
        raise QuantumConfigurationError("CHSH requires E00, E01, E10, and E11")
    values = {name: float(value) for name, value in expectations.items()}
    if any(not isfinite(value) or abs(value) > 1 + 1e-9 for value in values.values()):
        raise QuantumConfigurationError("CHSH expectations must remain within [-1, 1]")
    witness = values["E00"] + values["E01"] + values["E10"] - values["E11"]
    return ChshCalculation(expectations=values, witness=witness)
