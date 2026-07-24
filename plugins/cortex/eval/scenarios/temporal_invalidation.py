"""Temporal invalidation scenario — the mandatory test.

Tests that when a user states contradicting information across sessions,
the old fact is invalidated and no longer retrieved.

Example: User says they use Notion, later switches to Obsidian.
After the second session, queries about "what tool?" should return
Obsidian and NOT Notion.
"""

from ..models import EvalScenario, SessionScript, VerificationQuery

scenario = EvalScenario(
    name="temporal_invalidation",
    description="Verifies that contradicting facts invalidate old information in retrieval",
    sessions=[
        SessionScript(
            messages=[
                {"role": "user", "content": "I use Notion for all my project management and note-taking. It's my central hub for everything."},
                {"role": "assistant", "content": "Got it — Notion is your central project management and note-taking tool."},
            ]
        ),
        SessionScript(
            messages=[
                {"role": "user", "content": "I've completely switched from Notion to Obsidian now. Moved everything over last week. Obsidian is my main tool for notes and project tracking."},
                {"role": "assistant", "content": "Understood — you've migrated from Notion to Obsidian for all your notes and project management."},
            ],
            delay_minutes=60,  # Simulate 1 hour gap
        ),
    ],
    queries=[
        VerificationQuery(
            query="What tool does the user use for project management and notes?",
            expected_entities=["Obsidian"],
            excluded_entities=["Notion"],  # Should be invalidated
            min_precision=1.0,
            min_recall=1.0,
            max_latency_ms=500.0,
        ),
        VerificationQuery(
            query="What is the user's main productivity tool?",
            expected_entities=["Obsidian"],
            excluded_entities=["Notion"],
            min_precision=0.8,
            min_recall=0.8,
            max_latency_ms=500.0,
        ),
    ],
)
