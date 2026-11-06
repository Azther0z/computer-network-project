#!/usr/bin/env python3
"""Build a credential-free runtime archive from tested dependencies and Next standalone output."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inventory(root):
    files, links = {}, {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root).as_posix()
        if path.name.startswith(".env") or path.name.startswith("gha-creds-") or ".sqlite" in path.name:
            raise ValueError(f"Forbidden release input: {relative}")
        if path.is_symlink():
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError(f"Release symlink escapes its root: {relative}")
            links[relative] = os.readlink(path)
        elif path.is_file():
            files[relative] = sha256(path)
    return files, links


def build(root, output, commit):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("A full source commit SHA is required.")
    node = Path(shutil.which("node") or "")
    if not node.is_file() or subprocess.check_output([str(node), "--version"], text=True).strip() != "v24.19.0":
        raise ValueError("Build with Node 24.19.0.")
    standalone = root / "frontend/.next/standalone"
    if not (standalone / "server.js").is_file():
        raise ValueError("Build the standalone frontend before packaging.")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="stage-", dir=output) as temp:
        stage = Path(temp)
        for relative in ["backend/src", "backend/node_modules"]:
            shutil.copytree(root / relative, stage / relative, symlinks=True)
        for name in ["package.json", "package-lock.json"]:
            shutil.copy2(root / "backend" / name, stage / "backend" / name)
        shutil.copytree(standalone, stage / "frontend", symlinks=True)
        shutil.copytree(root / "frontend/public", stage / "frontend/public", dirs_exist_ok=True)
        shutil.copytree(root / "frontend/.next/static", stage / "frontend/.next/static", dirs_exist_ok=True)
        (stage / "deploy").mkdir()
        for name in ["Caddyfile", "backend.env.example", "talkmato-backend.service", "talkmato-frontend.service",
                     "install-release.sh", "verify-release.py", "smoke.mjs"]:
            shutil.copy2(root / "deploy" / name, stage / "deploy" / name)
        (stage / "runtime").mkdir()
        shutil.copy2(node, stage / "runtime/node")
        license_path = node.resolve().parent.parent / "LICENSE"
        if license_path.is_file():
            shutil.copy2(license_path, stage / "runtime/NODE-LICENSE")
        files, links = inventory(stage)
        manifest = {
            "commit": commit,
            "node": "24.19.0",
            "publicBackendUrl": "https://talkmato.azther0z.online",
            "schemaSha256": sha256(root / "backend/src/schema.sql"),
            "files": files,
            "symlinks": links,
        }
        (stage / "release.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")
        archive = output / "talkmato-release.tar.gz"

        def normalize(info):
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode &= 0o755
            return info

        with tarfile.open(archive, "w:gz") as tf:
            for path in sorted(stage.rglob("*")):
                tf.add(path, arcname=path.relative_to(stage).as_posix(), recursive=False, filter=normalize)
        digest = sha256(archive)
        (output / "talkmato-release.tar.gz.sha256").write_text(f"{digest}  {archive.name}\n")
        print(f"Packaged source {commit}: {len(files)} files, {archive.stat().st_size} bytes, SHA256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build(Path(__file__).resolve().parents[1], args.output.resolve(), args.commit)
