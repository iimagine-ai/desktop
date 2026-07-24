"""Cortex LLM adapter — routes extraction/reflection prompts to the active LLM.

Only change in this revision: LLMConfig is imported from models.py instead of
main.py, removing the latent circular import (main -> extraction -> ... ->
llm_adapter -> main).
"""

import logging
from typing import Optional

import httpx

from .models import LLMConfig

logger = logging.getLogger("cortex.llm")

EXTRACTION_TIMEOUT = 60.0


async def call_llm(prompt: str, config: LLMConfig, max_tokens: int = 2000) -> Optional[str]:
    """Send a prompt to the active LLM and return raw text. None on failure."""
    try:
        if config.provider == "local":
            return await _call_local(prompt, config, max_tokens)
        elif config.provider == "anthropic":
            return await _call_anthropic(prompt, config, max_tokens)
        elif config.provider == "google":
            return await _call_google(prompt, config, max_tokens)
        else:
            return await _call_openai_compat(prompt, config, max_tokens)
    except Exception as e:
        logger.warning(f"LLM call failed ({config.provider}/{config.model}): {e}")
        return None


async def _call_local(prompt: str, config: LLMConfig, max_tokens: int) -> Optional[str]:
    base_url = config.base_url or f"http://127.0.0.1:{config.engine_port}"
    async with httpx.AsyncClient(timeout=EXTRACTION_TIMEOUT) as client:
        resp = await client.post(
            f"{base_url}/v1/chat/completions",
            json={
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "temperature": 0.1,
                "max_tokens": max_tokens,
            },
        )
        if resp.status_code != 200:
            logger.warning(f"Local LLM error: {resp.status_code} — {resp.text[:200]}")
            return None
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "")


async def _call_openai_compat(prompt: str, config: LLMConfig, max_tokens: int) -> Optional[str]:
    if not config.api_key:
        logger.warning(f"No API key for {config.provider}")
        return None

    url = {
        "openai": "https://api.openai.com/v1/chat/completions",
        "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    }.get(config.provider, "https://api.openai.com/v1/chat/completions")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.api_key}",
    }
    if config.provider == "openrouter":
        headers["HTTP-Referer"] = "https://iimagine.ai"
        headers["X-Title"] = "IIMAGINE Desktop"

    async with httpx.AsyncClient(timeout=EXTRACTION_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers=headers,
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_completion_tokens": max_tokens,
                "temperature": 0.1,
                "stream": False,
            },
        )
        if resp.status_code != 200:
            logger.warning(f"{config.provider} error: {resp.status_code} — {resp.text[:200]}")
            return None
        data = resp.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "")


async def _call_anthropic(prompt: str, config: LLMConfig, max_tokens: int) -> Optional[str]:
    if not config.api_key:
        logger.warning("No API key for Anthropic")
        return None
    async with httpx.AsyncClient(timeout=EXTRACTION_TIMEOUT) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": config.api_key,
                "anthropic-version": "2023-06-01",
            },
            json={
                "model": config.model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.1,
            },
        )
        if resp.status_code != 200:
            logger.warning(f"Anthropic error: {resp.status_code} — {resp.text[:200]}")
            return None
        data = resp.json()
        return data.get("content", [{}])[0].get("text", "")


async def _call_google(prompt: str, config: LLMConfig, max_tokens: int) -> Optional[str]:
    if not config.api_key:
        logger.warning("No API key for Google")
        return None
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{config.model}:generateContent?key={config.api_key}"
    )
    async with httpx.AsyncClient(timeout=EXTRACTION_TIMEOUT) as client:
        resp = await client.post(
            url,
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens},
            },
        )
        if resp.status_code != 200:
            logger.warning(f"Gemini error: {resp.status_code} — {resp.text[:200]}")
            return None
        data = resp.json()
        return (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "")
        )
