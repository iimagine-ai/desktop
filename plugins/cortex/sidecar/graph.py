"""Cortex graph layer — thin delegation to the active adapter.

This file exists as a transition shim. All modules that previously imported
from .graph now get a GraphPort-compatible adapter instance. The adapter
(adapters/graphiti_adapter.py) is the ONLY file that imports graphiti_core.

Post-refactor, callers should import from .ports and receive the adapter
via dependency injection (the _adapter singleton below). During transition,
the old function signatures (get_graphiti, get_driver, etc.) are preserved
as deprecation shims that delegate to the adapter.

Architecture decision (2026-07-15):
- graph.py = singleton holder + backward-compat shims
- ports.py = the interface
- adapters/graphiti_adapter.py = the implementation
"""

import logging
from typing import Optional

from .adapters.graphiti_adapter import GraphitiAdapter
from .config import DEFAULT_ENGINE_PORT

logger = logging.getLogger("cortex.graph")

_adapter: Optional[GraphitiAdapter] = None


def get_adapter() -> Optional[GraphitiAdapter]:
    """Get the active graph adapter. The canonical way to access the graph."""
    return _adapter


async def initialize(
    llm_api_key: Optional[str] = None,
    llm_model: Optional[str] = None,
    llm_base_url: Optional[str] = None,
    engine_port: int = DEFAULT_ENGINE_PORT,
):
    """Initialize the graph adapter."""
    global _adapter
    _adapter = GraphitiAdapter(engine_port=engine_port)
    await _adapter.initialize()


async def close():
    """Shut down the graph adapter."""
    global _adapter
    if _adapter:
        await _adapter.close()
    _adapter = None


# ── Backward-compat shims (used during transition) ───────────────
# These delegate to the adapter so existing callers don't break.
# Callers should migrate to using get_adapter() directly.


def get_graphiti():
    """DEPRECATED: Use get_adapter() instead.
    Returns the raw Graphiti instance for callers that haven't migrated yet."""
    if _adapter and _adapter._graphiti:
        return _adapter._graphiti
    return None


def get_driver():
    """DEPRECATED: Use get_adapter() typed methods instead.
    Returns the raw driver for callers that haven't migrated yet."""
    if _adapter:
        return _adapter._driver
    return None


def get_init_error() -> Optional[str]:
    """Returns init error string or None."""
    if _adapter:
        return _adapter.get_init_error()
    return "Adapter not initialized"


async def get_stats() -> dict:
    """Delegate to adapter."""
    if _adapter:
        return await _adapter.get_stats()
    return {"entities": 0, "edges": 0, "facts": 0, "episodes": 0}


async def clear_all() -> None:
    """Delegate to adapter."""
    if _adapter:
        await _adapter.clear_all()


async def reconfigure_llm(
    api_key: str,
    model: str,
    base_url: Optional[str] = None,
    provider: str = "openai",
):
    """Delegate to adapter."""
    if _adapter:
        await _adapter.reconfigure_llm(api_key, model, base_url, provider)
