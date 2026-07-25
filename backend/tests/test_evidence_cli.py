import argparse
import json
from datetime import datetime

import pytest
from conftest import FIXED_TIMESTAMP
from test_provider_service import FakeProvider

from colapso_quantum.cli import _parse_timestamp, _run_id, main
from colapso_quantum.evidence import (
    canonical_json_bytes,
    validate_evidence_package,
    write_evidence_package,
)
from colapso_quantum.service import LocalQuantumService


def _service() -> LocalQuantumService:
    return LocalQuantumService(FakeProvider(), clock=lambda: FIXED_TIMESTAMP)


def test_evidence_package_is_hash_linked_and_detects_tampering(tmp_path) -> None:
    service = _service()
    entropy = service.simulate_entropy(seed=42, shots=4)
    bell = service.simulate_bell(seed=42, shots=4)
    package = service.write_simulated_package(
        evidence_root=str(tmp_path),
        run_id="evidence-test-001",
        entropy=entropy,
        bell=bell,
    )

    manifest = validate_evidence_package(package.path)
    assert manifest.mode.value == "SIMULATED"
    assert json.loads((package.path / "hashes.json").read_text("utf-8")) == package.file_hashes
    assert b'"timestamp_utc":"2026-07-20T12:00:00Z"' in canonical_json_bytes(
        {"provenance": entropy.provenance}
    )

    (package.path / "raw-entropy.json").write_text("{}", encoding="utf-8")
    with pytest.raises(ValueError, match="artifact hash"):
        validate_evidence_package(package.path)


def test_evidence_writer_rejects_unsafe_ids_and_naive_timestamps(tmp_path) -> None:
    entropy = _service().simulate_entropy(seed=42, shots=4)
    records = {
        "entropy": (
            entropy,
            {"circuit_identifier": entropy.circuit_identifier, "shot_bitstrings": entropy.raw_bitstrings},
        )
    }

    with pytest.raises(ValueError, match="safe provenance"):
        write_evidence_package(tmp_path, "../unsafe", FIXED_TIMESTAMP, records)
    with pytest.raises(ValueError, match="UTC offset"):
        write_evidence_package(tmp_path, "naive-time-001", datetime(2026, 7, 20), records)


def test_cli_writes_two_simulated_packages_and_a_credential_free_plan(
    tmp_path, capsys
) -> None:
    timestamp = "2026-07-20T12:00:00Z"

    assert main(
        [
            "simulate",
            "--seed",
            "42",
            "--shots",
            "8",
            "--run-id",
            "cli-simulated-001",
            "--timestamp",
            timestamp,
            "--evidence-root",
            str(tmp_path),
        ]
    ) == 0
    simulated_output = json.loads(capsys.readouterr().out)
    assert simulated_output["mode"] == "SIMULATED"
    assert validate_evidence_package(tmp_path / "runs" / "simulated" / "cli-simulated-001")

    assert main(
        [
            "chsh-simulate",
            "--seed",
            "42",
            "--run-id",
            "cli-chsh-001",
            "--timestamp",
            timestamp,
            "--evidence-root",
            str(tmp_path),
        ]
    ) == 0
    chsh_output = json.loads(capsys.readouterr().out)
    assert chsh_output["manifest"]["mode"] == "SIMULATED"
    assert validate_evidence_package(tmp_path / "runs" / "simulated" / "cli-chsh-001")

    assert main(["real-dry-run"]) == 0
    assert json.loads(capsys.readouterr().out)["mode"] == "REAL_DRY_RUN"


def test_cli_timestamp_parsing_and_run_ids_are_deterministic() -> None:
    parsed = _parse_timestamp("2026-07-20T12:00:00Z")

    assert parsed == FIXED_TIMESTAMP
    assert _parse_timestamp(None) is None
    assert _run_id("simulated", FIXED_TIMESTAMP, "supplied-id") == "supplied-id"
    assert _run_id("simulated", FIXED_TIMESTAMP, None) == "simulated-20260720t120000z"
    with pytest.raises(argparse.ArgumentTypeError, match="UTC"):
        _parse_timestamp("2026-07-20T12:00:00")
