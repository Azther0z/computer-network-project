#!/usr/bin/env python3
"""Validate archive paths, source identity, and every file before activating a release."""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path, PurePosixPath
import re
import tarfile


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract(archive, expected_digest, commit, destination):
    if not re.fullmatch(r"[0-9a-f]{64}", expected_digest) or digest(archive) != expected_digest:
        raise ValueError("Release checksum mismatch.")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Invalid release commit.")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Release destination already exists.")
    with tarfile.open(archive) as tf:
        members = tf.getmembers()
        names = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.name in names:
                raise ValueError("Unsafe or duplicate archive path.")
            names.add(member.name)
            if not (member.isfile() or member.isdir() or member.issym()):
                raise ValueError("Unexpected archive entry type.")
            if member.issym():
                target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
                if member.linkname.startswith("/") or target == ".." or target.startswith("../"):
                    raise ValueError("Archive symlink escapes its root.")
        manifest_file = tf.extractfile("release.json")
        manifest = json.load(manifest_file)
        if manifest.get("commit") != commit or manifest.get("node") != "24.19.0":
            raise ValueError("Release identity mismatch.")
        destination.mkdir(parents=True, mode=0o755)
        tf.extractall(destination, filter="data")
    actual_files, actual_links = set(), set()
    for path in destination.rglob("*"):
        relative = path.relative_to(destination).as_posix()
        if path.is_symlink():
            actual_links.add(relative)
            if not path.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Extracted symlink escapes its root.")
            if path.readlink().as_posix() != manifest.get("symlinks", {}).get(relative):
                raise ValueError("Release symlink mismatch.")
        elif path.is_file() and relative != "release.json":
            actual_files.add(relative)
            if digest(path) != manifest.get("files", {}).get(relative):
                raise ValueError("Release file checksum mismatch.")
    if actual_files != set(manifest.get("files", {})) or actual_links != set(manifest.get("symlinks", {})):
        raise ValueError("Release inventory mismatch.")
    return manifest


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("archive", type=Path)
    p.add_argument("sha256")
    p.add_argument("commit")
    p.add_argument("destination", type=Path)
    a = p.parse_args()
    try:
        manifest = extract(a.archive, a.sha256, a.commit, a.destination)
    except (ValueError, KeyError, TypeError, tarfile.TarError, OSError):
        raise SystemExit("Release verification failed. Nothing was activated.")
    print(f"Verified release {manifest['commit']}.")
