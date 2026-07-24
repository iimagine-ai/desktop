"""Cortex sidecar entrypoint — starts uvicorn on the specified port."""

import argparse
import logging

import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(name)s %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)


def main():
    parser = argparse.ArgumentParser(description="Cortex Memory Sidecar")
    parser.add_argument("--port", type=int, default=9100, help="Port to listen on")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind")
    args = parser.parse_args()

    logging.getLogger("cortex.sidecar").info(f"Starting on {args.host}:{args.port}")

    uvicorn.run(
        "sidecar.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
