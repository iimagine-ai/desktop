"""Cortex graph schema — typed entities and edges passed to Graphiti.

FIX #1: These Pydantic models are passed to graphiti.add_episode() via
entity_types= / edge_types= / edge_type_map=. This is Graphiti's real custom
schema mechanism (the previous `custom_extraction_instructions` kwarg does not
exist in Graphiti's API and caused a TypeError swallowed by the broad except).

FIX #2: Every edge type inherits `salience` as a typed attribute with a
scoring rubric in its Field description. Graphiti's attribute-extraction step
populates fields defined on the matched edge type, so salience is now written
by the extraction LLM and readable at edge.attributes["salience"].

NOTE: Field descriptions are prompts — Graphiti feeds them to the extraction
LLM. Keep them instructive.
"""

from pydantic import BaseModel, Field

# ── Shared salience mixin ────────────────────────────────────────

SALIENCE_RUBRIC = (
    "Importance of this fact for future business advice, 0.0-1.0. "
    "0.8-1.0: decisions, commitments, financial figures, strategic pivots. "
    "0.5-0.7: objectives, preferences, team changes, product details. "
    "0.2-0.4: background context and general observations."
)


class SalientEdge(BaseModel):
    """Base for all edges: every extracted fact carries a salience score."""

    salience: float | None = Field(None, ge=0.0, le=1.0, description=SALIENCE_RUBRIC)


# ── Entity types ─────────────────────────────────────────────────


class Owner(BaseModel):
    """The business owner / primary decision maker."""

    role: str | None = Field(None, description="e.g. founder, managing director")


class Business(BaseModel):
    """The business itself."""

    industry: str | None = Field(None, description="Industry or sector")
    stage: str | None = Field(None, description="startup, growth, mature")


class Objective(BaseModel):
    """A stated business goal."""

    horizon: str | None = Field(None, description="short, medium, or long term")
    status: str | None = Field(None, description="active, achieved, abandoned, revised")
    measurable_target: str | None = Field(None, description="e.g. '$2M ARR by Q4'")


class Strategy(BaseModel):
    """An approach the business is pursuing to reach its objectives."""

    status: str | None = Field(None, description="active, paused, abandoned")


class Resource(BaseModel):
    """A tangible or financial resource."""

    category: str | None = Field(
        None, description="cash, credit, equipment, software, facility"
    )
    quantity: str | None = Field(None, description="e.g. '$150k runway', '2 vans'")


class TeamMember(BaseModel):
    """A person working in the business."""

    role: str | None = Field(None, description="Their role in the business")
    employment_type: str | None = Field(
        None, description="full-time, part-time, contractor"
    )


class Skill(BaseModel):
    """A capability held by the business or a team member."""

    proficiency: str | None = Field(None, description="basic, competent, expert")


class Product(BaseModel):
    """A product or service offered by the business."""

    lifecycle_stage: str | None = Field(
        None, description="idea, development, launched, sunset"
    )


class Segment(BaseModel):
    """A customer segment or target market."""

    size_note: str | None = Field(None, description="Rough size or share if stated")


class Opportunity(BaseModel):
    """A discrete opportunity that was or is being evaluated."""

    status: str | None = Field(
        None, description="considering, pursued, declined, deferred"
    )
    domain: str | None = Field(
        None, description="new product, partnership, expansion, acquisition"
    )


class Preference(BaseModel):
    """A personal preference or value of the owner."""

    domain: str | None = Field(
        None, description="risk, workload, growth pace, values, lifestyle"
    )
    strength: str | None = Field(None, description="mild, firm, non-negotiable")


class Constraint(BaseModel):
    """A hard limitation on the business."""

    category: str | None = Field(
        None, description="regulatory, financial, time, contractual"
    )


# ── Edge types (all salient) ─────────────────────────────────────


class HasObjective(SalientEdge):
    """Business -> Objective."""

    priority: str | None = Field(None, description="primary or secondary")


