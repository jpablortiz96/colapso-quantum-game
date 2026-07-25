"""Lazy, injectable IBM Runtime adapter with a bounded F2B Open Plan job path."""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from qiskit import transpile
from qiskit.quantum_info import SparsePauliOp

from ..circuits import (
    build_bell_sampling_circuit,
    build_bell_state_circuit,
    build_chsh_observables,
    build_entropy_circuit,
)
from ..evidence import sha256_hex
from ..models import DryRunConfigurationError, ProviderExecutionError


class OpenPlanPreflightStatus(StrEnum):
    AUTHENTICATED_OPEN_PLAN = "AUTHENTICATED_OPEN_PLAN"
    AUTHENTICATION_UNAVAILABLE = "AUTHENTICATION_UNAVAILABLE"
    NON_OPEN_PLAN = "NON_OPEN_PLAN"


class OpenPlanPreflightError(ProviderExecutionError):
    """A safe failure that carries only the public preflight status."""

    def __init__(self, status: OpenPlanPreflightStatus) -> None:
        super().__init__("IBM Quantum Open Plan preflight did not authorize execution")
        self.status = status


@dataclass(frozen=True)
class IbmDryRunPlan:
    mode: str
    entropy_circuit_identifier: str
    chsh_circuit_identifier: str
    required_qubits: int
    steps: tuple[str, ...]
    submits_jobs: bool = False


@dataclass(frozen=True)
class IbmOpenPlanPreflight:
    """Only non-secret account facts needed to allow a bounded real run."""

    status: OpenPlanPreflightStatus
    channel: str
    region: str
    open_plan_confirmed: bool

    def as_evidence(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "status": self.status.value,
            "channel": self.channel,
            "region": self.region,
            "open_plan_confirmed": self.open_plan_confirmed,
        }


@dataclass(frozen=True)
class IbmRealExecution:
    """One authenticated service and one dynamically selected backend for both jobs."""

    preflight: IbmOpenPlanPreflight
    service: Any
    backend: Any
    backend_name: str
    backend_version: str | None


@dataclass(frozen=True)
class IbmJobSubmission:
    """Sanitized job provenance persisted immediately after a successful run call."""

    role: str
    job_id: str
    primitive: str
    backend: str
    backend_version: str | None
    metadata: Mapping[str, Any]


@dataclass(frozen=True)
class ParsedSamplerResult:
    raw: Mapping[str, Any]
    entropy_derived: Mapping[str, Any]
    bell_derived: Mapping[str, Any]


@dataclass(frozen=True)
class ParsedEstimatorResult:
    raw: Mapping[str, Any]
    chsh_derived: Mapping[str, Any]


