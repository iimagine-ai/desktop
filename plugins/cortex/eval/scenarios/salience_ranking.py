"""Salience ranking scenario — verifies high-importance facts surface before low-importance ones."""

from ..models import EvalScenario, SessionScript, VerificationQuery

scenario = EvalScenario(
    name="salience_ranking",
    description="Verifies that high-salience facts (decisions, financial) rank above low-salience facts (greetings, preferences)",
    sessions=[
        SessionScript(
            messages=[
                {"role": "user", "content": "By the way, I prefer morning meetings over afternoon ones. Also, I just committed $50,000 to expand into the Melbourne market next quarter. We signed the lease yesterday."},
                {"role": "assistant", "content": "That's a major commitment — $50K for Melbourne expansion with the lease signed. I'll note your morning meeting preference too. The Melbourne move is a significant strategic decision."},
            ]
        ),
        SessionScript(
            messages=[
                {"role": "user", "content": "Oh and I like my coffee black. More importantly, we decided to hire a full-time SEO specialist for $85K salary to handle the GreenLeaf account growth."},
                {"role": "assistant", "content": "The $85K SEO specialist hire for GreenLeaf is a strong investment given they're 40% of revenue. Coffee preference noted too!"},
            ]
        ),
    ],
    queries=[
        VerificationQuery(
            query="What major financial decisions has the business made recently?",
            expected_entities=["Melbourne"],  # The $50K expansion should rank high
            min_precision=0.7,
            min_recall=0.7,
            max_latency_ms=500.0,
        ),
    ],
)
