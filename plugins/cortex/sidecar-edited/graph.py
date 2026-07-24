"""Cortex graph layer — Graphiti + FalkorDB Lite initialization.

FIX #7: The previous import (`from redislite.async_falkordb_client import
AsyncFalkorDB`) does not exist in any published package — `redislite` is an
unrelated embedded-Redis project. The official embedded package is
`falkordblite` (pip install falkordblite, Python 3.12+), and newer
graphiti-core versions ship a dedicated FalkorLiteDriver. We try the dedicated
driver first and fall back to wrapping falkordblite's client in the standard
FalkorDriver. Both paths are attempted loudly, and a write/read roundtrip
smoke test runs at startup so 'initialized but silently broken' is impossible.

FIX #5 wiring: uses NomicLocalEmbedder (prefix-aware) instead of a stock
OpenAIEmbedder pointed at the local engine.

Also: initialization errors are recorded and exposed via get_init_error() so
/health can report degraded status instead of lying (smaller-notes fix).
"""

import logging
from typing import Optional

from graphiti_core import Graphiti
from graphiti_core.llm_client.config import LLMConfig as GraphitiLLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient

from .config import DATA_DIR, DEFAULT_ENGINE_PORT
from .embeddings import NomicLocalEmbedder

logger = logging.getLogger("cortex.graph")

_graphiti: Optional[Graphiti] = None
_driver = None
_init_error: Optional[str] = None  # Surfaced by /health


def _get_db_path() -> str:
    return str(DATA_DIR / "graph.db")


def _build_driver():
    """Try the supported embedded-FalkorDB paths in order. VERIFY against your
    installed graphiti-core/falkordblite versions — run the smoke test below."""
    db_path = _get_db_path()

    # Path 1: dedicated Lite driver (newer graphiti-core).
    try:
        from graphiti_core.driver.falkordb_lite_driver import FalkorLiteDriver

        logger.info("Using graphiti_core FalkorLiteDriver")
        return FalkorLiteDriver(path=db_path)
    except ImportError:
        logger.info("FalkorLiteDriver not in this graphiti-core version; trying falkordblite")

    # Path 2: official falkordblite client wrapped in the standard FalkorDriver.
    try:
        from falkordblite import FalkorDB  # pip install falkordblite (Py 3.12+)
        from graphiti_core.driver.falkordb_driver import FalkorDriver

        client = FalkorDB(db_path)  # VERIFY: constructor arg name in your version
        logger.info("Using falkordblite.FalkorDB wrapped in FalkorDriver")
        return FalkorDriver(falkor_db=client, database="cortex")
    except ImportError as e:
        raise ImportError(
            "No embedded FalkorDB available. Install with: "
            "pip install 'graphiti-core[falkordb]' falkordblite "
            f"(original error: {e})"
        ) from e


async def _verify_roundtrip(driver) -> None:
    """Write, read, and delete a probe node. Raises if the graph is not usable.

    This is the two-minute test that would have caught the previous silent
    failures: if this passes, storage genuinely works."""
    await driver.execute_query(
        "CREATE (p:CortexProbe {k: 'probe', v: 1})"
    )
    result = await driver.execute_query(
        "MATCH (p:CortexProbe {k: 'probe'}) RETURN p.v AS v"
    )
    rows = result[0] if result else []
    if not rows or rows[0].get("v") != 1:
        raise RuntimeError("FalkorDB roundtrip failed: probe node not readable")
    await driver.execute_query("MATCH (p:CortexProbe) DELETE p")
    logger.info("FalkorDB roundtrip smoke test PASSED")


def _build_llm_client(api_key, model, base_url, engine_port):
    if api_key and model:
        return OpenAIGenericClient(
            config=GraphitiLLMConfig(
                api_key=api_key,
                model=model,
                small_model=model,
                base_url=base_url,
                temperature=0.1,
            )
        )
    # Placeholder until first /extract hot-swaps the real provider.
    return OpenAIGenericClient(
        config=GraphitiLLMConfig(
            api_key="placeholder",
            model="placeholder",
            small_model="placeholder",
            base_url=f"http://127.0.0.1:{engine_port}/v1",
            temperature=0.1,
        )
    )


