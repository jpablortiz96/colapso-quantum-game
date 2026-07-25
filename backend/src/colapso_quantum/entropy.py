"""Auditable extraction from independently measured simulated qubits."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .models import QuantumConfigurationError


@dataclass(frozen=True)
class EntropyExtraction:
    bitstrings: tuple[str, ...]
    entropy_bytes: bytes
    uint32_values: tuple[int, ...]
    discarded_bits: int


def normalize_bitstring(value: str) -> str:
    normalized = value.replace(" ", "")
    if not normalized or set(normalized) - {"0", "1"}:
        raise QuantumConfigurationError("measurement bitstrings must be non-empty binary data")
    return normalized


def extract_independent_entropy(
    bitstrings: Sequence[str],
    *,
    independent_qubits: bool,
) -> EntropyExtraction:
    """Preserve shot order; reject correlated Bell outcomes as entropy input."""
    if not independent_qubits:
        raise QuantumConfigurationError(
            "Bell-pair outcomes are correlated and cannot be harvested as independent entropy"
        )
    normalized = tuple(normalize_bitstring(item) for item in bitstrings)
    if not normalized:
        raise QuantumConfigurationError("at least one entropy measurement is required")
    bits = "".join(normalized)
    byte_count = len(bits) // 8
    entropy_bytes = bytes(
        int(bits[index : index + 8], 2) for index in range(0, byte_count * 8, 8)
    )
    word_count = len(bits) // 32
    uint32_values = tuple(
        int(bits[index : index + 32], 2)
        for index in range(0, word_count * 32, 32)
    )
    return EntropyExtraction(
        bitstrings=normalized,
        entropy_bytes=entropy_bytes,
        uint32_values=uint32_values,
        discarded_bits=len(bits) % 32,
    )
