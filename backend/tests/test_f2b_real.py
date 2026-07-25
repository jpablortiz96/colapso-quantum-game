"""Directed F2B tests using Qiskit Runtime V2 container shapes without IBM access."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from qiskit.primitives import BitArray, DataBin, PrimitiveResult, PubResult, SamplerPubResult

from colapso_quantum import cli
from colapso_quantum.evidence import sha256_file
from colapso_quantum.providers.ibm_runtime import IbmRuntimeProvider, OpenPlanPreflightStatus
from colapso_quantum.real_evidence import RealEvidenceStore
from colapso_quantum.runtime_v2 import RuntimeV2FormatError, parse_estimator_v2, parse_sampler_v2


class FakeBackend:
    name = "fake-open-backend"
    version = "test-target-1"


class FakeJob:
    def __init__(self, identifier: str, *, status: str = "QUEUED", result: Any = None) -> None:
        self._identifier = identifier
        self._status = status
        self._result = result
        self.result_calls = 0

    def job_id(self) -> str:
        return self._identifier

    def status(self) -> str:
        return self._status

    def result(self) -> Any:
        self.result_calls += 1
        return self._result


class FakeService:
    def __init__(
        self,
        *,
        account: dict[str, Any],
        jobs: dict[str, FakeJob] | None = None,
        instances: list[dict[str, Any]] | None = None,
        catalog_error: bool = False,
    ) -> None:
        self.account = account
        self.jobs = jobs or {}
        self.least_busy_calls = 0
        self.instance_calls = 0
        self.job_calls: list[str] = []
        self.catalog_error = catalog_error
        active_instance = account.get("instance")
        self.instance_records = instances if instances is not None else [
            {"name": active_instance, "plan": account.get("plan")}
        ]

    def active_account(self) -> dict[str, Any]:
        return self.account

    def instances(self) -> list[dict[str, Any]]:
        self.instance_calls += 1
        if self.catalog_error:
            raise OSError("catalog DNS unavailable")
        return self.instance_records

    def least_busy(self, **_: Any) -> FakeBackend:
        self.least_busy_calls += 1
        return FakeBackend()

    def job(self, identifier: str) -> FakeJob:
        self.job_calls.append(identifier)
        return self.jobs[identifier]


class FakeSampler:
    def __init__(self, *, mode: Any) -> None:
        self.mode = mode
        self.calls: list[tuple[Any, int]] = []

    def run(self, publications: Any, *, shots: int) -> FakeJob:
        self.calls.append((publications, shots))
        return FakeJob("sampler-job")


class FakeEstimator:
    def __init__(self, *, mode: Any) -> None:
        self.mode = mode
        self.calls: list[tuple[Any, float]] = []

    def run(self, publications: Any, *, precision: float) -> FakeJob:
        self.calls.append((publications, precision))
        return FakeJob("estimator-job")


class InconsistentBitArray:
    """V2-shape fake that deliberately violates the BitArray shot-count contract."""

    array = np.zeros((4, 1), dtype=np.uint8)
    num_bits = 2
    num_shots = 5

    @staticmethod
    def get_counts() -> dict[str, int]:
        return {"00": 2, "11": 2}

    @staticmethod
    def get_bitstrings() -> list[str]:
        return ["00", "11", "00", "11"]


def open_account() -> dict[str, str]:
    return {
        "channel": "ibm_quantum_platform",
        "plan": "open",
        "instance": "ibm-q/open/main/us-east",
    }


def fake_provider(
    *, service: FakeService | None = None
) -> tuple[IbmRuntimeProvider, FakeSampler, FakeEstimator, FakeService]:
    runtime_service = service or FakeService(account=open_account())
    sampler = FakeSampler(mode=FakeBackend())
    estimator = FakeEstimator(mode=FakeBackend())
    provider = IbmRuntimeProvider(
        token="test-token",
        instance="test-instance",
        service_factory=lambda **_: runtime_service,
        sampler_factory=lambda **kwargs: sampler,
        estimator_factory=lambda **kwargs: estimator,
        transpiler=lambda circuit, **_: circuit,
    )
    return provider, sampler, estimator, runtime_service


def prepared_store(tmp_path: Path, *, run_id: str = "real-fake-001") -> RealEvidenceStore:
    return RealEvidenceStore.create_prepared(
        evidence_root=tmp_path,
        run_id=run_id,
        created_at_utc=datetime(2026, 7, 20, tzinfo=UTC),
        preflight={
            "schema_version": 1,
            "status": "AUTHENTICATED_OPEN_PLAN",
            "channel": "ibm_quantum_platform",
            "region": "us-east",
            "open_plan_confirmed": True,
        },
        submission_configuration={
            "execution_mode": "JOB",
            "maximum_real_jobs": 2,
            "sampler_workloads_grouped": ["ENTROPY_HARVEST", "BELL_CORRELATION"],
            "chsh_workload": "CHSH_EVIDENCE",
            "shots": 256,
        },
    )


def record_jobs(store: RealEvidenceStore) -> None:
    store.record_job(
        role="SAMPLER_ENTROPY_BELL",
        job_id="job-0",
        backend="fake-open-backend",
        backend_version="test-target-1",
        primitive="SamplerV2",
        submission_metadata={
            "execution_mode": "JOB",
            "shots": 256,
            "circuits": [{"name": "entropy-h-4"}, {"name": "bell-correlation-z"}],
        },
        submitted_at_utc=datetime(2026, 7, 20, tzinfo=UTC),
    )
    store.record_job(
        role="ESTIMATOR_CHSH",
        job_id="job-1",
        backend="fake-open-backend",
        backend_version="test-target-1",
        primitive="EstimatorV2",
        submission_metadata={
            "execution_mode": "JOB",
            "requested_shots": 256,
            "requested_precision": 0.0625,
            "observable_identifiers": ["E00", "E01", "E10", "E11"],
            "sign_convention": "E00 + E01 + E10 - E11",
        },
        submitted_at_utc=datetime(2026, 7, 20, tzinfo=UTC),
    )


def sampler_v2_result(*, multiple_registers: bool = False, bell_bits: int = 2) -> PrimitiveResult:
    entropy_data = (
        DataBin(
            alpha_register=BitArray.from_samples(["0", "1", "1", "0"], num_bits=1),
            beta_register=BitArray.from_samples(["1", "0", "0", "1"], num_bits=1),
        )
        if multiple_registers
        else DataBin(
            entropy_register=BitArray.from_samples(
                ["0000", "1111", "0101", "1010"], num_bits=4
            )
        )
    )
    bell_samples = ["00", "11", "00", "11"] if bell_bits == 2 else ["000", "111", "000", "111"]
    return PrimitiveResult(
        [
            SamplerPubResult(
                entropy_data,
                metadata={"pub_kind": "entropy", "shot_array": np.array([4], dtype=np.int64)},
            ),
            SamplerPubResult(
                DataBin(pair_register=BitArray.from_samples(bell_samples, num_bits=bell_bits)),
                metadata={"pub_kind": "bell"},
            ),
        ],
        metadata={"container_array": np.array([1, 2], dtype=np.int64)},
    )


def estimator_v2_result(
    *, error_field: str | None = "stds", multiple_pubs: bool = False
) -> PrimitiveResult:
    metadata = {"array_metadata": np.array([1, 2], dtype=np.int64), "api_token": "redact-me"}
    values = np.array([0.7, 0.7, 0.7, -0.7], dtype=np.float64)
    errors = np.array([0.05, 0.05, 0.05, 0.05], dtype=np.float64)
    if multiple_pubs:
        first_data = DataBin(evs=values[:2], **({error_field: errors[:2]} if error_field else {}))
        second_data = DataBin(evs=values[2:], **({error_field: errors[2:]} if error_field else {}))
        return PrimitiveResult(
            [PubResult(first_data, metadata={"pub": 0}), PubResult(second_data, metadata={"pub": 1})],
            metadata=metadata,
        )
    return PrimitiveResult(
        [PubResult(DataBin(evs=values, **({error_field: errors} if error_field else {})), metadata={"pub": 0})],
        metadata=metadata,
    )


def test_preflight_uses_only_the_matching_instance_and_exact_open_plan() -> None:
    name_service = FakeService(
        account={"channel": "ibm_quantum_platform", "instance": "open-instance"},
        instances=[{"name": "open-instance", "crn": "crn:fake:open-instance", "plan": " Open "}],
    )
    crn_service = FakeService(
        account={"channel": "ibm_quantum_platform", "instance": "crn:fake:open-instance"},
        instances=[{"name": "different-name", "crn": "crn:fake:open-instance", "plan": "open"}],
    )
    non_open_service = FakeService(
        account={"channel": "ibm_quantum_platform", "instance": "paid-instance"},
        instances=[{"name": "paid-instance", "plan": "premium"}],
    )

    assert (
        IbmRuntimeProvider(service_factory=lambda **_: name_service).real_preflight().status
        is OpenPlanPreflightStatus.AUTHENTICATED_OPEN_PLAN
    )
    assert (
        IbmRuntimeProvider(service_factory=lambda **_: crn_service).real_preflight().status
        is OpenPlanPreflightStatus.AUTHENTICATED_OPEN_PLAN
    )
    assert (
        IbmRuntimeProvider(service_factory=lambda **_: non_open_service).real_preflight().status
        is OpenPlanPreflightStatus.NON_OPEN_PLAN
    )


def test_real_submit_creates_exactly_two_jobs_with_shared_backend(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider, sampler, estimator, service = fake_provider()
    monkeypatch.setattr(cli, "_runtime_provider", lambda: provider)

    assert cli.main(["real-submit", "--run-id", "real-fake-submit", "--evidence-root", str(tmp_path)]) == 0

    manifest = RealEvidenceStore.open(evidence_root=tmp_path, run_id="real-fake-submit").manifest()
    assert len(sampler.calls) == 1
    assert len(estimator.calls) == 1
    assert len(sampler.calls[0][0]) == 2
    assert manifest["state"] == "SUBMITTED"
    assert {job["backend"] for job in manifest["jobs"]} == {"fake-open-backend"}
    assert service.least_busy_calls == 1


def test_sampler_v2_reads_dynamic_registers_multiple_pubs_and_counts() -> None:
    parsed = parse_sampler_v2(
        sampler_v2_result(),
        circuit_labels=["entropy-h-4", "bell-correlation-z"],
        workloads=["ENTROPY_HARVEST", "BELL_CORRELATION"],
        runtime_raw_sha256="a" * 64,
    )

    assert parsed.structure["container"]["class"] == "PrimitiveResult"
    assert parsed.structure["length"] == 2
    assert parsed.sampler_raw["pubs"][0]["registers"][0]["name"] == "entropy_register"
    assert parsed.sampler_raw["pubs"][1]["registers"][0]["name"] == "pair_register"
    assert parsed.entropy_derived["source_counts"] == {"0000": 1, "0101": 1, "1010": 1, "1111": 1}
    assert parsed.entropy_derived["shots"] == 4
    assert parsed.bell_derived["counts"] == {"00": 2, "01": 0, "10": 0, "11": 2}
    assert parsed.bell_derived["observed_correlation"] == 1.0


def test_sampler_v2_joins_multiple_classical_registers_in_preserved_order() -> None:
    parsed = parse_sampler_v2(
        sampler_v2_result(multiple_registers=True),
        circuit_labels=["entropy-h-4", "bell-correlation-z"],
        workloads=["ENTROPY_HARVEST", "BELL_CORRELATION"],
        runtime_raw_sha256="b" * 64,
    )

    combined = parsed.sampler_raw["pubs"][0]["combined"]
    assert combined["method"] == "SamplerPubResult.join_data"
    assert combined["register_order"] == ["alpha_register", "beta_register"]
    assert sum(combined["counts"].values()) == combined["num_shots"]


def test_sampler_v2_rejects_count_shot_mismatch() -> None:
    invalid_result = PrimitiveResult(
        [
            SamplerPubResult(DataBin(non_meas_register=InconsistentBitArray())),
            SamplerPubResult(DataBin(pair_register=BitArray.from_samples(["00", "11"], num_bits=2))),
        ]
    )

    with pytest.raises(RuntimeV2FormatError, match="counts do not match"):
        parse_sampler_v2(
            invalid_result,
            circuit_labels=["entropy-h-4", "bell-correlation-z"],
            workloads=["ENTROPY_HARVEST", "BELL_CORRELATION"],
            runtime_raw_sha256="c" * 64,
        )


def test_estimator_v2_preserves_numpy_metadata_evs_stds_and_observable_indices() -> None:
    parsed = parse_estimator_v2(
        estimator_v2_result(),
        observable_labels=["E00", "E01", "E10", "E11"],
        convention="E00 + E01 + E10 - E11",
        runtime_raw_sha256="d" * 64,
    )

    raw_pub = parsed.estimator_raw["pubs"][0]
    assert raw_pub["evs"] == {"field": "evs", "shape": [4], "dtype": "float64", "values": [0.7, 0.7, 0.7, -0.7]}
    assert raw_pub["standard_error"]["field"] == "stds"
    assert raw_pub["observables"][3] == {
        "observable_index": 3,
        "observable_label": "E11",
        "ev": -0.7,
        "standard_error": 0.05,
    }
    assert parsed.structure["metadata"]["array_metadata"] == [1, 2]
    assert parsed.structure["metadata"]["redacted_metadata_field_1"] == "[REDACTED]"
    assert parsed.chsh_derived["witness"] == pytest.approx(2.8)
    assert parsed.chsh_derived["propagated_standard_error"] == pytest.approx(0.1)
    assert parsed.chsh_derived["classification"] == "STATISTICALLY_SUPPORTED_ABOVE_CLASSICAL_LIMIT"


def test_estimator_v2_supports_ensemble_standard_error_across_multiple_pubs() -> None:
    parsed = parse_estimator_v2(
        estimator_v2_result(error_field="ensemble_standard_error", multiple_pubs=True),
        observable_labels=["E00", "E01", "E10", "E11"],
        convention="E00 + E01 + E10 - E11",
        runtime_raw_sha256="e" * 64,
    )

    assert [pub["pub_index"] for pub in parsed.estimator_raw["pubs"]] == [0, 1]
    assert parsed.estimator_raw["pubs"][0]["standard_error"]["field"] == "ensemble_standard_error"
    assert parsed.estimator_raw["pubs"][1]["observables"][1]["observable_label"] == "E11"
    assert parsed.chsh_derived["standard_error_source"] == "ensemble_standard_error"


def test_estimator_v2_rejects_missing_explicit_chsh_order() -> None:
    with pytest.raises(RuntimeV2FormatError, match="order is absent or incomplete"):
        parse_estimator_v2(
            estimator_v2_result(),
            observable_labels=["E00", "E01", "E10"],
            convention="E00 + E01 + E10 - E11",
            runtime_raw_sha256="f" * 64,
        )


def test_runtime_encoder_raw_is_persisted_atomically_before_any_parser(tmp_path: Path) -> None:
    store = prepared_store(tmp_path)
    record_jobs(store)

    digest = store.record_runtime_raw(
        job_id="job-0",
        raw_filename="sampler-runtime-raw.json",
        result=sampler_v2_result(),
        retrieved_at_utc=datetime(2026, 7, 20, tzinfo=UTC),
    )

    raw_path = store.path / "sampler-runtime-raw.json"
    encoded = json.loads(raw_path.read_text("utf-8"))
    assert encoded["__type__"] == "PrimitiveResult"
    assert sha256_file(raw_path) == digest
    assert store.manifest()["runtime_raw_artifacts"] == {"sampler-runtime-raw.json": digest}
    assert not raw_path.with_suffix(".json.tmp").exists()
    store.validate()


def test_real_retrieve_opens_done_jobs_once_without_catalog_or_submit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared_store(tmp_path)
    record_jobs(store)
    sampler_job = FakeJob("job-0", status="DONE", result=sampler_v2_result())
    estimator_job = FakeJob("job-1", status="DONE", result=estimator_v2_result())
    service = FakeService(
        account={},
        catalog_error=True,
        jobs={"job-0": sampler_job, "job-1": estimator_job},
    )
    factory_options: dict[str, Any] = {}

    def retrieval_factory(**options: Any) -> FakeService:
        factory_options.update(options)
        return service

    provider = IbmRuntimeProvider(
        token="test-token",
        instance="test-instance",
        service_factory=retrieval_factory,
    )

    def forbidden_submit(*_: Any, **__: Any) -> None:
        raise AssertionError("retrieval must not submit a job")

    monkeypatch.setattr(provider, "submit_sampler_job", forbidden_submit)
    monkeypatch.setattr(provider, "submit_chsh_job", forbidden_submit)
    monkeypatch.setattr(cli, "_runtime_provider", lambda: provider)

    assert cli.main(["real-retrieve", "--run-id", "real-fake-001", "--evidence-root", str(tmp_path)]) == 0

    complete = RealEvidenceStore.open(evidence_root=tmp_path, run_id="real-fake-001")
    assert factory_options == {
        "channel": "ibm_quantum_platform",
        "token": "test-token",
        "instance": "test-instance",
    }
    assert service.instance_calls == 0
    assert service.least_busy_calls == 0
    assert service.job_calls == ["job-0", "job-1"]
    assert sampler_job.result_calls == 1
    assert estimator_job.result_calls == 1
    assert complete.manifest()["state"] == "COMPLETE"
    provenance = json.loads((complete.path / "provenance.json").read_text("utf-8"))
    sampler_provenance, estimator_provenance = provenance["jobs"]
    assert sampler_provenance["execution_parameters"] == {"shots": 256}
    assert estimator_provenance["execution_parameters"] == {"requested_precision": 0.0625, "requested_shots": 256}
    assert sampler_provenance["derived_artifact_hashes"] == {
        name: complete.manifest()["derived_artifacts"][name]
        for name in sampler_provenance["derived_artifacts"]
    }
    assert {
        "sampler-runtime-raw.json",
        "estimator-runtime-raw.json",
        "result-structure.json",
        "sampler-raw.json",
        "estimator-raw.json",
        "entropy-derived.json",
        "bell-derived.json",
        "chsh-derived.json",
        "provenance.json",
    }.issubset({path.name for path in complete.path.iterdir()})


def test_real_retrieve_does_not_poll_or_download_nonterminal_jobs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared_store(tmp_path)
    record_jobs(store)
    queued_job = FakeJob("job-0", status="QUEUED", result=sampler_v2_result())
    service = FakeService(
        account={},
        catalog_error=True,
        jobs={"job-0": queued_job, "job-1": FakeJob("job-1", status="DONE", result=estimator_v2_result())},
    )
    provider = IbmRuntimeProvider(
        token="test-token",
        instance="test-instance",
        service_factory=lambda **_: service,
    )
    monkeypatch.setattr(cli, "_runtime_provider", lambda: provider)

    assert cli.main(["real-retrieve", "--run-id", "real-fake-001", "--evidence-root", str(tmp_path)]) == 2

    assert queued_job.result_calls == 0
    assert service.instance_calls == 0
    assert [job["poll_count"] for job in store.manifest()["jobs"]] == [0, 0]


def test_real_retrieve_preserves_raw_when_structural_parsing_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = prepared_store(tmp_path)
    record_jobs(store)
    sampler_job = FakeJob("job-0", status="DONE", result=sampler_v2_result(bell_bits=3))
    estimator_job = FakeJob("job-1", status="DONE", result=estimator_v2_result())
    service = FakeService(account={}, jobs={"job-0": sampler_job, "job-1": estimator_job})
    provider = IbmRuntimeProvider(
        token="test-token",
        instance="test-instance",
        service_factory=lambda **_: service,
    )
    monkeypatch.setattr(cli, "_runtime_provider", lambda: provider)

    assert cli.main(["real-retrieve", "--run-id", "real-fake-001", "--evidence-root", str(tmp_path)]) == 2

    partial = RealEvidenceStore.open(evidence_root=tmp_path, run_id="real-fake-001")
    assert partial.manifest()["state"] == "PARTIAL_RESULTS_PRESERVED"
    assert (partial.path / "sampler-runtime-raw.json").exists()
    assert (partial.path / "estimator-runtime-raw.json").exists()
    assert partial.manifest()["result_preservation_errors"][0]["error_code"] == "V2_RESULT_PARSER_FAILED"
    assert sampler_job.result_calls == 1
    assert estimator_job.result_calls == 1


def test_real_store_detects_hash_tampering(tmp_path: Path) -> None:
    store = prepared_store(tmp_path)
    record_jobs(store)
    (store.path / "preflight.json").write_text("{}", "utf-8")

    with pytest.raises(Exception, match="SHA256SUMS"):
        store.validate()


def test_adapter_rejects_malformed_status_without_runtime_calls() -> None:
    provider, _, _, _ = fake_provider()

    with pytest.raises(Exception, match="unsupported job status"):
        provider.job_status(FakeJob("bad", status="?"))
    with pytest.raises(Exception, match="required_qubits"):
        provider.prepare_real_execution(required_qubits=0)
