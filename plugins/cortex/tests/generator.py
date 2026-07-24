"""Distractor generator for the interference-at-scale scenario (category 1).

Produces deterministic (seeded) mundane-but-realistic business chatter, plus
NEAR-MISS distractors that deliberately collide with the critical facts:
a second wholesale deal with the opposite outcome, a second Sarah, multiple
revenue figures from different quarters. Every retrieval system aces a clean
16-edge graph; this corpus is what makes precision@5 mean something.
"""

import random

TOPICS = [
    "We had the weekly standup, nothing major, {name} demoed the {thing} progress.",
    "Spent the morning on {thing} paperwork, tedious but done.",
    "Customer {company} asked about {thing} support, told them it's on the roadmap.",
    "The {thing} vendor raised prices by {pct}%, annoying but we'll absorb it.",
    "{name} was out sick today, {name2} covered the support queue.",
    "Looked at office plants and a new coffee machine, went with the coffee machine.",
    "Renewed the {thing} subscription for another year, {amount} total.",
    "Had lunch with a founder friend, they're struggling with churn, interesting chat.",
    "The website's {thing} page needs a refresh, added it to the backlog.",
    "{company} sent over a case-study draft, needs edits before publishing.",
    "Quarterly {thing} review went fine, no surprises.",
    "Tested three {thing} tools, none clearly better than what we have.",
    "{name} suggested we tweak the onboarding email sequence, worth trying.",
    "A journalist asked for a comment on AI trends, gave a generic quote.",
    "The {thing} integration threw errors overnight, {name} patched it by noon.",
    "Considered sponsoring a local meetup for {amount}, decided it's not worth it this quarter.",
    "Support tickets were up {pct}% this week, mostly password resets.",
    "Booked flights for the {thing} conference, economy this time.",
    "{company} churned this month, small account, exit survey said budget cuts.",
    "Reviewed {name}'s draft blog post about {thing}, solid, ships Tuesday.",
]

NAMES = ["Priya", "Marcus", "Elena", "Tom", "Jade", "Oliver", "Nina"]
NAMES2 = ["Ken", "Ruby", "Dev", "Mia"]
THINGS = ["analytics", "billing", "CRM", "onboarding", "backup", "monitoring",
          "email", "reporting", "compliance", "scheduling"]
COMPANIES = ["Northwind Dental", "Coastal Books", "GreenLeaf Cafe", "Baxter & Co",
             "Summit Legal", "Ironbark Gym", "Pearl St Florist"]

# Near-miss distractors: engineered collisions with the critical facts.
NEAR_MISS = [
    # Collides with the DECLINED wholesale deal (critical fact: declined, thin margins)
    "We accepted a small wholesale trial with Coastal Books — low volume, "
    "good margins, three-month pilot.",
    # Collides with 'Sarah the lead developer from Google'
    "Sarah Kim from the accounting firm called about the quarterly BAS lodgement.",
    "Sarah Kim confirmed the tax filing deadline is next Friday.",
    # Collides with current revenue figure (critical: $85k MRR now)
    "Back in Q1 our MRR was around $52k, felt like a different company.",
    "Q2 MRR came in at $67k, steady climb.",
    # Collides with headcount facts
    "A recruiter cold-emailed claiming they can find us ten engineers, ignored it.",
    # Collides with the zero-debt preference
    "Read an article arguing venture debt is underrated for SaaS, mildly interesting.",
]


def generate(count: int, seed: int = 42) -> list[dict]:
    """Return `count` distractor exchanges, with near-misses woven in at
    deterministic positions (~every 12th slot)."""
    rng = random.Random(seed)
    out = []
    nm = list(NEAR_MISS)
    for i in range(count):
        if nm and i % 12 == 7:
            text = nm.pop(0)
        else:
            t = rng.choice(TOPICS)
            text = t.format(
                name=rng.choice(NAMES), name2=rng.choice(NAMES2),
                thing=rng.choice(THINGS), company=rng.choice(COMPANIES),
                pct=rng.choice([3, 5, 8, 12, 15]),
                amount=f"${rng.choice([400, 900, 1500, 2400, 3000])}",
            )
        out.append({
            "user_message": text,
            "assistant_response": "Noted.",
        })
    return out
