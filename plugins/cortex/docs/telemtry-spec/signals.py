"""Cortex proxy signals — automatic recall-failure detection, no judge needed.

Both detectors run async AFTER the response is delivered (triggered by
POST /log/response). They convert the product's core claims into measurable
events:
  - redundant_question: the AI asked for something memory already knew
    ("never asks 'remind me what your MRR is?'" — now instrumented)
  - correction: the user vocalized a memory failure ("I already told you...")
"""

import logging
import re
from typing import Awaitable, Callable, Optional

from .telemetry import flag_exchange, log_event

logger = logging.getLogger("cortex.signals")

SIMILARITY_THRESHOLD = 0.75
MAX_QUESTIONS_CHECKED = 2
MIN_QUESTION_LEN = 15

# Tune during the 2-week calibration; the weekly audit adjudicates hits.
CORRECTION_PATTERNS = [
    r"\bi (?:already|just) told you\b",
    r"\bas i (?:said|mentioned|told you)\b",
    r"\bi(?:'ve| have) (?:already )?(?:said|mentioned|told you)\b",
    r"\bwe(?:'ve| have)? already (?:discussed|covered|talked about)\b",
    r"\bno[,.]? (?:it's|its|it is) actually\b",
    r"\bthat(?:'s| is) not what i said\b",
    r"\bwhy are you asking(?:\s+me)? again\b",
    r"\byou (?:already )?(?:know|have) (?:this|that)\b",
]
_CORRECTION_RE = [re.compile(p, re.IGNORECASE) for p in CORRECTION_PATTERNS]

_QUESTION_RE = re.compile(r"([^.!?\n]{%d,}?\?)" % MIN_QUESTION_LEN)


def extract_questions(text: str) -> list[str]:
    """Question sentences in the assistant's reply, longest first, capped."""
    qs = [q.strip() for q in _QUESTION_RE.findall(text or "")]
    qs.sort(key=len, reverse=True)
    return qs[:MAX_QUESTIONS_CHECKED]


def detect_correction(user_message: str) -> Optional[str]:
    """Return the matched pattern if the user message reads as a correction
    of the AI's memory, else None."""
    for rx in _CORRECTION_RE:
        m = rx.search(user_message or "")
        if m:
            return m.group(0)
    return None


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


async def check_redundant_questions(
    exchange_id: Optional[str],
    session_id: Optional[str],
    assistant_response: str,
    search_fn: Callable[[str, int], Awaitable[list[dict]]],
    embed_query_fn: Callable[[str], Awaitable[list[float]]],
    embed_doc_fn: Callable[[str], Awaitable[list[float]]],
) -> int:
    """For each question in the reply: search the graph, embed the top facts,
    cosine locally. A high-similarity hit against a stored valid fact means
    the AI asked for something it should have known.

    search_fn must return only VALID (non-invalidated) facts — a question
    about a superseded value is legitimate clarification, not redundancy.
    All embed calls hit the local engine; this runs entirely off the hot path.
    """
    hits = 0
    for question in extract_questions(assistant_response):
        try:
            results = await search_fn(question, 3)
            if not results:
                continue
            q_emb = await embed_query_fn(question)
            for r in results:
                fact = r.get("fact") or ""
                if not fact:
                    continue
                f_emb = await embed_doc_fn(fact)
                sim = _cosine(q_emb, f_emb)
                if sim >= SIMILARITY_THRESHOLD:
                    hits += 1
                    log_event("redundant_question", exchange_id, session_id,
                              question=question[:200], matched_fact=fact[:200],
                              similarity=round(sim, 3))
                    if exchange_id:
                        flag_exchange(exchange_id, "redundant_question")
                    logger.info(f"signal: redundant question "
                                f"(sim {sim:.2f}): {question[:60]}")
                    break  # one hit per question is enough
        except Exception as e:
            logger.debug(f"redundant-question check failed: {e}")
    return hits


def check_correction(exchange_id: Optional[str], session_id: Optional[str],
                     user_message: str) -> bool:
    pattern = detect_correction(user_message)
    if pattern:
        log_event("correction", exchange_id, session_id,
                  pattern=pattern, user_message_head=(user_message or "")[:200])
        if exchange_id:
            flag_exchange(exchange_id, "correction")
        logger.info(f"signal: correction detected ({pattern})")
        return True
    return False