class IbmRuntimeProvider:
    """Injectable IBM boundary; credentials are neither persisted nor logged."""

    provider_name = "ibm-runtime"
    channel = "ibm_quantum_platform"
    default_region = "us-east"

    def __init__(
        self,
        *,
        token: str | None = None,
        instance: str | None = None,
        service_factory: Callable[..., Any] | None = None,
        sampler_factory: Callable[..., Any] | None = None,
        estimator_factory: Callable[..., Any] | None = None,
        transpiler: Callable[..., Any] = transpile,
    ) -> None:
        self._token = token
        self._instance = instance
        self._service_factory = service_factory
        self._sampler_factory = sampler_factory
        self._estimator_factory = estimator_factory
        self._transpiler = transpiler

    def dry_run(self, *, entropy_qubits: int = 4) -> IbmDryRunPlan:
        if entropy_qubits < 1:
            raise DryRunConfigurationError("entropy_qubits must be positive")
        entropy = build_entropy_circuit(entropy_qubits)
        chsh = build_bell_state_circuit()
        build_chsh_observables()
        return IbmDryRunPlan(
            mode="REAL_DRY_RUN",
            entropy_circuit_identifier=entropy.name,
            chsh_circuit_identifier=chsh.name,
            required_qubits=max(entropy.num_qubits, chsh.num_qubits),
            steps=(
                "inject credential/configuration only at approved execution time",
                "select operational compatible backend with least_busy",
                "transpile each circuit to selected backend ISA",
                "submit entropy with SamplerV2 in job mode",
                "apply ISA layout to CHSH observables and submit EstimatorV2 in job mode",
            ),
        )

    def select_backend(self, service: Any, *, required_qubits: int) -> Any:
        """Dynamic selection that can be exercised with a fake service."""
        return service.least_busy(
            operational=True,
            simulator=False,
            min_num_qubits=required_qubits,
        )

    def _create_service(self) -> Any:  # pragma: no cover - live service requires approved credentials/network.
        if self._service_factory is not None:
            # Retain the F2A factory shape so existing fakes remain credential-free.
            return self._service_factory(token=self._token, instance=self._instance)
        from qiskit_ibm_runtime import QiskitRuntimeService

        options: dict[str, Any] = {"channel": self.channel}
        if self._token is not None:
            options["token"] = self._token
        if self._instance is not None:
            options["instance"] = self._instance
        return QiskitRuntimeService(**options)

    def create_retrieval_service(self) -> Any:
        """Open Runtime directly for persisted-job retrieval, without catalog or backend discovery."""
        if not isinstance(self._token, str) or not self._token.strip():
            raise ProviderExecutionError("retrieval requires a configured IBM Runtime token")
        if not isinstance(self._instance, str) or not self._instance.strip():
            raise ProviderExecutionError("retrieval requires a configured IBM Runtime instance")
        options = {
            "channel": self.channel,
            "token": self._token,
            "instance": self._instance,
        }
        if self._service_factory is not None:
            return self._service_factory(**options)
        from qiskit_ibm_runtime import QiskitRuntimeService

        return QiskitRuntimeService(**options)

    @staticmethod
    def _normalise_identifier(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized if normalized and len(normalized) <= 512 else None

    @staticmethod
    def _normalise_plan(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        matched = re.fullmatch(r"\s*([A-Za-z]+)\s*", value)
        return matched.group(1).casefold() if matched else None

    def _configured_instance(self, account: Mapping[str, Any]) -> str | None:
        return self._normalise_identifier(account.get("instance")) or self._normalise_identifier(
            self._instance
        )

    def _matches_configured_instance(
        self,
        instance: Mapping[str, Any],
        configured_instance: str,
    ) -> bool:
        return configured_instance in {
            identifier
            for identifier in (
                self._normalise_identifier(instance.get("name")),
                self._normalise_identifier(instance.get("crn")),
            )
            if identifier is not None
        }

    def _configured_instance_has_open_plan(
        self,
        service: Any,
        account: Mapping[str, Any],
    ) -> bool:
        configured_instance = self._configured_instance(account)
        if configured_instance is None:
            return False
        instances = service.instances()
        if isinstance(instances, (str, bytes, Mapping)) or not isinstance(instances, Sequence):
            return False
        matching_instances = [
            instance
            for instance in instances
            if isinstance(instance, Mapping)
            and self._matches_configured_instance(instance, configured_instance)
        ]
        return (
            len(matching_instances) == 1
            and self._normalise_plan(matching_instances[0].get("plan")) == "open"
        )

    def _region(self, account: Mapping[str, Any]) -> str:
        instance = account.get("instance") or self._instance
        if isinstance(instance, str) and "us-east" in instance.lower():
            return "us-east"
        return self.default_region

    def _preflight_with_service(self) -> tuple[IbmOpenPlanPreflight, Any | None]:
        try:
            service = self._create_service()
            active_account = service.active_account()
        except Exception:  # Deliberately suppress provider exception text: it can include credentials.
            return (
                IbmOpenPlanPreflight(
                    status=OpenPlanPreflightStatus.AUTHENTICATION_UNAVAILABLE,
                    channel=self.channel,
                    region=self.default_region,
                    open_plan_confirmed=False,
                ),
                None,
            )
        if not isinstance(active_account, Mapping):
            return (
                IbmOpenPlanPreflight(
                    status=OpenPlanPreflightStatus.AUTHENTICATION_UNAVAILABLE,
                    channel=self.channel,
                    region=self.default_region,
                    open_plan_confirmed=False,
                ),
                None,
            )
        account = dict(active_account)
        account_channel = account.get("channel")
        channel = account_channel if isinstance(account_channel, str) else ""
        try:
            open_confirmed = (
                channel == self.channel
                and self._configured_instance_has_open_plan(service, account)
            )
        except Exception:
            return (
                IbmOpenPlanPreflight(
                    status=OpenPlanPreflightStatus.AUTHENTICATION_UNAVAILABLE,
                    channel=channel or self.channel,
                    region=self._region(account),
                    open_plan_confirmed=False,
                ),
                None,
            )
        status = (
            OpenPlanPreflightStatus.AUTHENTICATED_OPEN_PLAN
            if open_confirmed
            else OpenPlanPreflightStatus.NON_OPEN_PLAN
        )
        return (
            IbmOpenPlanPreflight(
                status=status,
                channel=channel or self.channel,
                region=self._region(account),
                open_plan_confirmed=open_confirmed,
            ),
            service if open_confirmed else None,
        )

    def real_preflight(self) -> IbmOpenPlanPreflight:
        """Authenticate only enough to prove the recorded account is explicitly Open Plan."""
        preflight, _ = self._preflight_with_service()
        return preflight

    def authenticated_open_service(self) -> Any:
        """Return a service only after the provider explicitly confirms Open Plan."""
        preflight, service = self._preflight_with_service()
        if service is None:
            raise OpenPlanPreflightError(preflight.status)
        return service

    def prepare_real_execution(self, *, required_qubits: int) -> IbmRealExecution:
        """Authenticate and choose one backend; this method does not submit a job."""
        if required_qubits < 1:
            raise DryRunConfigurationError("required_qubits must be positive")
        preflight, service = self._preflight_with_service()
        if service is None:
            raise OpenPlanPreflightError(preflight.status)
        try:
            backend = self.select_backend(service, required_qubits=required_qubits)
        except Exception as error:
            raise ProviderExecutionError("unable to select an operational IBM backend") from error
        return IbmRealExecution(
            preflight=preflight,
            service=service,
            backend=backend,
            backend_name=self._backend_name(backend),
            backend_version=self._backend_version(backend),
        )

    @staticmethod
    def _backend_name(backend: Any) -> str:
        value = getattr(backend, "name", "unknown")
        value = value() if callable(value) else value
        return str(value) if value else "unknown"

    @staticmethod
    def _backend_version(backend: Any) -> str | None:
        value = getattr(backend, "version", None)
        value = value() if callable(value) else value
        return str(value) if value is not None else None

    @staticmethod
    def _operations(circuit: Any) -> tuple[str, ...]:
        operations: list[str] = []
        for instruction in circuit.data:
            operation = instruction.operation if hasattr(instruction, "operation") else instruction[0]
            operations.append(str(operation.name))
        return tuple(operations)

    def _circuit_metadata(self, circuit: Any) -> dict[str, Any]:
        descriptor = {
            "name": str(circuit.name),
            "qubits": int(circuit.num_qubits),
            "clbits": int(circuit.num_clbits),
            "operations": self._operations(circuit),
        }
        return {
            **descriptor,
            "canonical_sha256": sha256_hex(descriptor),
            "layout": (
                str(circuit.layout)
                if getattr(circuit, "layout", None) is not None
                else None
            ),
        }

    def _transpile_for_backend(
        self,
        circuit: Any,
        *,
        backend: Any,
        transpiler_seed: int | None,
    ) -> Any:
        return self._transpiler(
            circuit,
            backend=backend,
            seed_transpiler=transpiler_seed,
            optimization_level=1,
        )

    def _sampler(self, backend: Any) -> Any:
        if self._sampler_factory is not None:
            return self._sampler_factory(mode=backend)
        from qiskit_ibm_runtime import SamplerV2

        return SamplerV2(mode=backend)

    def _estimator(self, backend: Any) -> Any:
        if self._estimator_factory is not None:
            return self._estimator_factory(mode=backend)
        from qiskit_ibm_runtime import EstimatorV2

        return EstimatorV2(mode=backend)

    @staticmethod
    def _job_id(job: Any) -> str:
        value = getattr(job, "job_id", None)
        value = value() if callable(value) else value
        if not isinstance(value, str) or not value.strip() or len(value) > 240:
            raise ProviderExecutionError("IBM Runtime submission did not return a usable job identifier")
        return value

    def submit_sampler_job(
        self,
        execution: IbmRealExecution,
        *,
        entropy_qubits: int,
        shots: int,
        transpiler_seed: int | None = None,
    ) -> IbmJobSubmission:
        """Submit exactly one grouped SamplerV2 job for independent entropy and Bell counts."""
        if not 256 <= shots <= 512:
            raise DryRunConfigurationError("F2B sampler shots must be from 256 through 512")
        entropy = self._transpile_for_backend(
            build_entropy_circuit(entropy_qubits),
            backend=execution.backend,
            transpiler_seed=transpiler_seed,
        )
        bell = self._transpile_for_backend(
            build_bell_sampling_circuit(),
            backend=execution.backend,
            transpiler_seed=transpiler_seed,
        )
        job = self._sampler(execution.backend).run([entropy, bell], shots=shots)
        return IbmJobSubmission(
            role="SAMPLER_ENTROPY_BELL",
            job_id=self._job_id(job),
            primitive="SamplerV2",
            backend=execution.backend_name,
            backend_version=execution.backend_version,
            metadata={
                "execution_mode": "JOB",
                "shots": shots,
                "transpiler_seed": transpiler_seed,
                "optimization_level": 1,
                "circuits": [self._circuit_metadata(entropy), self._circuit_metadata(bell)],
                "resilience": "provider_default_no_unrecorded_override",
            },
        )

    def submit_chsh_job(
        self,
        execution: IbmRealExecution,
        *,
        shots: int,
        transpiler_seed: int | None = None,
    ) -> IbmJobSubmission:
        """Submit exactly one EstimatorV2 job for all four predeclared CHSH observables."""
        if not 256 <= shots <= 512:
            raise DryRunConfigurationError("F2B estimator shots must be from 256 through 512")
        isa_circuit = self._transpile_for_backend(
            build_bell_state_circuit(),
            backend=execution.backend,
            transpiler_seed=transpiler_seed,
        )
        layout = getattr(isa_circuit, "layout", None)
        observables: list[SparsePauliOp] = [
            observable.apply_layout(layout) if layout is not None else observable
            for observable in build_chsh_observables().values()
        ]
        precision = 1 / math.sqrt(shots)
        job = self._estimator(execution.backend).run(
            [(isa_circuit, observables)],
            precision=precision,
        )
        return IbmJobSubmission(
            role="ESTIMATOR_CHSH",
            job_id=self._job_id(job),
            primitive="EstimatorV2",
            backend=execution.backend_name,
            backend_version=execution.backend_version,
            metadata={
                "execution_mode": "JOB",
                "requested_shots": shots,
                "requested_precision": precision,
                "transpiler_seed": transpiler_seed,
                "optimization_level": 1,
                "circuit": self._circuit_metadata(isa_circuit),
                "observable_identifiers": list(build_chsh_observables()),
                "sign_convention": "E00 + E01 + E10 - E11",
                "resilience": "provider_default_no_unrecorded_override",
            },
        )

    @staticmethod
    def job_status(job: Any) -> str:
        """Normalize string and enum success states to the single local terminal state DONE."""
        value = job.status()
        if hasattr(value, "value"):
            value = value.value
        elif hasattr(value, "name"):
            value = value.name
        status = str(value).strip().upper().rsplit(".", maxsplit=1)[-1]
        if re.fullmatch(r"[A-Z][A-Z0-9_]{1,79}", status) is None:
            raise ProviderExecutionError("IBM Runtime returned an unsupported job status")
        return "DONE" if status in {"DONE", "COMPLETED", "SUCCESS"} else status

    @staticmethod
    def job_result(job: Any) -> Any:
        return job.result()

    @staticmethod
    def get_job(service: Any, job_id: str) -> Any:
        return service.job(job_id)

    @staticmethod
    def _measurement_result(item: Any) -> Any:
        data = getattr(item, "data", item)
        measurement = getattr(data, "meas", None)
        if measurement is None and isinstance(data, Mapping):
            measurement = data.get("meas")
        if measurement is None:
            raise ProviderExecutionError("SamplerV2 result has no measurement data")
        return measurement

    @staticmethod
    def _as_bitstrings(measurement: Any) -> list[str]:
        values = measurement.get_bitstrings()
        bitstrings = [str(value) for value in values]
        if not bitstrings or any(not value or set(value) - {"0", "1"} for value in bitstrings):
            raise ProviderExecutionError("SamplerV2 result contains invalid bitstrings")
        return bitstrings

    @staticmethod
    def _as_counts(measurement: Any) -> dict[str, int]:
        values = measurement.get_counts()
        counts = {str(key): int(value) for key, value in dict(values).items()}
        if any(value < 0 for value in counts.values()):
            raise ProviderExecutionError("SamplerV2 result contains invalid counts")
        return counts

    def parse_sampler_result(self, result: Sequence[Any]) -> ParsedSamplerResult:
        """Normalize the two-pub real Sampler result without inventing scientific claims."""
        publications = list(result)
        if len(publications) != 2:
            raise ProviderExecutionError("F2B sampler result must contain entropy and Bell publications")
        entropy_bits = self._as_bitstrings(self._measurement_result(publications[0]))
        bell_bits = self._as_bitstrings(self._measurement_result(publications[1]))
        if any(len(value) != 2 for value in bell_bits):
            raise ProviderExecutionError("F2B Bell result must contain two-bit outcomes")
        entropy_counts = self._as_counts(self._measurement_result(publications[0]))
        bell_counts = self._as_counts(self._measurement_result(publications[1]))
        if sum(entropy_counts.values()) != len(entropy_bits) or sum(bell_counts.values()) != len(bell_bits):
            raise ProviderExecutionError("SamplerV2 counts do not match returned shots")
        normalized_bell_counts = {key: bell_counts.get(key, 0) for key in ("00", "01", "10", "11")}
        if set(bell_counts) - set(normalized_bell_counts):
            raise ProviderExecutionError("F2B Bell result has an unsupported outcome")
        correlation = (
            normalized_bell_counts["00"]
            + normalized_bell_counts["11"]
            - normalized_bell_counts["01"]
            - normalized_bell_counts["10"]
        ) / len(bell_bits)
        ordered_bits = "".join(entropy_bits)
        byte_bit_length = len(ordered_bits) - (len(ordered_bits) % 8)
        byte_values = [
            int(ordered_bits[index : index + 8], 2)
            for index in range(0, byte_bit_length, 8)
        ]
        word_bit_length = len(ordered_bits) - (len(ordered_bits) % 32)
        uint32_values = [
            int(ordered_bits[index : index + 32], 2)
            for index in range(0, word_bit_length, 32)
        ]
        raw = {
            "schema_version": 1,
            "provider": self.provider_name,
            "mode": "REAL",
            "entropy": {"bitstrings": entropy_bits, "counts": entropy_counts},
            "bell": {"bitstrings": bell_bits, "counts": normalized_bell_counts},
        }
        entropy_derived = {
            "schema_version": 1,
            "derivation_version": "f2b-real-v1",
            "mode": "REAL",
            "workload": "ENTROPY_HARVEST",
            "source_raw": "sampler-raw.json",
            "bit_order": "provider-returned shot bitstrings concatenated in returned order",
            "entropy_bytes_hex": bytes(byte_values).hex(),
            "uint32_values": uint32_values,
            "accepted_byte_bits": byte_bit_length,
            "discarded_byte_bits": len(ordered_bits) - byte_bit_length,
            "discarded_word_bits": len(ordered_bits) - word_bit_length,
            "interpretation": "RAW_HARDWARE_MEASUREMENT_INPUT_NOT_CERTIFIED_RANDOMNESS",
        }
        bell_derived = {
            "schema_version": 1,
            "derivation_version": "f2b-real-v1",
            "mode": "REAL",
            "workload": "BELL_CORRELATION",
            "source_raw": "sampler-raw.json",
            "counts": normalized_bell_counts,
            "observed_correlation": correlation,
            "interpretation": "ONE_BASIS_CORRELATION_ONLY",
        }
        return ParsedSamplerResult(raw=raw, entropy_derived=entropy_derived, bell_derived=bell_derived)

    @staticmethod
    def _data_field(data: Any, name: str) -> Any:
        value = getattr(data, name, None)
        if value is None and isinstance(data, Mapping):
            value = data.get(name)
        return value

    def parse_estimator_result(self, result: Sequence[Any]) -> ParsedEstimatorResult:
        """Derive the declared CHSH witness and a conservative one-sigma classification."""
        publications = list(result)
        if len(publications) != 1:
            raise ProviderExecutionError("F2B estimator result must contain one CHSH publication")
        data = getattr(publications[0], "data", publications[0])
        values = [float(value) for value in self._data_field(data, "evs")]
        errors_value = self._data_field(data, "stds")
        errors = [float(value) for value in errors_value] if errors_value is not None else []
        if len(values) != 4 or any(not math.isfinite(value) or abs(value) > 1 for value in values):
            raise ProviderExecutionError("EstimatorV2 returned invalid CHSH expectation values")
        if errors and (len(errors) != 4 or any(not math.isfinite(value) or value < 0 for value in errors)):
            raise ProviderExecutionError("EstimatorV2 returned invalid CHSH standard errors")
        expectations = dict(zip(("E00", "E01", "E10", "E11"), values, strict=True))
        witness = expectations["E00"] + expectations["E01"] + expectations["E10"] - expectations["E11"]
        standard_error = math.sqrt(sum(value * value for value in errors)) if errors else None
        if standard_error is None:
            classification = "UNCERTAINTY_UNAVAILABLE"
        elif abs(witness) - standard_error > 2:
            classification = "EXCEEDS_CLASSICAL_BOUND_WITH_1_SIGMA_MARGIN"
        elif abs(witness) + standard_error <= 2:
            classification = "DOES_NOT_EXCEED_CLASSICAL_BOUND"
        else:
            classification = "INCONCLUSIVE_WITH_1_SIGMA_UNCERTAINTY"
        raw = {
            "schema_version": 1,
            "provider": self.provider_name,
            "mode": "REAL",
            "expectation_values": expectations,
            "standard_errors": dict(zip(("E00", "E01", "E10", "E11"), errors, strict=True)) if errors else None,
        }
        derived = {
            "schema_version": 1,
            "derivation_version": "f2b-real-v1",
            "mode": "REAL",
            "workload": "CHSH_EVIDENCE",
            "source_raw": "estimator-raw.json",
            "expectation_values": expectations,
            "witness": witness,
            "standard_error": standard_error,
            "classical_bound": 2.0,
            "sign_convention": "E00 + E01 + E10 - E11",
            "classification": classification,
            "interpretation": "REAL_WITH_UNCERTAINTY",
        }
        return ParsedEstimatorResult(raw=raw, chsh_derived=derived)

    # Compatibility helpers retained from F2A; they are not reached by the F2B CLI.
    def submit_entropy_job(  # pragma: no cover
        self,
        *,
        qubit_count: int,
        shots: int,
        transpiler_seed: int | None = None,
    ) -> Any:
        from qiskit_ibm_runtime import SamplerV2

        service = self._create_service()
        backend = self.select_backend(service, required_qubits=qubit_count)
        isa_circuit = transpile(
            build_entropy_circuit(qubit_count),
            backend=backend,
            seed_transpiler=transpiler_seed,
        )
        sampler = SamplerV2(mode=backend)
        return sampler.run([isa_circuit], shots=shots)

    def submit_legacy_chsh_job(  # pragma: no cover
        self,
        *,
        transpiler_seed: int | None = None,
    ) -> Any:
        from qiskit_ibm_runtime import EstimatorV2

        service = self._create_service()
        backend = self.select_backend(service, required_qubits=2)
        isa_circuit = transpile(
            build_bell_state_circuit(),
            backend=backend,
            seed_transpiler=transpiler_seed,
        )
        observables: list[SparsePauliOp] = [
            observable.apply_layout(isa_circuit.layout)
            for observable in build_chsh_observables().values()
        ]
        estimator = EstimatorV2(mode=backend)
        return estimator.run([(isa_circuit, observables)])