class Pursues(SalientEdge):
    """Business -> Strategy."""


class Supports(SalientEdge):
    """Strategy -> Objective: which goal this strategy serves."""


class HoldsResource(SalientEdge):
    """Business -> Resource."""

    quantity: str | None = Field(None, description="Amount if stated")


class Employs(SalientEdge):
    """Business -> TeamMember."""

    capacity_note: str | None = Field(None, description="e.g. 'at 90% utilisation'")


class HasSkill(SalientEdge):
    """TeamMember or Business -> Skill."""

    level: str | None = Field(None, description="Proficiency if stated")


class Offers(SalientEdge):
    """Business -> Product."""

    revenue_share: str | None = Field(None, description="e.g. '60% of revenue'")


class Targets(SalientEdge):
    """Product -> Segment."""


class Evaluated(SalientEdge):
    """Owner -> Opportunity. The most valuable edge for advisory recall."""

    decision: str | None = Field(None, description="proceeded, declined, deferred")
    rationale: str | None = Field(
        None, description="The owner's stated reasoning at the time of the decision"
    )
    outcome: str | None = Field(None, description="What happened, if known")


class Prefers(SalientEdge):
    """Owner -> Preference."""


class Requires(SalientEdge):
    """Opportunity -> Skill or Resource: what the opportunity would demand."""

    gap: str | None = Field(
        None, description="Whether the business currently has it, if stated"
    )


class ConstrainedBy(SalientEdge):
    """Business or Opportunity -> Constraint."""


# ── Wiring dicts consumed by extraction.py ───────────────────────

ENTITY_TYPES: dict[str, type[BaseModel]] = {
    "Owner": Owner,
    "Business": Business,
    "Objective": Objective,
    "Strategy": Strategy,
    "Resource": Resource,
    "TeamMember": TeamMember,
    "Skill": Skill,
    "Product": Product,
    "Segment": Segment,
    "Opportunity": Opportunity,
    "Preference": Preference,
    "Constraint": Constraint,
}

EDGE_TYPES: dict[str, type[BaseModel]] = {
    "HasObjective": HasObjective,
    "Pursues": Pursues,
    "Supports": Supports,
    "HoldsResource": HoldsResource,
    "Employs": Employs,
    "HasSkill": HasSkill,
    "Offers": Offers,
    "Targets": Targets,
    "Evaluated": Evaluated,
    "Prefers": Prefers,
    "Requires": Requires,
    "ConstrainedBy": ConstrainedBy,
}

EDGE_TYPE_MAP: dict[tuple[str, str], list[str]] = {
    ("Business", "Objective"): ["HasObjective"],
    ("Business", "Strategy"): ["Pursues"],
    ("Strategy", "Objective"): ["Supports"],
    ("Business", "Resource"): ["HoldsResource"],
    ("Business", "TeamMember"): ["Employs"],
    ("TeamMember", "Skill"): ["HasSkill"],
    ("Business", "Skill"): ["HasSkill"],
    ("Business", "Product"): ["Offers"],
    ("Product", "Segment"): ["Targets"],
    ("Owner", "Opportunity"): ["Evaluated"],
    ("Owner", "Preference"): ["Prefers"],
    ("Opportunity", "Skill"): ["Requires"],
    ("Opportunity", "Resource"): ["Requires"],
    # Fallback pairing lets any entity attach to a Constraint.
    ("Entity", "Constraint"): ["ConstrainedBy"],
}

# Maps a node's type label -> profile section (FIX #2: real type routing).
LABEL_TO_PROFILE_SECTION: dict[str, str] = {
    "Owner": "owner",
    "Business": "business",
    "Objective": "objectives",
    "Strategy": "strategies",
    "Resource": "resources",
    "TeamMember": "team",
    "Skill": "skills",
    "Product": "products",
    "Segment": "segments",
    "Opportunity": "opportunities",
    "Preference": "preferences",
    "Constraint": "constraints",
}
