"""Cortex data models — profile document, pending updates, API config.

FIX #1 cleanup: EntityType/EntityNode/EpisodeEdge/Episode and the Extracted*
models are deleted. They were dead code — never passed to Graphiti, duplicating
structures Graphiti owns internally (nodes, edges, temporal fields, episodes).
The real graph schema now lives in schema.py and is wired into add_episode().

Also: LLMConfig moved here from main.py so llm_adapter no longer imports from
main (breaks the latent circular import), and datetime.utcnow() is replaced
with timezone-aware timestamps.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── LLM configuration (shared by main.py and llm_adapter.py) ─────


class LLMConfig(BaseModel):
    provider: str  # "local" | "openai" | "anthropic" | "google" | "openrouter"
    model: str
    api_key: str | None = None
    base_url: str | None = None
    engine_port: int = 8847


# ── Profile Document ─────────────────────────────────────────────


class ProfileSection(BaseModel):
    """One section of the profile document."""

    summary: str = ""
    key_facts: list[str] = []
    last_updated: Optional[datetime] = None


class ProfileDocument(BaseModel):
    """Auto-maintained summary of the user's current business state."""

    owner: ProfileSection = Field(default_factory=ProfileSection)
    business: ProfileSection = Field(default_factory=ProfileSection)
    objectives: ProfileSection = Field(default_factory=ProfileSection)
    strategies: ProfileSection = Field(default_factory=ProfileSection)
    resources: ProfileSection = Field(default_factory=ProfileSection)
    team: ProfileSection = Field(default_factory=ProfileSection)
    skills: ProfileSection = Field(default_factory=ProfileSection)
    products: ProfileSection = Field(default_factory=ProfileSection)
    segments: ProfileSection = Field(default_factory=ProfileSection)
    opportunities: ProfileSection = Field(default_factory=ProfileSection)
    preferences: ProfileSection = Field(default_factory=ProfileSection)
    constraints: ProfileSection = Field(default_factory=ProfileSection)
    version: int = 0
    last_updated: Optional[datetime] = None


# ── Profile Updates ──────────────────────────────────────────────


class ProfileUpdateTier(str, Enum):
    LOW = "low"        # Auto-apply
    MEDIUM = "medium"  # Queue for approval; stale-applies after 7 days
    HIGH = "high"      # Queue with notification; NEVER auto-applies (FIX #4)


class PendingProfileUpdate(BaseModel):
    """A proposed profile change awaiting approval."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    section: str
    proposed_change: str
    tier: ProfileUpdateTier
    source_fact_ids: list[str] = []
    created_at: datetime = Field(default_factory=_now)
    status: str = "pending"  # "pending" | "approved" | "rejected" | "stale-applied"
    expires_at: Optional[datetime] = None
    escalated: bool = False  # FIX #4: expired HIGH updates flag for re-notification
