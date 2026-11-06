#!/usr/bin/env python3
"""Start the extracted package locally without accounts, AI calls, or external traffic."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request


def unused_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def check(release):
    node = str(release / "runtime/node")
    backend_port, frontend_port = unused_port(), unused_port()
    if backend_port == frontend_port:
        raise RuntimeError("Retry the package check with distinct local ports.")
    processes = []
    with tempfile.TemporaryDirectory(prefix="smoke-", dir=release.parent) as temp:
        env = dict(os.environ, NODE_ENV="production", NEXT_TELEMETRY_DISABLED="1")
        for key in ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN"]:
            env.pop(key, None)
        try:
            processes.append(subprocess.Popen([node, "--import", "tsx", "src/server.ts"], cwd=release / "backend",
                env=dict(env, PORT=str(backend_port), FRONTEND_ORIGIN="https://talkmato.azther0z.online", DATABASE_PATH=str(Path(temp) / "synthetic.sqlite")),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            processes.append(subprocess.Popen([node, "server.js"], cwd=release / "frontend",
                env=dict(env, PORT=str(frontend_port), HOSTNAME="127.0.0.1"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            for attempt in range(300):
                if any(p.poll() is not None for p in processes):
                    raise RuntimeError("An extracted package process exited during startup.")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{backend_port}/health", timeout=1) as response:
                        assert b'"ok":true' in response.read()
                    with urllib.request.urlopen(f"http://127.0.0.1:{frontend_port}/", timeout=1) as response:
                        assert b"Talkmato" in response.read()
                    break
                except (OSError, AssertionError):
                    time.sleep(0.1)
            else:
                raise RuntimeError("Extracted package HTTP readiness failed.")
            script = """
import { io } from './backend/node_modules/socket.io-client/build/esm/index.js';
const port = process.env.PACKAGE_BACKEND_PORT;
await new Promise((resolve, reject) => {
 const socket = io(`http://127.0.0.1:${port}`, {autoConnect:false, transports:['websocket'], reconnection:false,
   extraHeaders:{Origin:'https://talkmato.azther0z.online'}});
 const timer = setTimeout(() => { socket.disconnect(); reject(Error('timeout')); }, 5000);
 socket.on('auth.session', data => { clearTimeout(timer); socket.disconnect();
   if (data.snapshot) reject(Error('unexpected authenticated session')); else resolve(); });
 socket.on('connect_error', reject); socket.connect();
});
"""
            subprocess.run([node, "--input-type=module", "--eval", script], cwd=release,
                           env=dict(env, PACKAGE_BACKEND_PORT=str(backend_port)), check=True, timeout=10)
        finally:
            for process in processes:
                process.terminate()
            for process in processes:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    print("Extracted release HTTP, native backend, and WebSocket checks passed. No external services were used.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("release", type=Path)
    args = parser.parse_args()
    check(args.release.resolve())
