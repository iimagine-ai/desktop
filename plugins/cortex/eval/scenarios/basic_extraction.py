"""Basic extraction scenario — verifies entities and facts are correctly extracted and retrievable."""

from ..models import EvalScenario, SessionScript, VerificationQuery

scenario = EvalScenario(
    name="basic_extraction",
    description="Verifies that entities, relationships, and facts are extracted from conversations and retrievable",
    sessions=[
        SessionScript(
            messages=[
                {"role": "user", "content": "My name is Sarah Chen and I run a digital marketing agency called Bright Spark Digital. We have 8 employees and our main service is SEO consulting for e-commerce businesses."},
                {"role": "assistant", "content": "Nice to meet you, Sarah! So you're running Bright Spark Digital — an 8-person digital marketing agency focused on SEO consulting for e-commerce. That's a solid niche."},
            ]
        ),
        SessionScript(
            messages=[
                {"role": "user", "content": "Our biggest client is GreenLeaf Organics, they account for about 40% of our revenue. We also work with two smaller e-commerce brands."},
                {"role": "assistant", "content": "GreenLeaf Organics at 40% of revenue is significant concentration. Having two other e-commerce clients provides some diversification, though that single-client dependency is worth watching."},
            ]
        ),
    ],
    queries=[
        VerificationQuery(
            query="Who is the business owner and what's the business name?",
            expected_entities=["Sarah Chen", "Bright Spark Digital"],
            min_precision=0.8,
            min_recall=0.8,
            max_latency_ms=500.0,
        ),
        VerificationQuery(
            query="What does the business do and how many employees?",
            expected_entities=["Bright Spark Digital"],
            min_precision=0.7,
            min_recall=0.7,
            max_latency_ms=500.0,
        ),
        VerificationQuery(
            query="Who is the biggest client?",
            expected_entities=["GreenLeaf Organics"],
            min_precision=0.8,
            min_recall=0.8,
            max_latency_ms=500.0,
        ),
    ],
)
