"""Sidecar HTTP client for the eval harness.

SESSION-3 FIX: Reuse a single httpx.AsyncClient instance across the entire
eval run instead of creating/destroying one per request. The previous pattern
caused TCP port exhaustion under sustained load (100+ rapid connections),
which manifested as FalkorDB Lite 'Connection refused' — the embedded Redis
socket was fine, but the OS ran out of ephemeral ports for new connections.
"""

import httpx


class SidecarClient:
    def __init__(self, base_url: str, llm_config: dict, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.llm_config = llm_config
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def _post(self, path: str, payload: dict) -> dict:
        c = await self._get_client()
        for attempt in range(3):
            try:
                r = await c.post(f"{self.base_url}{path}", json=payload)
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
                if attempt < 2 and (
                    isinstance(e, (httpx.ConnectError, httpx.ReadTimeout))
                    or (isinstance(e, httpx.HTTPStatusError) and e.response.status_code >= 500)
                ):
                    import asyncio
                    await asyncio.sleep(2 ** attempt)  # 1s, 2s backoff
                    continue
                raise

    async def _get(self, path: str) -> dict:
        c = await self._get_client()
        r = await c.get(f"{self.base_url}{path}")
        r.raise_for_status()
        return r.json()

    async def health(self) -> dict:
        return await self._get("/health")

    async def extract(self, user_message: str, assistant_response: str = "",
                      session_id: str = "eval") -> dict:
        return await self._post("/extract", {
            "user_message": user_message,
            "assistant_response": assistant_response,
            "llm_config": self.llm_config,
            "session_id": session_id,
        })

    async def search(self, query: str, limit: int = 5) -> list[dict]:
        data = await self._post("/search", {"query": query, "limit": limit})
        return data.get("results", [])

    async def retrieve(self, query: str, token_budget: int = 1500,
                       include_profile: bool = True) -> dict:
        return await self._post("/retrieve", {
            "query": query,
            "token_budget": token_budget,
            "include_profile": include_profile,
        })

    async def reflect(self) -> dict:
        return await self._post("/reflect", {"llm_config": self.llm_config})

    async def pending_updates(self) -> list[dict]:
        data = await self._get("/pending-updates")
        return data.get("updates", [])

    async def approve_update(self, update_id: str) -> dict:
        c = await self._get_client()
        r = await c.post(f"{self.base_url}/pending-updates/{update_id}/approve")
        r.raise_for_status()
        return r.json()

    async def stats(self) -> dict:
        return await self._get("/stats")

    async def profile(self) -> dict:
        return await self._get("/profile")

    async def clear(self) -> dict:
        c = await self._get_client()
        r = await c.delete(f"{self.base_url}/clear")
        r.raise_for_status()
        return r.json()

    async def cypher(self, query: str) -> dict | None:
        """Requires the /debug/cypher endpoint patch (see sidecar_patch/).
        Returns None if the endpoint is absent so assertions can SKIP."""
        try:
            return await self._post("/debug/cypher", {"query": query})
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (404, 405):
                return None
            raise
