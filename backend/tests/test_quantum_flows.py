from math import sqrt

import pytest

from colapso_quantum.chsh import calculate_chsh
from colapso_quantum.circuits import (
    build_bell_sampling_circuit,
    build_bell_state_circuit,
    build_chsh_observables,
    build_entropy_circuit,
)
from colapso_quantum.entropy import extract_independent_entropy, normalize_bitstring
from colapso_quantum.models import QuantumConfigurationError


def test_entropy_circuit_uses_independent_hadamard_measurements() -> None:
    circuit = build_entropy_circuit(3)

    assert circuit.name == "entropy-h-3"
    assert circuit.num_qubits == 3
    assert circuit.num_clbits == 3
    assert circuit.count_ops() == {"h": 3, "measure": 3}


@pytest.mark.parametrize("qubit_count", [0, 33])
def test_entropy_circuit_rejects_out_of_range_qubit_counts(qubit_count: int) -> None:
    with pytest.raises(QuantumConfigurationError, match="1 through 32"):
        build_entropy_circuit(qubit_count)


def test_bell_sampling_and_chsh_state_are_deliberately_different() -> None:
    sampling = build_bell_sampling_circuit()
    state = build_bell_state_circuit()

    assert sampling.count_ops() == {"h": 1, "cx": 1, "measure": 2}
    assert state.count_ops() == {"h": 1, "cx": 1}
    assert sampling.name != state.name


def test_chsh_observables_have_all_four_named_settings() -> None:
    observables = build_chsh_observables()

    assert set(observables) == {"E00", "E01", "E10", "E11"}
    assert all(observable.num_qubits == 2 for observable in observables.values())


def test_entropy_extraction_preserves_order_and_complete_words() -> None:
    extraction = extract_independent_entropy(
        ("00000001", "00000010", "00000000", "00000011"),
        independent_qubits=True,
    )

    assert extraction.bitstrings == ("00000001", "00000010", "00000000", "00000011")
    assert extraction.entropy_bytes == b"\x01\x02\x00\x03"
    assert extraction.uint32_values == (0x01020003,)
    assert extraction.discarded_bits == 0


def test_entropy_extraction_handles_partial_data_and_rejects_bell_input() -> None:
    partial = extract_independent_entropy(("10", "1"), independent_qubits=True)

    assert partial.entropy_bytes == b""
    assert partial.uint32_values == ()
    assert partial.discarded_bits == 3
    assert normalize_bitstring("10 01") == "1001"
    with pytest.raises(QuantumConfigurationError, match="correlated"):
        extract_independent_entropy(("00",), independent_qubits=False)
    with pytest.raises(QuantumConfigurationError, match="binary"):
        normalize_bitstring("invalid")
    with pytest.raises(QuantumConfigurationError, match="at least one"):
        extract_independent_entropy((), independent_qubits=True)


def test_chsh_calculation_uses_declared_sign_and_bounds() -> None:
    value = 1 / sqrt(2)
    calculation = calculate_chsh(
        {"E00": value, "E01": value, "E10": value, "E11": -value}
    )

    assert calculation.witness == pytest.approx(2 * sqrt(2))
    assert calculation.classical_bound == 2.0
    assert calculation.tsirelson_bound == pytest.approx(2 * sqrt(2))
    with pytest.raises(QuantumConfigurationError, match="requires"):
        calculate_chsh({"E00": 0.0})
    with pytest.raises(QuantumConfigurationError, match="within"):
        calculate_chsh({"E00": float("nan"), "E01": 0.0, "E10": 0.0, "E11": 0.0})
