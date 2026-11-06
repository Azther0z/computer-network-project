#!/usr/bin/env python3
"""Run a pinned actionlint binary without installing system packages."""
import hashlib
import io
import os
from pathlib import Path
import subprocess
import tarfile
import urllib.request

root = Path(__file__).resolve().parents[1]
override = os.environ.get("ACTIONLINT_BINARY")
if override:
    binary = Path(override)
else:
    output = Path(os.environ.get("RUNNER_TEMP", root / "work/cicd"))
    output.mkdir(parents=True, exist_ok=True)
    url = "https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz"
    with urllib.request.urlopen(url, timeout=30) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8":
        raise SystemExit("actionlint download checksum mismatch.")
    with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
        binary = output / "actionlint"
        binary.write_bytes(tf.extractfile("actionlint").read())
        binary.chmod(0o700)
raise SystemExit(subprocess.call([str(binary), "-color"], cwd=root))
