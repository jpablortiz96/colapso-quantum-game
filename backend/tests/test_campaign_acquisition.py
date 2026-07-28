from __future__ import annotations

import builtins
import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "acquire_campaign_quantum_evidence.py"
SPEC = importlib.util.spec_from_file_location("colapso_campaign_acquisition", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
campaign = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = campaign
SPEC.loader.exec_module(campaign)


class FakeBackend:
    name = "ibm_fez"
    version = "test-version"

    @staticmethod
    def configuration() -> SimpleNamespace:
        return SimpleNamespace(simulator=False)

    @staticmethod
    def status() -> SimpleNamespace:
        return SimpleNamespace(operational=True, pending_jobs=2)


class FakeService:
    def __init__(self) -> None:
        self.backend_value = FakeBackend()
        self.requested_job_ids: list[str] = []

    @staticmethod
    def active_instance() -> str:
        return "private-instance-reference"

    @staticmethod
    def instances() -> list[dict[str, Any]]:
        return [
            {
                "name": "private-instance-reference",
                "plan": "open",
                "private_detail": "must-not-be-printed",
            }
        ]

    @staticmethod
    def usage() -> dict[str, Any]:
        return {
            "usage_consumed_seconds": 13,
            "usage_limit_seconds": 600,
            "usage_remaining_seconds": 587,
            "usage_limit_reached": False,
        }

    def backend(self, name: str) -> FakeBackend:
        assert name == "ibm_fez"
        return self.backend_value

    def job(self, job_id: str) -> SimpleNamespace:
        self.requested_job_ids.append(job_id)
        return SimpleNamespace(job_id=job_id)


class FakeProvider:
    def __init__(self, *job_ids: str) -> None:
        self._job_ids = iter(job_ids)
        self.submissions: list[dict[str, Any]] = []
        self.status = "RUNNING"

    def submit_sampler_job(self, execution: Any, **options: Any) -> SimpleNamespace:
        self.submissions.append({"execution": execution, **options})
        return SimpleNamespace(
            job_id=next(self._job_ids),
            primitive="SamplerV2",
            backend="ibm_fez",
            backend_version="test-version",
            metadata={
                "execution_mode": "JOB",
                "circuits": [{"name": "entropy"}, {"name": "bell"}],
            },
        )

    def job_status(self, job: Any) -> str:
        return self.status

    @staticmethod
    def job_result(job: Any) -> Any:
        raise AssertionError("These state-machine tests must not retrieve a result")


def make_credentials_file(tmp_path: Path) -> Path:
    path = tmp_path / "operator-store.json"
    path.write_text("{}", encoding="utf-8")
    return path


def make_service_factory(service: FakeService, calls: list[dict[str, Any]]) -> Any:
    def factory(**options: Any) -> FakeService:
        calls.append(options)
        return service

    return factory


def submit_first_job(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    job_ids: tuple[str, ...] = ("campaign-job-00000001",),
) -> tuple[Path, Path, FakeService, list[dict[str, Any]], FakeProvider]:
    evidence_root = tmp_path / "evidence"
    evidence_root.mkdir()
    credentials_file = make_credentials_file(tmp_path)
    service = FakeService()
    factory_calls: list[dict[str, Any]] = []
    provider = FakeProvider(*job_ids)
    monkeypatch.setattr(campaign, "_verify_universe_one", lambda _root: None)
    campaign.submit_next_universe(
        evidence_root,
        str(credentials_file),
        confirmed=True,
        service_factory=make_service_factory(service, factory_calls),
        provider=provider,
    )
    return evidence_root, credentials_file, service, factory_calls, provider


def test_live_service_uses_explicit_filename_without_reading_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    credentials_file = make_credentials_file(tmp_path)
    service = FakeService()
    calls: list[dict[str, Any]] = []

    def forbidden_open(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("The credential file must never be opened by the runner")

    monkeypatch.setattr(builtins, "open", forbidden_open)
    loaded = campaign._create_live_service(
        str(credentials_file),
        "colapso",
        service_factory=make_service_factory(service, calls),
    )

    assert loaded is service
    assert calls == [{"name": "colapso", "filename": str(credentials_file)}]


def test_preflight_has_exact_allowlist_and_never_submits(tmp_path: Path) -> None:
    credentials_file = make_credentials_file(tmp_path)
    service = FakeService()
    calls: list[dict[str, Any]] = []

    report = campaign.run_preflight_only(
        str(credentials_file),
        service_factory=make_service_factory(service, calls),
    )

    assert report == {
        "saved_account_loaded": True,
        "plan": "open",
        "usage_consumed_seconds": 13.0,
        "usage_limit_seconds": 600.0,
        "usage_remaining_seconds": 587.0,
        "usage_limit_reached": False,
        "backend": "ibm_fez",
        "hardware_backend": True,
        "operational": True,
        "pending_jobs": 2,
        "conservative_four_job_usage_estimate_seconds": 120,
    }
    assert calls == [{"name": "colapso", "filename": str(credentials_file)}]
    assert service.requested_job_ids == []


def test_submit_persists_job_immediately_and_blocks_queued_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    evidence_root, credentials_file, service, calls, provider = submit_first_job(
        tmp_path,
        monkeypatch,
    )
    state_path = evidence_root / "campaign-acquisition-state.json"
    assert not (evidence_root / campaign._LOCK_FILENAME).exists()
    state = json.loads(state_path.read_text("utf-8"))
    first = state["universes"][0]

    assert first["universe_number"] == 2
    assert first["job_id"] == "campaign-job-00000001"
    assert first["current_status"] == "SUBMITTED"
    assert first["result_preserved"] is False
    assert len(provider.submissions) == 1
    assert provider.submissions[0]["shots"] == 256
    assert provider.submissions[0]["max_execution_time"] == 30

    directory = evidence_root / "universe-002"
    campaign._update_status(directory, first["job_id"], "QUEUED")
    with pytest.raises(campaign.CampaignEvidenceError, match="EXISTING_JOB_REQUIRES_RESUME"):
        campaign.submit_next_universe(
            evidence_root,
            str(credentials_file),
            confirmed=True,
            service_factory=make_service_factory(service, calls),
            provider=provider,
        )

    synchronized = json.loads(state_path.read_text("utf-8"))["universes"][0]
    assert synchronized["current_status"] == "QUEUED"
    assert len(provider.submissions) == 1
    output = capsys.readouterr().out
    assert str(credentials_file) not in output
    assert "private-instance-reference" not in output
    assert "must-not-be-printed" not in output
    assert "campaign-job-00000001" not in output
    assert "campaign...0001" in output


def test_poll_only_reuses_existing_job_id_and_never_submits(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence_root, credentials_file, service, calls, provider = submit_first_job(
        tmp_path,
        monkeypatch,
    )
    provider.status = "RUNNING"

    report = campaign.poll_existing_jobs_once(
        evidence_root,
        str(credentials_file),
        service_factory=make_service_factory(service, calls),
        provider=provider,
    )

    assert service.requested_job_ids == ["campaign-job-00000001"]
    assert len(provider.submissions) == 1
    assert report == {
        "poll_only": True,
        "jobs": [
            {
                "universe_number": 2,
                "job_id_short": "campaign...0001",
                "status": "RUNNING",
                "result_preserved": False,
            }
        ],
    }


def test_resume_polls_existing_job_id_without_submitting_replacement(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence_root, credentials_file, service, calls, provider = submit_first_job(
        tmp_path,
        monkeypatch,
    )
    provider.status = "FAILED"

    with pytest.raises(
        campaign.CampaignEvidenceError,
        match="FAILED_UNIVERSE_REQUIRES_CONFIRMED_RESUME",
    ):
        campaign.resume_existing_universe(
            evidence_root,
            str(credentials_file),
            confirmed=False,
            poll_interval_seconds=30,
            max_wait_hours=1,
            service_factory=make_service_factory(service, calls),
            provider=provider,
        )

    assert service.requested_job_ids == ["campaign-job-00000001"]
    assert len(provider.submissions) == 1


def test_retry_requires_terminal_failure_confirmation_and_has_one_retry_limit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence_root, credentials_file, service, calls, provider = submit_first_job(
        tmp_path,
        monkeypatch,
        job_ids=("campaign-job-00000001", "campaign-job-00000002"),
    )
    directory = evidence_root / "universe-002"

    with pytest.raises(campaign.CampaignEvidenceError, match="RETRY_REQUIRES_TERMINAL_FAILURE"):
        campaign._record_submission_intent(directory, attempt_number=2)

    campaign._update_status(directory, "campaign-job-00000001", "FAILED")
    with pytest.raises(campaign.CampaignEvidenceError, match="EXPLICIT_RETRY_CONFIRMATION_REQUIRED"):
        campaign.resume_existing_universe(
            evidence_root,
            str(credentials_file),
            confirmed=False,
            poll_interval_seconds=30,
            max_wait_hours=1,
            service_factory=make_service_factory(service, calls),
            provider=provider,
        )
    assert len(provider.submissions) == 1
    assert len(calls) == 1

    retried = campaign.resume_existing_universe(
        evidence_root,
        str(credentials_file),
        confirmed=True,
        poll_interval_seconds=30,
        max_wait_hours=1,
        service_factory=make_service_factory(service, calls),
        provider=provider,
    )
    assert retried["attempt"] == 2
    assert retried["job_id"] == "campaign-job-00000002"
    assert len(provider.submissions) == 2

    campaign._update_status(directory, "campaign-job-00000002", "FAILED")
    with pytest.raises(campaign.CampaignEvidenceError, match="HARDWARE_JOB_FAILED"):
        campaign.resume_existing_universe(
            evidence_root,
            str(credentials_file),
            confirmed=True,
            poll_interval_seconds=30,
            max_wait_hours=1,
            service_factory=make_service_factory(service, calls),
            provider=provider,
        )
    assert len(provider.submissions) == 2
    assert len(calls) == 2


def test_cli_failure_output_never_echoes_credentials_or_provider_details(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    private_path = r"C:\private-marker\.qiskit\qiskit-ibm.json"

    def unsafe_failure(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError(
            f"token=operator-secret-marker filename={private_path} account=private-account-object"
        )

    monkeypatch.setattr(campaign, "run_preflight_only", unsafe_failure)
    result = campaign.main(
        [
            "--preflight-only",
            "--credentials-file",
            private_path,
            "--account-name",
            "colapso",
        ]
    )
    output = capsys.readouterr().out

    assert result == 3
    assert json.loads(output) == {
        "status": "BLOCKED",
        "safe_error_code": "UNEXPECTED_SAFE_FAILURE",
    }
    assert private_path not in output
    assert "operator-secret-marker" not in output
    assert "private-account-object" not in output


def test_universe_one_matches_all_pinned_hashes() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    campaign._verify_universe_one(repository_root / "evidence")


def test_campaign_lock_blocks_concurrent_operator_before_service_creation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence_root = tmp_path / "evidence"
    evidence_root.mkdir()
    credentials_file = make_credentials_file(tmp_path)
    service = FakeService()
    calls: list[dict[str, Any]] = []
    provider = FakeProvider("campaign-job-00000001")
    monkeypatch.setattr(campaign, "_verify_universe_one", lambda _root: None)
    (evidence_root / campaign._LOCK_FILENAME).write_text("existing operator\n", encoding="utf-8")

    with pytest.raises(campaign.CampaignEvidenceError, match="CAMPAIGN_OPERATION_LOCKED"):
        campaign.submit_next_universe(
            evidence_root,
            str(credentials_file),
            confirmed=True,
            service_factory=make_service_factory(service, calls),
            provider=provider,
        )

    assert calls == []
    assert provider.submissions == []


def test_private_runtime_raw_is_rejected_before_any_disk_write(tmp_path: Path) -> None:
    raw_path = tmp_path / "sampler-runtime-raw.json"

    with pytest.raises(campaign.CampaignEvidenceError, match="PRIVATE_EVIDENCE_KEY_REJECTED"):
        campaign._write_runtime_raw_once(raw_path, {"token": "operator-secret-marker"})

    assert not raw_path.exists()
    assert not raw_path.with_suffix(".json.tmp").exists()


def _complete_operator_entries() -> dict[int, dict[str, Any]]:
    entries: dict[int, dict[str, Any]] = {}
    for universe_number in campaign._UNIVERSES:
        entries[universe_number] = {
            "universe_number": universe_number,
            "backend": "ibm_fez",
            "job_id": f"complete-job-{universe_number:03d}",
            "submission_timestamp": f"2026-07-27T22:{universe_number:02d}:00Z",
            "current_status": "DONE",
            "result_preserved": True,
            "evidence_path": f"evidence/universe-{universe_number:03d}",
        }
    return entries


def _complete_summary(universe_number: int) -> dict[str, Any]:
    return {
        "universe_number": universe_number,
        "title": campaign._UNIVERSES[universe_number],
        "job_id": f"complete-job-{universe_number:03d}",
        "job_id_short": f"complete...{universe_number:04d}",
        "status": "DONE",
        "backend": "ibm_fez",
        "shots": 256,
        "qpu_usage_seconds": None,
        "submitted_at_utc": f"2026-07-27T22:{universe_number:02d}:00Z",
        "completed_at_utc": f"2026-07-27T23:{universe_number:02d}:00Z",
        "runtime_raw_sha256": f"{universe_number}" * 64,
        "canonical_raw_sha256": f"{universe_number + 1}" * 64,
        "accepted_entropy_sha256": f"{universe_number + 2}" * 64,
        "universe_commitment": f"{universe_number + 3}" * 64,
        "manifest_sha256": f"{universe_number + 4}" * 64,
        "evidence_path": f"evidence/universe-{universe_number:03d}",
    }


def test_verify_campaign_is_pure_and_json_safe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence_root = tmp_path / "evidence"
    evidence_root.mkdir()
    monkeypatch.setattr(campaign, "_verify_universe_one", lambda _root: None)
    monkeypatch.setattr(campaign, "_operator_entries", lambda _root: _complete_operator_entries())
    monkeypatch.setattr(
        campaign,
        "_verify_universe_directory",
        lambda directory: _complete_summary(int(directory.name[-3:])),
    )

    def forbidden_writer(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("Pure campaign verification must not invoke the index writer")

    monkeypatch.setattr(campaign, "_write_campaign_index", forbidden_writer)
    before = list(evidence_root.iterdir())

    report = campaign.verify_campaign(evidence_root)

    assert report["campaign_state"] == "COMPLETE"
    assert report["campaign_index_ready"] is True
    assert json.loads(json.dumps(report)) == report
    assert list(evidence_root.iterdir()) == before


def test_current_finalized_campaign_passes_strict_verification() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    evidence_root = repository_root / "evidence"

    report = campaign.verify_campaign(evidence_root)

    assert report["campaign_state"] == "COMPLETE"
    assert report["hardware_execution_count"] == 5
    assert report["new_sampler_jobs"] == 4
    assert report["distinct_job_ids"] == 5
    assert report["distinct_new_raw_results"] == 4
    assert report["universe_one_byte_identical"] is True
    assert report["campaign_index_ready"] is True
    assert json.loads(json.dumps(report)) == report
    with pytest.raises(
        campaign.CampaignEvidenceError,
        match="UNIVERSE_FIVE_PENDING_INVENTORY_INVALID",
    ):
        campaign.verify_available_campaign(evidence_root)


def test_finalize_campaign_gates_writer_on_strict_verification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    writes: list[list[dict[str, Any]]] = []

    def blocked_verification(_root: Path) -> Any:
        raise campaign.CampaignEvidenceError("UNIVERSE_FIVE_PENDING")

    monkeypatch.setattr(campaign, "_complete_campaign_verification", blocked_verification)
    monkeypatch.setattr(
        campaign,
        "_write_campaign_index",
        lambda _root, summaries: writes.append(summaries),
    )

    with pytest.raises(campaign.CampaignEvidenceError, match="UNIVERSE_FIVE_PENDING"):
        campaign.finalize_campaign_offline(tmp_path)

    assert writes == []


def test_finalize_campaign_writes_only_after_successful_strict_verification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    summaries = [_complete_summary(number) for number in campaign._UNIVERSES]

    def verified(_root: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        events.append("verified")
        return {"status": "PASS", "campaign_state": "COMPLETE"}, summaries

    def write_index(_root: Path, received: list[dict[str, Any]]) -> str:
        assert events == ["verified"]
        assert received is summaries
        events.append("written")
        return "a" * 64

    monkeypatch.setattr(campaign, "_complete_campaign_verification", verified)
    monkeypatch.setattr(campaign, "_write_campaign_index", write_index)

    report = campaign.finalize_campaign_offline(tmp_path)

    assert events == ["verified", "written"]
    assert report == {
        "status": "PASS",
        "campaign_state": "COMPLETE",
        "finalized": True,
        "campaign_index_sha256": "a" * 64,
    }


@pytest.mark.parametrize(
    ("flag", "function_name"),
    [
        ("--verify-offline", "verify_campaign"),
        ("--verify-available-offline", "verify_available_campaign"),
        ("--finalize-offline", "finalize_campaign_offline"),
    ],
)
def test_offline_cli_branches_before_credentials_or_provider_setup(
    flag: str,
    function_name: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[Path] = []

    def offline_action(evidence_root: Path) -> dict[str, Any]:
        calls.append(evidence_root)
        return {"status": "PASS", "action": function_name}

    def forbidden_live_service(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("Offline CLI actions must not create a live service")

    monkeypatch.setattr(campaign, function_name, offline_action)
    monkeypatch.setattr(campaign, "_create_live_service", forbidden_live_service)

    result = campaign.main([flag, "--evidence-root", str(tmp_path)])

    assert result == 0
    assert calls == [tmp_path]
    assert json.loads(capsys.readouterr().out) == {
        "status": "PASS",
        "action": function_name,
    }
