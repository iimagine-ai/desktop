"""Cortex sidecar configuration.

Smaller-notes fix: every constant here now maps to implemented behavior.
The previously advertised-but-unused reranker constants (RRF_K, per-channel
caps) are gone; RECENCY_HALF_LIFE_DAYS / SALIENCE_FLOOR are now genuinely
used by the relevance x recency x salience reranker in main.py.
"""

import os
from pathlib import Path

# Debug mode: re-raise exceptions instead of degrading silently.
# Set CORTEX_DEBUG=1 during development. (Smaller-notes fix.)
CORTEX_DEBUG = os.environ.get("CORTEX_DEBUG", "0") == "1"

# Base data directory
DATA_DIR = Path(os.path.expanduser("~/.iimagine/memory"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Profile document paths
PROFILE_PATH = DATA_DIR / "profile.json"
PENDING_UPDATES_PATH = DATA_DIR / "pending_updates.json"

# Embedding endpoint (llama.cpp engine)
DEFAULT_ENGINE_PORT = 8847
EMBEDDING_DIMENSIONS = 768
EMBEDDING_MODEL = "nomic-embed-text"

# Retrieval
DEFAULT_TOKEN_BUDGET = 1500
PROFILE_BUDGET_RATIO = 0.35       # Max 35% of token budget for profile (was 0.4 — briefs absorb goal-section duty)
BRIEFS_BUDGET_RATIO = 0.25        # ≤2 briefs × ≤200 tokens; unused returns to facts
RETRIEVAL_CANDIDATES = 30         # Fetched from Graphiti before reranking

# Priority reranker (implemented in main.py: relevance x recency x salience)
RECENCY_HALF_LIFE_DAYS = 30.0     # Recency score halves every 30 days
SALIENCE_FLOOR = 0.1              # Untyped facts never score zero
RERANK_W_RELEVANCE = 0.5          # Weight: Graphiti hybrid-search rank
RERANK_W_RECENCY = 0.25           # Weight: exponential time decay
RERANK_W_SALIENCE = 0.25          # Weight: LLM-assigned importance

# Reflection
SESSION_IDLE_MINUTES = 5
MAX_DEFERRED_REFLECTIONS = 5

# Profile updates
STALE_UPDATE_DAYS = 7
LOW_SALIENCE_THRESHOLD = 0.3
HIGH_SALIENCE_THRESHOLD = 0.7
CONSOLIDATION_THRESHOLD = 8      # key_facts per section before LLM rewrite
