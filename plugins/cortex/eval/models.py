"""Eval suite data models."""

from pydantic import BaseModel


class SessionScript(BaseModel):
    """A scripted conversation session for testing."""

    messages: list[dict]  # [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
    delay_minutes: int = 0  # Simulated time gap after this session


class VerificationQuery(BaseModel):
    """A query to verify retrieval quality after ingestion."""

    query: str
    expected_entities: list[str] = []  # Entity names that MUST appear in results
    excluded_entities: list[str] = []  # Entity names that must NOT appear (e.g., invalidated)
    min_precision: float = 0.7
    min_recall: float = 0.7
    max_latency_ms: float = 500.0


class EvalScenario(BaseModel):
    """A complete test scenario with sessions and verification queries."""

    name: str
    description: str
    sessions: list[SessionScript]
    queries: list[VerificationQuery]


class ScenarioResult(BaseModel):
    """Results from running one scenario."""

    name: str
    precision: float = 0.0
    recall: float = 0.0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
    passed: bool = False
    errors: list[str] = []


class EvalReport(BaseModel):
    """Full evaluation report."""

    run_at: str
    passed: bool
    scenarios: dict[str, ScenarioResult] = {}
    aggregate_precision: float = 0.0
    aggregate_recall: float = 0.0
    avg_latency_ms: float = 0.0
    max_latency_ms: float = 0.0
