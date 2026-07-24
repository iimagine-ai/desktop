"""Cortex eval suite — ingest-then-interrogate runner.

Usage:
    cd plugins/cortex
    source .venv/bin/activate
    OPENAI_API_KEY=sk-... python eval/run.py [--model gpt-5.4-mini] [--port 9199]

Requires a running sidecar (starts one if none detected).
Clears all graph data before running, then executes scenarios in sequence.
"""

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

SCENARIOS_DIR = Path(__file__).parent / "scenarios"


@dataclass
class Assertion:
    description: str
    query: str  # Search/retrieve query
    expected_contains: list[str] = field(default_factory=list)  # Substrings that MUST appear
    expected_absent: list[str] = field(default_factory=list)  # Substrings that MUST NOT appear
    expected_section: str | None = None  # Profile section where fact should land
    expected_tier: str | None = None  # Salience tier (low/medium/high)
    min_results: int = 1


@dataclass
class Exchange:
    user_message: str
    assistant_response: str


@dataclass
class Scenario:
    name: str
    description: str
    exchanges: list[Exchange]
    assertions: list[Assertion]


@dataclass
class Result:
    scenario: str
    assertion: str
    passed: bool
    detail: str = ""


class EvalRunner:
    def __init__(self, base_url: str, model: str, api_key: str):
        self.base_url = base_url
        self.model = model
        self.api_key = api_key
        self.results: list[Result] = []

    async def run_all(self) -> list[Result]:
        scenarios = self._load_scenarios()
        print(f"\n{'='*60}")
        print(f"CORTEX EVAL SUITE — {len(scenarios)} scenarios")
        print(f"Model: {self.model} | Sidecar: {self.base_url}")
        print(f"{'='*60}\n")

        # Clear graph
        async with httpx.AsyncClient(timeout=10) as c:
            await c.delete(f"{self.base_url}/clear")

        for scenario in scenarios:
            await self._run_scenario(scenario)

        self._print_summary()
        return self.results

    async def _run_scenario(self, scenario: Scenario):
        print(f"▶ {scenario.name}: {scenario.description}")

        # Ingest exchanges
        async with httpx.AsyncClient(timeout=90) as c:
            for i, ex in enumerate(scenario.exchanges):
                resp = await c.post(
                    f"{self.base_url}/extract",
                    json={
                        "user_message": ex.user_message,
                        "assistant_response": ex.assistant_response,
                        "llm_config": {
                            "provider": "openai",
                            "model": self.model,
                            "api_key": self.api_key,
                        },
                        "session_id": f"eval-{scenario.name}",
                    },
                )
                if resp.status_code != 200:
                    print(f"  ✗ Extract {i+1} failed: {resp.status_code}")
                    return
                data = resp.json()
                print(f"  Ingested {i+1}/{len(scenario.exchanges)}: "
                      f"{data.get('entities_created', 0)}E {data.get('relationships_created', 0)}R")

            # Small delay for graph consistency
            await asyncio.sleep(1)

            # Run assertions
            for assertion in scenario.assertions:
                result = await self._check_assertion(assertion, c)
                self.results.append(Result(
                    scenario=scenario.name,
                    assertion=assertion.description,
                    passed=result[0],
                    detail=result[1],
                ))
                status = "✓" if result[0] else "✗"
                print(f"  {status} {assertion.description}")
                if not result[0]:
                    print(f"    → {result[1]}")

        print()

    async def _check_assertion(self, a: Assertion, client: httpx.AsyncClient) -> tuple[bool, str]:
        # Search
        resp = await client.post(
            f"{self.base_url}/search",
            json={"query": a.query, "limit": 10},
        )
        if resp.status_code != 200:
            return False, f"Search failed: {resp.status_code}"

        results = resp.json().get("results", [])
        all_facts = " ".join(r.get("fact", "") for r in results).lower()

        # Check min results
        if len(results) < a.min_results:
            return False, f"Got {len(results)} results, expected >= {a.min_results}"

        # Check expected_contains
        for phrase in a.expected_contains:
            if phrase.lower() not in all_facts:
                return False, f"Missing expected: '{phrase}' in results"

        # Check expected_absent
        for phrase in a.expected_absent:
            if phrase.lower() in all_facts:
                return False, f"Found unexpected: '{phrase}' in results"

        # Check profile section routing
        if a.expected_section:
            updates_resp = await client.get(f"{self.base_url}/pending-updates")
            updates = updates_resp.json().get("updates", [])
            found_in_section = any(
                u["section"] == a.expected_section and a.query.lower()[:20] in u["proposed_change"].lower()
                for u in updates
            )
            # Also check if any update contains our expected content in the right section
            if not found_in_section:
                found_in_section = any(
                    u["section"] == a.expected_section
                    and any(p.lower() in u["proposed_change"].lower() for p in a.expected_contains)
                    for u in updates
                )
            if not found_in_section:
                return False, f"Expected profile section '{a.expected_section}', not found"

        return True, f"{len(results)} results matched"

    def _load_scenarios(self) -> list[Scenario]:
        scenarios = []
        for f in sorted(SCENARIOS_DIR.glob("*.json")):
            data = json.loads(f.read_text())
            scenarios.append(Scenario(
                name=data["name"],
                description=data["description"],
                exchanges=[Exchange(**e) for e in data["exchanges"]],
                assertions=[Assertion(**a) for a in data["assertions"]],
            ))
        return scenarios

    def _print_summary(self):
        passed = sum(1 for r in self.results if r.passed)
        total = len(self.results)
        print(f"\n{'='*60}")
        print(f"RESULTS: {passed}/{total} assertions passed")
        print(f"{'='*60}")

        if passed < total:
            print("\nFailed:")
            for r in self.results:
                if not r.passed:
                    print(f"  [{r.scenario}] {r.assertion}: {r.detail}")


async def main():
    parser = argparse.ArgumentParser(description="Cortex eval suite")
    parser.add_argument("--model", default="gpt-5.4-mini")
    parser.add_argument("--port", type=int, default=9199)
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()

    import os
    api_key = args.api_key or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("ERROR: Set OPENAI_API_KEY env var or pass --api-key")
        sys.exit(1)

    base_url = f"http://127.0.0.1:{args.port}"

    # Check sidecar is running
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            resp = await c.get(f"{base_url}/health")
            if resp.status_code != 200:
                print(f"ERROR: Sidecar not healthy at {base_url}")
                sys.exit(1)
    except httpx.ConnectError:
        print(f"ERROR: Sidecar not running at {base_url}")
        sys.exit(1)

    runner = EvalRunner(base_url, args.model, api_key)
    results = await runner.run_all()

    sys.exit(0 if all(r.passed for r in results) else 1)


if __name__ == "__main__":
    asyncio.run(main())
