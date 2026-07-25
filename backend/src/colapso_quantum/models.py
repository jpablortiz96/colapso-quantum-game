"""Validated, serializable contracts for F2A quantum artifacts."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_EXPECTATION_KEYS = frozenset({"E00", "E01", "E10", "E11"})
_BELL_KEYS = frozenset({"00", "01", "10", "11"})


class QuantumMode(StrEnum):
    """Provenance mode; simulated output can never impersonate hardware."""

    REAL = "REAL"
    SIMULATED = "SIMULATED"


class VerificationStatus(StrEnum):
    SIMULATED = "SIMULATED"
    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"


class QuantumServiceError(Exception):
    """Base error with a stable, non-secret-bearing service code."""

    code = "QUANTUM_SERVICE_ERROR"


class QuantumConfigurationError(QuantumServiceError):
    code = "QUANTUM_CONFIGURATION_ERROR"


class ProviderExecutionError(QuantumServiceError):
    code = "PROVIDER_EXECUTION_ERROR"


class DryRunConfigurationError(QuantumServiceError):
    code = "DRY_RUN_CONFIGURATION_ERROR"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class QuantumProvenance(ContractModel):
    schema_version: Literal[1] = 1
    mode: QuantumMode
    provider: str = Field(min_length=1, max_length=120)
    backend: str = Field(min_length=1, max_length=240)
    job_id: str | None = Field(default=None, min_length=1, max_length=240)
    timestamp_utc: datetime
    shots: int = Field(ge=1, le=1_000_000)
    circuit_identifiers: tuple[str, ...] = Field(min_length=1)
    qiskit_versions: dict[str, str] = Field(min_length=1)
    raw_artifact_hashes: tuple[str, ...] = ()
    derived_artifact_hashes: tuple[str, ...] = ()
    configuration: dict[str, Any] = Field(default_factory=dict)
    verification_status: VerificationStatus

    @field_validator("timestamp_utc")
    @classmethod
    def normalize_utc_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp_utc must include a UTC offset")
        return value.astimezone(UTC)

    @field_validator("circuit_identifiers")
    @classmethod
    def validate_circuit_identifiers(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not item.strip() for item in value):
            raise ValueError("circuit identifiers must be non-empty")
        if len(set(value)) != len(value):
            raise ValueError("circuit identifiers must be unique")
        return value

    @field_validator("raw_artifact_hashes", "derived_artifact_hashes")
    @classmethod
    def validate_hashes(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(_SHA256.fullmatch(item) is None for item in value):
            raise ValueError("artifact hashes must be lowercase SHA-256 hex")
        return value

    @model_validator(mode="after")
    def validate_mode_claims(self) -> Self:
        if self.mode is QuantumMode.SIMULATED:
            if self.job_id is not None:
                raise ValueError("simulated provenance cannot contain a real job ID")
            if self.verification_status is not VerificationStatus.SIMULATED:
                raise ValueError("simulated provenance must use SIMULATED status")
        elif self.verification_status is VerificationStatus.SIMULATED:
            raise ValueError("real provenance cannot use SIMULATED status")
        return self


class EntropyBatch(ContractModel):
    schema_version: Literal[1] = 1
    provenance: QuantumProvenance
    circuit_identifier: str = Field(min_length=1)
    raw_bitstrings: tuple[str, ...] = Field(min_length=1)
    entropy_bytes_hex: str
    uint32_values: tuple[int, ...]
    discarded_bits: int = Field(ge=0, lt=32)
    raw_sha256: str
    derived_sha256: str
    extractor_version: Literal[1] = 1

    @field_validator("raw_bitstrings")
    @classmethod
    def validate_bitstrings(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not item or set(item) - {"0", "1"} for item in value):
            raise ValueError("raw bitstrings must be non-empty binary strings")
        return value

    @field_validator("entropy_bytes_hex")
    @classmethod
    def validate_hex(cls, value: str) -> str:
        if len(value) % 2 != 0 or re.fullmatch(r"[a-f0-9]*", value) is None:
            raise ValueError("entropy_bytes_hex must be lowercase whole-byte hex")
        return value

    @field_validator("uint32_values")
    @classmethod
    def validate_uint32(cls, value: tuple[int, ...]) -> tuple[int, ...]:
        if any(item < 0 or item > 0xFFFFFFFF for item in value):
            raise ValueError("uint32 values must be in range")
        return value

    @field_validator("raw_sha256", "derived_sha256")
    @classmethod
    def validate_single_hash(cls, value: str) -> str:
        if _SHA256.fullmatch(value) is None:
            raise ValueError("hash must be lowercase SHA-256 hex")
        return value


class BellCorrelationBatch(ContractModel):
    schema_version: Literal[1] = 1
    provenance: QuantumProvenance
    circuit_identifier: str = Field(min_length=1)
    raw_bitstrings: tuple[str, ...] = Field(min_length=1)
    counts: dict[str, int]
    observed_correlation: float
    raw_sha256: str
    derived_sha256: str
    interpretation: Literal["ONE_BASIS_CORRELATION_ONLY"] = (
        "ONE_BASIS_CORRELATION_ONLY"
    )

    @field_validator("raw_bitstrings")
    @classmethod
    def validate_bell_bitstrings(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(item not in _BELL_KEYS for item in value):
            raise ValueError("Bell bitstrings must be two-bit computational outcomes")
        return value

    @field_validator("raw_sha256", "derived_sha256")
    @classmethod
    def validate_bell_hashes(cls, value: str) -> str:
        if _SHA256.fullmatch(value) is None:
            raise ValueError("hash must be lowercase SHA-256 hex")
        return value

    @model_validator(mode="after")
    def validate_bell_statistics(self) -> Self:
        if set(self.counts) != _BELL_KEYS:
            raise ValueError("counts must contain exactly 00, 01, 10, and 11")
        if any(not isinstance(count, int) or count < 0 for count in self.counts.values()):
            raise ValueError("Bell counts must be non-negative integers")
        if sum(self.counts.values()) != self.provenance.shots:
            raise ValueError("Bell counts must sum to provenance shots")
        if len(self.raw_bitstrings) != self.provenance.shots:
            raise ValueError("Bell bitstrings must preserve every shot")
        expected = (
            self.counts["00"]
            + self.counts["11"]
            - self.counts["01"]
            - self.counts["10"]
        ) / self.provenance.shots
        if not math.isclose(self.observed_correlation, expected, abs_tol=1e-12):
            raise ValueError("observed correlation does not match counts")
        return self


class ChshEvidence(ContractModel):
    schema_version: Literal[1] = 1
    provenance: QuantumProvenance
    circuit_identifier: str = Field(min_length=1)
    expectation_values: dict[str, float]
    witness: float
    standard_error: float | None = Field(default=None, ge=0)
    classical_bound: Literal[2.0] = 2.0
    tsirelson_bound: float = Field(default=2 * math.sqrt(2))
    tolerance: float = Field(default=1e-9, ge=0)
    raw_sha256: str
    derived_sha256: str
    interpretation: Literal["SIMULATED_CHSH_WITNESS", "REAL_WITH_UNCERTAINTY"]

    @field_validator("raw_sha256", "derived_sha256")
    @classmethod
    def validate_chsh_hashes(cls, value: str) -> str:
        if _SHA256.fullmatch(value) is None:
            raise ValueError("hash must be lowercase SHA-256 hex")
        return value

    @model_validator(mode="after")
    def validate_chsh_calculation(self) -> Self:
        if set(self.expectation_values) != _EXPECTATION_KEYS:
            raise ValueError("CHSH requires exactly E00, E01, E10, and E11")
        if any(not math.isfinite(value) or abs(value) > 1 + self.tolerance for value in self.expectation_values.values()):
            raise ValueError("expectation values must be finite and within [-1, 1]")
        expected = (
            self.expectation_values["E00"]
            + self.expectation_values["E01"]
            + self.expectation_values["E10"]
            - self.expectation_values["E11"]
        )
        if not math.isclose(self.witness, expected, abs_tol=self.tolerance):
            raise ValueError("witness does not match the declared sign convention")
        if self.mode_is_simulated and self.interpretation != "SIMULATED_CHSH_WITNESS":
            raise ValueError("simulated CHSH output must remain visibly simulated")
        if not self.mode_is_simulated and self.interpretation != "REAL_WITH_UNCERTAINTY":
            raise ValueError("real CHSH output must retain its uncertainty label")
        return self

    @property
    def mode_is_simulated(self) -> bool:
        return self.provenance.mode is QuantumMode.SIMULATED


class EvidenceManifest(ContractModel):
    schema_version: Literal[1] = 1
    run_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{2,79}$")
    mode: QuantumMode
    created_at_utc: datetime
    provenance: tuple[QuantumProvenance, ...] = Field(min_length=1)
    raw_artifacts: dict[str, str] = Field(min_length=1)
    derived_artifacts: dict[str, str] = Field(min_length=1)
    manifest_sha256: str

    @field_validator("created_at_utc")
    @classmethod
    def normalize_manifest_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at_utc must include a UTC offset")
        return value.astimezone(UTC)

    @field_validator("raw_artifacts", "derived_artifacts")
    @classmethod
    def validate_artifact_map(cls, value: dict[str, str]) -> dict[str, str]:
        if any(not key.endswith(".json") for key in value):
            raise ValueError("artifact map keys must be JSON file names")
        if any(_SHA256.fullmatch(digest) is None for digest in value.values()):
            raise ValueError("artifact map values must be SHA-256 hashes")
        return value

    @field_validator("manifest_sha256")
    @classmethod
    def validate_manifest_hash(cls, value: str) -> str:
        if _SHA256.fullmatch(value) is None:
            raise ValueError("manifest_sha256 must be lowercase SHA-256 hex")
        return value

    @model_validator(mode="after")
    def validate_manifest_mode(self) -> Self:
        if any(item.mode is not self.mode for item in self.provenance):
            raise ValueError("manifest and provenance modes must agree")
        return self
