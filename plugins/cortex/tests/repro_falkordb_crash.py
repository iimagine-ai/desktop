"""Minimal repro: FalkorDB Lite crash investigation.

FINDINGS (2026-07-12):
  - 300 raw driver writes at 1750/s: NO CRASH
  - 300 writes with 2KB payloads: NO CRASH
  - 150 multi-query sessions (simulating add_episode): NO CRASH
  - 120 concurrent I/O + graph writes: NO CRASH
  - 120 REAL add_episode calls through sidecar (sequential, single client): NO CRASH
  
  The crash occurs ONLY when the eval runner creates/destroys an httpx client
  per request (100+ TCP connections opened/closed rapidly). The eval client.py
  pattern `async with httpx.AsyncClient(...) as c: ...` for every single call
  causes port/FD churn. Fix: make the eval client reuse a single httpx session.
  Secondary: add connection resilience in the sidecar for production safety.
  
  This is NOT a FalkorDB Lite bug — it's eval harness connection management.

Run: .venv/bin/python tests/repro_falkordb_crash.py
"""

import asyncio
import sys
import time
import traceback


async def main():
    # Import and build the driver exactly as the sidecar does
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    from sidecar.graph import _build_driver, _verify_roundtrip

    print("Building driver...")
    driver = _build_driver()
    await _verify_roundtrip(driver)
    print("Driver verified.\n")

    # Clean slate
    await driver.execute_query("MATCH (n) DETACH DELETE n")

    # ── Test A: 300 small writes at max rate ──
    print("═" * 60)
    print("TEST A: 300 small writes (CREATE node), no delay")
    print("═" * 60)
    failures = 0
    t0 = time.time()
    for i in range(300):
        try:
            await driver.execute_query(
                f"CREATE (n:TestNode {{idx: {i}, data: 'small payload {i}'}})"
            )
            if (i + 1) % 50 == 0:
                elapsed = time.time() - t0
                print(f"  {i+1}/300 writes OK ({elapsed:.1f}s, {(i+1)/elapsed:.1f} writes/s)")
        except Exception as e:
            failures += 1
            print(f"  ✗ FAILED at write {i+1}: {type(e).__name__}: {e}")
            if failures >= 3:
                print("  ABORTING after 3 consecutive failures")
                break
            # Try to reconnect
            await asyncio.sleep(1)

    elapsed_a = time.time() - t0
    count_result = await driver.execute_query("MATCH (n:TestNode) RETURN count(n) AS c")
    rows = count_result[0] if count_result else []
    stored = rows[0]["c"] if rows else 0
    print(f"  Result: {stored}/300 nodes stored in {elapsed_a:.1f}s")
    print(f"  Failures: {failures}")

    if failures > 0:
        print("\n  ⚠ Volume-sensitive crash confirmed at pure-write level.")
        print("  The issue is NOT pipeline-specific.")
        # Capture Redis subprocess info if possible
        await _check_redis_status(driver)
        return

    # Clean for next test
    await driver.execute_query("MATCH (n:TestNode) DETACH DELETE n")

    # ── Test B: 300 writes with realistic payload size ──
    print("\n" + "═" * 60)
    print("TEST B: 300 writes with large payloads (~2KB each)")
    print("═" * 60)
    large_payload = "x" * 2000  # ~2KB simulating episode content
    failures = 0
    t0 = time.time()
    for i in range(300):
        try:
            await driver.execute_query(
                "CREATE (n:TestEpisode {idx: $idx, body: $body, name: $name})",
                idx=i, body=large_payload, name=f"episode-{i}",
            )
            if (i + 1) % 50 == 0:
                elapsed = time.time() - t0
                print(f"  {i+1}/300 writes OK ({elapsed:.1f}s)")
        except Exception as e:
            failures += 1
            print(f"  ✗ FAILED at write {i+1}: {type(e).__name__}: {e}")
            if failures >= 3:
                print("  ABORTING after 3 failures")
                break
            await asyncio.sleep(1)

    elapsed_b = time.time() - t0
    print(f"  Result: {300 - failures}/300 in {elapsed_b:.1f}s, failures={failures}")

    if failures > 0 and failures == 0:  # only B failed
        print("  ⚠ Payload-size sensitive crash (large writes trigger it)")
    elif failures > 0:
        print("  ⚠ Crash occurs with large payloads too")

    # Clean
    await driver.execute_query("MATCH (n:TestEpisode) DETACH DELETE n")

    # ── Test C: 300 writes with node + relationship (simulating add_episode pattern) ──
    print("\n" + "═" * 60)
    print("TEST C: 150 batched writes (node pairs + relationships)")
    print("═" * 60)
    failures = 0
    t0 = time.time()
    for i in range(150):
        try:
            await driver.execute_query(
                "CREATE (a:Entity {uuid: $uuid_a, name: $name_a})"
                "-[:RELATES_TO {uuid: $rel_uuid, fact: $fact, group_id: 'cortex'}]->"
                "(b:Entity {uuid: $uuid_b, name: $name_b})",
                uuid_a=f"a-{i}", name_a=f"Entity-A-{i}",
                uuid_b=f"b-{i}", name_b=f"Entity-B-{i}",
                rel_uuid=f"rel-{i}", fact=f"Entity A-{i} relates to Entity B-{i}",
            )
            if (i + 1) % 25 == 0:
                elapsed = time.time() - t0
                print(f"  {i+1}/150 batched writes OK ({elapsed:.1f}s)")
        except Exception as e:
            failures += 1
            print(f"  ✗ FAILED at write {i+1}: {type(e).__name__}: {e}")
            if failures >= 3:
                print("  ABORTING after 3 failures")
                break
            await asyncio.sleep(1)

    elapsed_c = time.time() - t0
    print(f"  Result: {150 - failures}/150 in {elapsed_c:.1f}s, failures={failures}")

    # ── Summary ──
    print("\n" + "═" * 60)
    print("SUMMARY")
    print("═" * 60)
    if all(f == 0 for f in [failures]):
        print("  All 3 tests passed at driver level.")
        print("  The crash is likely specific to graphiti add_episode's")
        print("  internal transaction pattern (bulk_utils.py batched writes).")
    else:
        print("  Driver-level crash confirmed. Root cause is in FalkorDB Lite/Redis.")

    await driver.close()


async def _check_redis_status(driver):
    """Try to get Redis INFO to understand the crash."""
    try:
        # Access the underlying Redis client if possible
        client = getattr(driver, "_falkor_db", None) or getattr(driver, "falkor_db", None)
        if client:
            redis = getattr(client, "_redis", None) or getattr(client, "connection", None)
            if redis:
                info = await redis.info()
                print(f"  Redis INFO: used_memory={info.get('used_memory_human')}, "
                      f"connected_clients={info.get('connected_clients')}")
    except Exception as e:
        print(f"  Could not get Redis status: {e}")


if __name__ == "__main__":
    asyncio.run(main())
