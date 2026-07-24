"""Cortex graph schema — typed entities and edges passed to Graphiti.

These Pydantic models are passed to graphiti.add_episode() via entity_types= /
edge_types= / edge_type_map=. They are ATTRIBUTE-LESS — just classification
types. Docstrings guide the extraction LLM's classification; no custom fields
are stored as properties (FalkorDB Lite rejects non-primitive property values).

The entity_types= mechanism gives nodes typed labels (Entity + TypeName),
which _node_type_label() reads to route facts to the correct profile section.
"""

from pydantic import BaseModel


# ── Entity types (attribute-less — classification only) ──────────


class Owner(BaseModel):
    """The business owner / primary decision maker."""


class Business(BaseModel):
    """The business itself."""


class Objective(BaseModel):
    """A stated business goal."""


class Strategy(BaseModel):
    """An approach the business is pursuing to reach its objectives."""


class Resource(BaseModel):
    """A tangible or financial resource (cash, equipment, software)."""


class TeamMember(BaseModel):
    """A person working in the business."""


class Skill(BaseModel):
    """A capability held by the business or a team member."""


class Product(BaseModel):
    """A product or service offered by the business."""


class Segment(BaseModel):
    """A customer segment or target market."""


class Opportunity(BaseModel):
    """A discrete opportunity being evaluated."""


class Preference(BaseModel):
    """A personal preference or value of the owner."""


class Constraint(BaseModel):
    """A hard limitation (regulatory, financial, time, contractual)."""


# ── Edge types (attribute-less) ──────────────────────────────────


class HasObjective(BaseModel):
    """Business -> Objective."""


class Pursues(BaseModel):
    """Business -> Strategy."""


class Supports(BaseModel):
    """Strategy -> Objective: which goal this strategy serves."""


class HoldsResource(BaseModel):
    """Business -> Resource."""


class Employs(BaseModel):
    """Business -> TeamMember."""


class HasSkill(BaseModel):
    """TeamMember or Business -> Skill."""


class Offers(BaseModel):
    """Business -> Product."""


class Targets(BaseModel):
    """Product -> Segment."""


class Evaluated(BaseModel):
    """Owner -> Opportunity."""


class Prefers(BaseModel):
    """Owner -> Preference."""


class Requires(BaseModel):
    """Opportunity -> Skill or Resource."""


class ConstrainedBy(BaseModel):
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
    ("Entity", "Constraint"): ["ConstrainedBy"],
}

# Maps node type label -> profile section.
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
