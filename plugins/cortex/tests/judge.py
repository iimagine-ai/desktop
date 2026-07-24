"""LLM judge — scores whether retrieved context contains the facts required
to answer an advisory question well (context recall, category 8).

Use a STRONG model here (not the extraction model): the judge's only job is
careful reading, and a weak judge silently corrupts your headline metric.
Configure via --judge-model / JUDGE_BASE_URL / OPENAI_API_KEY.
"""

import json
import os

import httpx

JUDGE_PROMPT = """You are grading a memory-retrieval system for a business advisory AI.

The user asked this advisory question:
{question}

The memory system retrieved this context to answer it:
---
{context}
---

For EACH required fact below, decide whether the retrieved context contains it
(exact wording not required — the information must be present and unambiguous):

{facts_json}

Output ONLY valid JSON:
{"covered": [true, false, ...]}   // one boolean per required fact, in order"""


class Judge:
    def __init__(self, model: str, api_key: str | None = None,
                 base_url: str | None = None):
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.base_url = (base_url or os.environ.get("JUDGE_BASE_URL")
                         or "https://api.openai.com/v1")

    async def context_recall(self, question: str, context: str,
                             required_facts: list[str]) -> tuple[float, list[str]]:
        """Returns (recall_fraction, missing_facts)."""
        prompt = (JUDGE_PROMPT
                  .replace("{question}", question)
                  .replace("{context}", context[:8000])
                  .replace("{facts_json}",
                           json.dumps(list(required_facts), indent=2)))

        async with httpx.AsyncClient(timeout=90.0) as c:
            r = await c.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                    "max_completion_tokens": 500,
                },
            )
            r.raise_for_status()
            raw = r.json()["choices"][0]["message"]["content"]

        start, end = raw.find("{"), raw.rfind("}")
        try:
            covered = json.loads(raw[start:end + 1])["covered"]
        except Exception:
            return 0.0, ["<judge returned unparseable output>"]

        if len(covered) != len(required_facts):
            return 0.0, ["<judge boolean count mismatch>"]

        missing = [f for f, ok in zip(required_facts, covered) if not ok]
        recall = (len(required_facts) - len(missing)) / len(required_facts)
        return recall, missing
