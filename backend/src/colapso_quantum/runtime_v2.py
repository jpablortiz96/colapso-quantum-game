"""Structural, raw-preserving readers for completed Qiskit Runtime primitive V2 jobs."""

from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .models import ProviderExecutionError

_SECRET_KEY = re.compile(r"(?:token|secret|authorization|password|api[_-]?key|cookie)", re.I)


class RuntimeV2FormatError(ProviderExecutionError):
    """A deterministic structural error safe to persist after Runtime raw evidence is written."""


@dataclass(frozen=True)
class SamplerV2Parsed:
    structure: Mapping[str, Any]
    sampler_raw: Mapping[str, Any]
    entropy_derived: Mapping[str, Any]
    bell_derived: Mapping[str, Any]


@dataclass(frozen=True)
class EstimatorV2Parsed:
    structure: Mapping[str, Any]
    estimator_raw: Mapping[str, Any]
    chsh_derived: Mapping[str, Any]


def _class_descriptor(value: Any) -> dict[str, str]:
    value_type = type(value)
    return {"module": value_type.__module__, "class": value_type.__qualname__}


def json_safe(value: Any) -> Any:
    """Convert metadata, numpy scalars and arrays without using repr as a data substitute."""
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    if hasattr(value, "tolist"):
        return json_safe(value.tolist())
    if hasattr(value, "item"):
        try:
            return json_safe(value.item())
        except ValueError:
            pass
    if isinstance(value, Mapping):
        return {
            (
                f"redacted_metadata_field_{index}"
                if _SECRET_KEY.search(str(key))
                else str(key)
            ): "[REDACTED]" if _SECRET_KEY.search(str(key)) else json_safe(nested)
            for index, (key, nested) in enumerate(value.items())
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [json_safe(nested) for nested in value]
    if hasattr(value, "value"):
        return json_safe(value.value)
    return {"unserializable_type": _class_descriptor(value)}


def _metadata(value: Any) -> Mapping[str, Any]:
    metadata = getattr(value, "metadata", None)
    return json_safe(metadata) if metadata is not None else {}


def _metadata_keys(value: Any) -> list[str]:
    metadata = getattr(value, "metadata", None)
    if not isinstance(metadata, Mapping):
        return []
    return sorted(
        f"redacted_metadata_field_{index}" if _SECRET_KEY.search(str(key)) else str(key)
        for index, key in enumerate(metadata)
    )


def _data_fields(data: Any) -> list[tuple[str, Any]]:
    if data is None:
        raise RuntimeV2FormatError("V2 pub result has no DataBin data")
    if hasattr(data, "keys"):
        keys = [str(key) for key in data.keys()]
        return [(key, getattr(data, key)) for key in keys]
    if isinstance(data, Mapping):
        return [(str(key), value) for key, value in data.items()]
    values = vars(data) if hasattr(data, "__dict__") else {}
    fields = [(key, value) for key, value in values.items() if not key.startswith("_")]
    if not fields:
        raise RuntimeV2FormatError("V2 DataBin exposes no public fields")
    return fields


def _shape_dtype(value: Any) -> tuple[list[int], str | None]:
    array = getattr(value, "array", value)
    shape = getattr(array, "shape", getattr(value, "shape", ()))
    dtype = getattr(array, "dtype", getattr(value, "dtype", None))
    try:
        normalized_shape = [int(part) for part in shape]
    except TypeError:
        normalized_shape = []
    return normalized_shape, str(dtype) if dtype is not None else None


def _field_structure(name: str, value: Any) -> dict[str, Any]:
    shape, dtype = _shape_dtype(value)
    record: dict[str, Any] = {
        "name": name,
        **_class_descriptor(value),
        "shape": shape,
        "dtype": dtype,
    }
    for attribute in ("num_shots", "num_bits"):
        field_value = getattr(value, attribute, None)
        if field_value is not None:
            record[attribute] = int(field_value)
    return record


def inventory_result(result: Any, *, role: str) -> dict[str, Any]:
    """Record the V2 result shape without expanding the measurements contained in Runtime raw."""
    try:
        pubs = list(result)
    except TypeError as error:
        raise RuntimeV2FormatError("Runtime result is not an iterable PrimitiveResult") from error
    inventory: dict[str, Any] = {
        "role": role,
        "container": _class_descriptor(result),
        "length": len(pubs),
        "metadata": _metadata(result),
        "pubs": [],
    }
    for index, pub in enumerate(pubs):
        data = getattr(pub, "data", None)
        fields = _data_fields(data)
        inventory["pubs"].append(
            {
                "index": index,
                "pub": _class_descriptor(pub),
                "metadata_keys": _metadata_keys(pub),
                "metadata": _metadata(pub),
                "data": _class_descriptor(data),
                "data_keys": [name for name, _ in fields],
                "fields": [_field_structure(name, value) for name, value in fields],
            }
        )
    return inventory


def _bitarray_record(name: str, bit_array: Any) -> tuple[dict[str, Any], list[str]]:
    if not all(hasattr(bit_array, attribute) for attribute in ("get_counts", "get_bitstrings", "num_shots", "num_bits")):
        raise RuntimeV2FormatError(f"Sampler DataBin field {name!r} is not a BitArray")
    counts = {str(key): int(value) for key, value in dict(bit_array.get_counts()).items()}
    shots = int(bit_array.num_shots)
    bits = int(bit_array.num_bits)
    bitstrings = [str(value) for value in bit_array.get_bitstrings()]
    if shots < 1 or bits < 1 or sum(counts.values()) != shots or len(bitstrings) != shots:
        raise RuntimeV2FormatError(f"Sampler BitArray {name!r} counts do not match num_shots")
    if any(len(value) != bits or set(value) - {"0", "1"} for value in bitstrings):
        raise RuntimeV2FormatError(f"Sampler BitArray {name!r} has invalid bitstrings")
    shape, dtype = _shape_dtype(bit_array)
    return (
        {
            "name": name,
            **_class_descriptor(bit_array),
            "num_shots": shots,
            "num_bits": bits,
            "shape": shape,
            "dtype": dtype,
            "counts": counts,
        },
        bitstrings,
    )


def _combine_registers(pub: Any, registers: list[tuple[str, Any, list[str]]]) -> tuple[dict[str, Any], list[str]]:
    if len(registers) == 1:
        name, record, bitstrings = registers[0]
        return ({"method": "single_register", "register_order": [name], **record}, bitstrings)
    if hasattr(pub, "join_data"):
        joined = pub.join_data()
        record, bitstrings = _bitarray_record("joined", joined)
        return (
            {
                "method": "SamplerPubResult.join_data",
                "register_order": [name for name, _, _ in registers],
                **record,
            },
            bitstrings,
        )
    register_order = [name for name, _, _ in registers]
    shot_count = len(registers[0][2])
    if any(len(bitstrings) != shot_count for _, _, bitstrings in registers):
        raise RuntimeV2FormatError("Sampler register shot counts cannot be explicitly joined")
    bitstrings = ["".join(values) for values in zip(*(item[2] for item in registers), strict=True)]
    counts = dict(Counter(bitstrings))
    return (
        {
            "method": "explicit_preserved_register_order_concatenation",
            "register_order": register_order,
            "num_shots": shot_count,
            "num_bits": sum(record["num_bits"] for _, record, _ in registers),
            "counts": counts,
        },
        bitstrings,
    )


def parse_sampler_v2(
    result: Any,
    *,
    circuit_labels: Sequence[str],
    workloads: Sequence[str],
    runtime_raw_sha256: str,
) -> SamplerV2Parsed:
    """Read the official PrimitiveResult -> SamplerPubResult -> DataBin -> BitArray contract."""
    structure = inventory_result(result, role="SAMPLER_ENTROPY_BELL")
    pubs = list(result)
    if len(pubs) != len(circuit_labels) or len(pubs) != len(workloads) or len(pubs) != 2:
        raise RuntimeV2FormatError("Sampler PUB mapping requires two explicitly persisted circuit labels and workloads")
    pub_records: list[dict[str, Any]] = []
    entropy_bitstrings: list[str] | None = None
    entropy_pub_record: dict[str, Any] | None = None
    bell_bitstrings: list[str] | None = None
    bell_pub_record: dict[str, Any] | None = None
    for index, (pub, label, workload) in enumerate(zip(pubs, circuit_labels, workloads, strict=True)):
        registers: list[tuple[str, dict[str, Any], list[str]]] = []
        for name, value in _data_fields(getattr(pub, "data", None)):
            if all(hasattr(value, attribute) for attribute in ("get_counts", "get_bitstrings", "num_shots", "num_bits")):
                record, bitstrings = _bitarray_record(name, value)
                registers.append((name, record, bitstrings))
        if not registers:
            raise RuntimeV2FormatError(f"Sampler PUB {index} has no BitArray classical-register field")
        combined, bitstrings = _combine_registers(pub, registers)
        if sum(combined["counts"].values()) != combined["num_shots"]:
            raise RuntimeV2FormatError(f"Sampler PUB {index} combined counts do not match num_shots")
        pub_records.append(
            {
                "pub_index": index,
                "circuit_label": label,
                "workload": workload,
                "metadata": _metadata(pub),
                "registers": [record for _, record, _ in registers],
                "combined": combined,
            }
        )
        if workload == "ENTROPY_HARVEST":
            entropy_bitstrings = bitstrings
            entropy_pub_record = pub_records[-1]
        elif workload == "BELL_CORRELATION":
            bell_bitstrings = bitstrings
            bell_pub_record = pub_records[-1]
        else:
            raise RuntimeV2FormatError("Sampler workload mapping is not explicit")
    if (
        entropy_bitstrings is None
        or entropy_pub_record is None
        or bell_bitstrings is None
        or bell_pub_record is None
    ):
        raise RuntimeV2FormatError("Sampler circuit labels do not map both entropy and Bell PUBs")
    ordered_bits = "".join(entropy_bitstrings)
    byte_bit_length = len(ordered_bits) - (len(ordered_bits) % 8)
    word_bit_length = len(ordered_bits) - (len(ordered_bits) % 32)
    entropy_bytes = bytes(
        int(ordered_bits[index : index + 8], 2)
        for index in range(0, byte_bit_length, 8)
    )
    if any(len(value) != 2 for value in bell_bitstrings):
        raise RuntimeV2FormatError("Bell PUB does not contain two-bit outcomes")
    bell_counts = dict(Counter(bell_bitstrings))
    if set(bell_counts) - {"00", "01", "10", "11"}:
        raise RuntimeV2FormatError("Bell PUB contains unsupported outcomes")
    normalized_bell = {key: bell_counts.get(key, 0) for key in ("00", "01", "10", "11")}
    bell_shots = len(bell_bitstrings)
    correlation = (
        normalized_bell["00"]
        + normalized_bell["11"]
        - normalized_bell["01"]
        - normalized_bell["10"]
    ) / bell_shots
    sampler_raw = {
        "schema_version": 2,
        "mode": "REAL",
        "source_runtime_raw": "sampler-runtime-raw.json",
        "source_runtime_raw_sha256": runtime_raw_sha256,
        "mapping_basis": "submission configuration sampler_workloads_grouped order paired with persisted circuit labels",
        "pubs": pub_records,
    }
    entropy = {
        "schema_version": 2,
        "mode": "REAL",
        "workload": "ENTROPY_HARVEST",
        "source_runtime_raw": "sampler-runtime-raw.json",
        "source_runtime_raw_sha256": runtime_raw_sha256,
        "source_sampler_record": "sampler-raw.json",
        "source_pub_index": entropy_pub_record["pub_index"],
        "source_circuit_label": entropy_pub_record["circuit_label"],
        "source_counts": entropy_pub_record["combined"]["counts"],
        "shots": entropy_pub_record["combined"]["num_shots"],
        "bit_order": "PUB entropy BitArray shot order, with preserved register join order",
        "entropy_bytes_hex": entropy_bytes.hex(),
        "uint32_values": [
            int(ordered_bits[index : index + 32], 2)
            for index in range(0, word_bit_length, 32)
        ],
        "accepted_byte_bits": byte_bit_length,
        "discarded_byte_bits": len(ordered_bits) - byte_bit_length,
        "discarded_word_bits": len(ordered_bits) - word_bit_length,
        "conditioning": None,
        "interpretation": "RAW_HARDWARE_MEASUREMENT_INPUT_NOT_CERTIFIED_RANDOMNESS",
    }
    bell = {
        "schema_version": 2,
        "mode": "REAL",
        "workload": "BELL_CORRELATION",
        "source_runtime_raw": "sampler-runtime-raw.json",
        "source_runtime_raw_sha256": runtime_raw_sha256,
        "source_sampler_record": "sampler-raw.json",
        "source_pub_index": bell_pub_record["pub_index"],
        "source_circuit_label": bell_pub_record["circuit_label"],
        "counts": normalized_bell,
        "shots": bell_shots,
        "observed_correlation": correlation,
        "interpretation": "ONE_BASIS_CORRELATION_ONLY_NOT_A_BELL_VIOLATION_OR_CONCLUSIVE_ENTANGLEMENT_CERTIFICATION",
    }
    return SamplerV2Parsed(structure=structure, sampler_raw=sampler_raw, entropy_derived=entropy, bell_derived=bell)


def _numeric_values(value: Any, *, field_name: str) -> list[float]:
    safe = json_safe(value)
    flattened: list[float] = []

    def visit(item: Any) -> None:
        if isinstance(item, list):
            for nested in item:
                visit(nested)
        elif isinstance(item, (int, float)) and math.isfinite(float(item)):
            flattened.append(float(item))
        else:
            raise RuntimeV2FormatError(f"Estimator {field_name} is not a finite numeric array")

    visit(safe)
    return flattened


def _array_record(value: Any, *, field_name: str) -> dict[str, Any]:
    shape, dtype = _shape_dtype(value)
    return {
        "field": field_name,
        "shape": shape,
        "dtype": dtype,
        "values": json_safe(value),
    }


def _chsh_signs(convention: str, observable_labels: Sequence[str]) -> list[int]:
    terms = re.findall(r"([+-]?)\s*(E\d\d)", convention)
    labels = [label for _, label in terms]
    if len(terms) != 4 or labels != list(observable_labels):
        raise RuntimeV2FormatError("persisted CHSH convention does not explicitly match observable order")
    return [-1 if sign == "-" else 1 for sign, _ in terms]


def parse_estimator_v2(
    result: Any,
    *,
    observable_labels: Sequence[str],
    convention: str,
    runtime_raw_sha256: str,
) -> EstimatorV2Parsed:
    """Read every V2 Estimator PUB and map only explicitly persisted CHSH observable order."""
    structure = inventory_result(result, role="ESTIMATOR_CHSH")
    pubs = list(result)
    if len(observable_labels) != 4:
        raise RuntimeV2FormatError("CHSH observable order is absent or incomplete in persisted submission metadata")

    raw_pubs: list[dict[str, Any]] = []
    flattened_values: list[float] = []
    flattened_errors: list[float] = []
    errors_available = True
    error_sources: set[str] = set()
    for index, pub in enumerate(pubs):
        data = getattr(pub, "data", None)
        evs = getattr(data, "evs", data.get("evs") if isinstance(data, Mapping) else None)
        if evs is None:
            raise RuntimeV2FormatError(f"Estimator PUB {index} has no DataBin.evs")
        standard_error_name: str | None = None
        standard_error_value = getattr(data, "stds", None)
        if standard_error_value is not None:
            standard_error_name = "stds"
        else:
            standard_error_value = getattr(data, "ensemble_standard_error", None)
            if standard_error_value is not None:
                standard_error_name = "ensemble_standard_error"
        values = _numeric_values(evs, field_name="evs")
        if not values:
            raise RuntimeV2FormatError(f"Estimator PUB {index} has an empty evs array")
        errors = (
            _numeric_values(standard_error_value, field_name=standard_error_name)
            if standard_error_name is not None
            else None
        )
        if errors is not None and len(errors) != len(values):
            raise RuntimeV2FormatError(f"Estimator PUB {index} standard-error length does not match evs")
        record: dict[str, Any] = {
            "pub_index": index,
            "metadata": _metadata(pub),
            "metadata_keys": _metadata_keys(pub),
            "evs": _array_record(evs, field_name="evs"),
            "standard_error": (
                _array_record(standard_error_value, field_name=standard_error_name)
                if standard_error_name is not None
                else None
            ),
            "observables": [],
        }
        raw_pubs.append(record)
        flattened_values.extend(values)
        if errors is None:
            errors_available = False
        else:
            flattened_errors.extend(errors)
            error_sources.add(standard_error_name)

    if len(flattened_values) != len(observable_labels):
        raise RuntimeV2FormatError("Estimator evs length does not match persisted CHSH observable order")
    if errors_available and len(flattened_errors) != len(observable_labels):
        raise RuntimeV2FormatError("Estimator standard-error length does not match persisted CHSH observable order")

    global_observable_index = 0
    for record in raw_pubs:
        values = _numeric_values(record["evs"]["values"], field_name="evs")
        error_record = record["standard_error"]
        errors = (
            _numeric_values(error_record["values"], field_name=error_record["field"])
            if error_record is not None
            else [None] * len(values)
        )
        for value, error in zip(values, errors, strict=True):
            record["observables"].append(
                {
                    "observable_index": global_observable_index,
                    "observable_label": observable_labels[global_observable_index],
                    "ev": value,
                    "standard_error": error,
                }
            )
            global_observable_index += 1

    signs = _chsh_signs(convention, observable_labels)
    terms = dict(zip(observable_labels, flattened_values, strict=True))
    witness = sum(sign * value for sign, value in zip(signs, flattened_values, strict=True))
    abs_witness = abs(witness)
    propagated_error = math.sqrt(sum(value * value for value in flattened_errors)) if errors_available else None
    if propagated_error is None:
        classification = "INSUFFICIENT_METADATA"
    elif abs_witness - propagated_error > 2:
        classification = "STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT"
    elif abs_witness > 2:
        classification = "OBSERVED_ABOVE_CLASSICAL_LIMIT_BUT_INCONCLUSIVE"
    else:
        classification = "NOT_ABOVE_CLASSICAL_LIMIT"
    standard_error_source = next(iter(error_sources)) if len(error_sources) == 1 and errors_available else None
    estimator_raw = {
        "schema_version": 2,
        "mode": "REAL",
        "source_runtime_raw": "estimator-runtime-raw.json",
        "source_runtime_raw_sha256": runtime_raw_sha256,
        "observable_order": list(observable_labels),
        "observable_flattening_order": "PUB order followed by each JSON-safe evs array order",
        "pubs": raw_pubs,
    }
    chsh = {
        "schema_version": 2,
        "mode": "REAL",
        "workload": "CHSH_EVIDENCE",
        "source_runtime_raw": "estimator-runtime-raw.json",
        "source_runtime_raw_sha256": runtime_raw_sha256,
        "source_estimator_record": "estimator-raw.json",
        "observable_order": list(observable_labels),
        "terms": terms,
        "signs": signs,
        "sign_convention": convention,
        "witness": witness,
        "absolute_witness": abs_witness,
        "classical_bound": 2.0,
        "tsirelson_bound": 2 * math.sqrt(2),
        "difference_from_classical_bound": abs_witness - 2.0,
        "propagated_standard_error": propagated_error,
        "standard_error": propagated_error,
        "standard_error_source": standard_error_source,
        "uncertainty_assumption": (
            "independent observable errors propagated in quadrature" if errors_available else None
        ),
        "classification_criterion": (
            "abs(S) - propagated_standard_error > 2 at one standard deviation"
            if errors_available
            else None
        ),
        "classification": classification,
        "interpretation": "REAL_WITH_UNCERTAINTY_NO_DEVICE_INDEPENDENT_OR_LOOPHOLE_FREE_CLAIM",
    }
    return EstimatorV2Parsed(structure=structure, estimator_raw=estimator_raw, chsh_derived=chsh)