async def initialize(
    llm_api_key: Optional[str] = None,
    llm_model: Optional[str] = None,
    llm_base_url: Optional[str] = None,
    engine_port: int = DEFAULT_ENGINE_PORT,
):
    global _graphiti, _driver, _init_error
    _init_error = None

    try:
        _driver = _build_driver()

        embedder = NomicLocalEmbedder(engine_port=engine_port)  # FIX #5

        llm_client = _build_llm_client(llm_api_key, llm_model, llm_base_url, engine_port)

        from graphiti_core.cross_encoder.openai_reranker_client import (
            OpenAIRerankerClient,
        )

        cross_encoder = OpenAIRerankerClient(
            config=GraphitiLLMConfig(
                api_key=llm_api_key or "placeholder",
                model=llm_model or "placeholder",
                base_url=llm_base_url or f"http://127.0.0.1:{engine_port}/v1",
            )
        )

        _graphiti = Graphiti(
            graph_driver=_driver,
            embedder=embedder,
            llm_client=llm_client,
            cross_encoder=cross_encoder,
            store_raw_episode_content=True,
        )

        await _graphiti.build_indices_and_constraints()
        await _verify_roundtrip(_driver)  # FIX #7: fail loudly at startup

        logger.info(f"Graphiti initialized with embedded FalkorDB at {_get_db_path()}")

    except Exception as e:
        _init_error = f"{type(e).__name__}: {e}"
        _graphiti = None
        _driver = None
        logger.critical(f"Graphiti initialization FAILED — memory disabled: {_init_error}")
        raise


def get_graphiti() -> Optional[Graphiti]:
    return _graphiti


def get_driver():
    return _driver


def get_init_error() -> Optional[str]:
    """Non-None means the sidecar is running in degraded (memoryless) mode."""
    return _init_error


async def reconfigure_llm(
    api_key: str,
    model: str,
    base_url: Optional[str] = None,
    provider: str = "openai",
):
    """Hot-swap the LLM client without reinitializing the graph."""
    global _graphiti
    if not _graphiti:
        logger.warning("Cannot reconfigure LLM — Graphiti not initialized")
        return

    if provider == "anthropic":
        try:
            from graphiti_core.llm_client.anthropic_client import AnthropicClient

            new_llm = AnthropicClient(
                config=GraphitiLLMConfig(api_key=api_key, model=model)
            )
        except ImportError:
            logger.warning("anthropic client unavailable; using OpenAI-compat")
            new_llm = OpenAIGenericClient(
                config=GraphitiLLMConfig(api_key=api_key, model=model, base_url=base_url)
            )
    else:
        new_llm = OpenAIGenericClient(
            config=GraphitiLLMConfig(
                api_key=api_key,
                model=model,
                small_model=model,
                base_url=base_url,
                temperature=0.1,
            )
        )

    from graphiti_core.cross_encoder.openai_reranker_client import OpenAIRerankerClient

    new_cross_encoder = OpenAIRerankerClient(
        config=GraphitiLLMConfig(api_key=api_key, model=model, base_url=base_url)
    )

    _graphiti.llm_client = new_llm
    _graphiti.cross_encoder = new_cross_encoder
    _graphiti.clients.llm_client = new_llm
    _graphiti.clients.cross_encoder = new_cross_encoder
    logger.info(f"LLM reconfigured: {provider}/{model}")


async def get_stats() -> dict:
    if not _driver:
        return {"entities": 0, "edges": 0, "facts": 0, "episodes": 0}
    try:
        async def _count(q: str) -> int:
            res = await _driver.execute_query(q)
            rows = res[0] if res else []
            return rows[0]["c"] if rows else 0

        entities = await _count("MATCH (e:Entity) RETURN count(e) AS c")
        edges = await _count("MATCH ()-[r:RELATES_TO]->() RETURN count(r) AS c")
        episodes = await _count("MATCH (ep:Episodic) RETURN count(ep) AS c")
        return {"entities": entities, "edges": edges, "facts": edges, "episodes": episodes}
    except Exception as e:
        logger.debug(f"Stats query failed: {e}")
        return {"entities": 0, "edges": 0, "facts": 0, "episodes": 0}


async def clear_all() -> None:
    if not _driver:
        return
    await _driver.execute_query("MATCH (n) DETACH DELETE n")
    logger.info("All graph data cleared")


async def close() -> None:
    global _graphiti, _driver
    if _driver:
        try:
            await _driver.close()
        except Exception as e:
            logger.debug(f"Driver close error: {e}")
    _graphiti = None
    _driver = None
