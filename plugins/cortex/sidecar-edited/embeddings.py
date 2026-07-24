"""Cortex embedder — Graphiti EmbedderClient for local nomic-embed-text.

FIX #5: Previously this module implemented Nomic's required task prefixes
(search_document: / search_query:) but was never wired in — graph.py used a
stock OpenAIEmbedder that bypassed it entirely. This rewrite subclasses
Graphiti's EmbedderClient so the prefixes are applied on every embedding that
actually flows through the pipeline.

Graphiti uses ONE embedder for both ingestion and query embedding, so we route
the prefix with a contextvar: retrieval endpoints wrap graphiti.search(...) in
`query_mode()` (see main.py); everything else defaults to storage mode.

CRITICAL invariants:
- All embeddings MUST come from the same model. Never mix models.
- If you change the prefix scheme, the entire graph must be re-embedded.

VERIFY on your installed graphiti-core version:
- Base class path: graphiti_core.embedder.client.EmbedderClient
- Abstract methods: create() and create_batch()
"""

import contextvars
import logging
from contextlib import contextmanager
from typing import Iterable, Optional

import httpx
from graphiti_core.embedder.client import EmbedderClient  # VERIFY import path

from .config import DEFAULT_ENGINE_PORT, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL

logger = logging.getLogger("cortex.embeddings")

STORAGE_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "

# False = storage mode (default, used during ingestion),
# True = query mode (set by retrieval endpoints around graphiti.search()).
_query_mode: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "nomic_query_mode", default=False
)


@contextmanager
def query_mode():
    """Wrap retrieval calls so query embeddings get the search_query: prefix."""
    token = _query_mode.set(True)
    try:
        yield
    finally:
        _query_mode.reset(token)


def _prefix(text: str) -> str:
    if not text:
        return text
    # Never double-prefix.
    if text.startswith(STORAGE_PREFIX) or text.startswith(QUERY_PREFIX):
        return text
    return (QUERY_PREFIX if _query_mode.get() else STORAGE_PREFIX) + text


class NomicLocalEmbedder(EmbedderClient):
    """Embeds via the local llama.cpp /v1/embeddings endpoint with Nomic prefixes."""

    def __init__(self, engine_port: int = DEFAULT_ENGINE_PORT):
        self.base_url = f"http://127.0.0.1:{engine_port}"

    async def create(self, input_data) -> list[float]:
        """Embed a single input. Graphiti may pass a str or a list of str/tokens."""
        if isinstance(input_data, list):
            # Graphiti sometimes wraps a single text in a list.
            text = " ".join(str(t) for t in input_data)
        else:
            text = str(input_data)

        vectors = await self._embed_batch([_prefix(text)])
        return vectors[0]

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        return await self._embed_batch([_prefix(t) for t in input_data_list])

    async def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/v1/embeddings",
                json={"input": texts, "model": EMBEDDING_MODEL},
            )
            resp.raise_for_status()  # Fail loudly — graph.py/main.py decide policy
            data = resp.json()

            vectors = [item.get("embedding") for item in data.get("data", [])]
            for vec in vectors:
                if not vec or len(vec) != EMBEDDING_DIMENSIONS:
                    raise ValueError(
                        f"Embedding dim mismatch: expected {EMBEDDING_DIMENSIONS}, "
                        f"got {len(vec) if vec else 0}. Wrong model loaded on engine?"
                    )
            return vectors


async def verify_prefix_handling(engine_port: int = DEFAULT_ENGINE_PORT) -> bool:
    """Startup self-test: confirm prefixes change the vector (i.e. aren't stripped)."""
    embedder = NomicLocalEmbedder(engine_port)
    test_text = "what is my business strategy"
    try:
        with_prefix = (await embedder._embed_batch([QUERY_PREFIX + test_text]))[0]
        without_prefix = (await embedder._embed_batch([test_text]))[0]
    except Exception as e:
        logger.warning(f"Cannot verify prefix handling — engine unavailable: {e}")
        return False

    if with_prefix == without_prefix:
        logger.error(
            "CRITICAL: Nomic prefixes are being stripped by the engine — "
            "retrieval quality will be degraded. Check llama.cpp template config."
        )
        return False

    logger.info("Nomic prefix verification PASSED")
    return True
