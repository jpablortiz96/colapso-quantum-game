"""Explicit circuit builders for three non-interchangeable quantum flows."""

from __future__ import annotations

from math import cos, pi, sin

from qiskit import QuantumCircuit
from qiskit.quantum_info import SparsePauliOp

from .models import QuantumConfigurationError


def build_entropy_circuit(qubit_count: int = 4) -> QuantumCircuit:
    """Prepare independent |+> qubits and measure them in the Z basis."""
    if not 1 <= qubit_count <= 32:
        raise QuantumConfigurationError("entropy qubit_count must be from 1 through 32")
    circuit = QuantumCircuit(qubit_count, qubit_count, name=f"entropy-h-{qubit_count}")
    circuit.h(range(qubit_count))
    circuit.measure(range(qubit_count), range(qubit_count))
    return circuit


def build_bell_sampling_circuit() -> QuantumCircuit:
    """Prepare one Bell pair for correlation sampling, never entropy harvest."""
    circuit = QuantumCircuit(2, 2, name="bell-correlation-z")
    circuit.h(0)
    circuit.cx(0, 1)
    circuit.measure((0, 1), (0, 1))
    return circuit


def build_bell_state_circuit() -> QuantumCircuit:
    """Prepare an unmeasured Bell state for estimator observables."""
    circuit = QuantumCircuit(2, name="bell-chsh-state")
    circuit.h(0)
    circuit.cx(0, 1)
    return circuit


def _observable_for_angles(left_angle: float, right_angle: float) -> SparsePauliOp:
    """Return (cos(a)Z + sin(a)X) ⊗ (cos(b)Z + sin(b)X)."""
    return SparsePauliOp.from_list(
        [
            ("ZZ", cos(left_angle) * cos(right_angle)),
            ("ZX", sin(left_angle) * cos(right_angle)),
            ("XZ", cos(left_angle) * sin(right_angle)),
            ("XX", sin(left_angle) * sin(right_angle)),
        ]
    )


def build_chsh_observables() -> dict[str, SparsePauliOp]:
    """Use the standard Z/X and ±45° settings for the declared CHSH sign."""
    settings = {
        "E00": (0.0, pi / 4),
        "E01": (0.0, -pi / 4),
        "E10": (pi / 2, pi / 4),
        "E11": (pi / 2, -pi / 4),
    }
    return {
        identifier: _observable_for_angles(left, right)
        for identifier, (left, right) in settings.items()
    }
