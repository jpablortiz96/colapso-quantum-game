import pytest

from colapso_quantum.models import DryRunConfigurationError
from colapso_quantum.providers.ibm_runtime import IbmRuntimeProvider


class FakeService:
    def __init__(self) -> None:
        self.arguments: dict[str, object] | None = None

    def least_busy(self, **kwargs: object) -> str:
        self.arguments = kwargs
        return "fake-ibm-backend"


def test_dry_run_is_credential_free_and_declares_no_submission() -> None:
    created = False

    def unexpected_service_factory(**kwargs: object) -> object:
        nonlocal created
        created = True
        raise AssertionError(f"dry-run must not create service: {kwargs}")

    provider = IbmRuntimeProvider(
        token="unit-test-token-not-used",
        instance="unit-test-instance",
        service_factory=unexpected_service_factory,
    )
    plan = provider.dry_run(entropy_qubits=5)

    assert not created
    assert plan.mode == "REAL_DRY_RUN"
    assert plan.required_qubits == 5
    assert not plan.submits_jobs
    assert any("least_busy" in step for step in plan.steps)
    with pytest.raises(DryRunConfigurationError, match="positive"):
        provider.dry_run(entropy_qubits=0)


def test_backend_selection_uses_dynamic_compatibility_filters() -> None:
    service = FakeService()

    backend = IbmRuntimeProvider().select_backend(service, required_qubits=3)

    assert backend == "fake-ibm-backend"
    assert service.arguments == {
        "operational": True,
        "simulator": False,
        "min_num_qubits": 3,
    }
