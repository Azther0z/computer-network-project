import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("verify_release", ROOT / "deploy/verify-release.py")
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
COMMIT = "a" * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        output = ROOT / "work/ci-tests"
        output.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=output)
        self.path = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, extra=None, bad_hash=False):
        content = b"synthetic release fixture\n"
        manifest = {"commit": COMMIT, "node": "24.19.0", "files": {"payload": "0" * 64 if bad_hash else hashlib.sha256(content).hexdigest()}, "symlinks": {}}
        archive = self.path / "release.tar.gz"
        with tarfile.open(archive, "w:gz") as tf:
            for name, value in [("payload", content), ("release.json", json.dumps(manifest).encode())]:
                item = tarfile.TarInfo(name)
                item.size = len(value)
                tf.addfile(item, io.BytesIO(value))
            if extra:
                tf.addfile(extra)
        return archive, verify.digest(archive)

    def test_verified_archive_extracts(self):
        archive, digest = self.archive()
        self.assertEqual(verify.extract(archive, digest, COMMIT, self.path / "out")["commit"], COMMIT)

    def test_digest_source_and_inventory_tampering_fail(self):
        archive, digest = self.archive()
        for expected_digest, commit in [("0" * 64, COMMIT), (digest, "b" * 40)]:
            with self.assertRaises(ValueError):
                verify.extract(archive, expected_digest, commit, self.path / "out")
        archive, digest = self.archive(bad_hash=True)
        with self.assertRaises(ValueError):
            verify.extract(archive, digest, COMMIT, self.path / "out")

    def test_path_traversal_and_escaping_symlinks_fail(self):
        for name, link in [("../outside", None), ("/absolute", None), ("escape", "../../outside")]:
            with self.subTest(name=name):
                item = tarfile.TarInfo(name)
                if link:
                    item.type, item.linkname = tarfile.SYMTYPE, link
                archive, digest = self.archive(extra=item)
                with self.assertRaises(ValueError):
                    verify.extract(archive, digest, COMMIT, self.path / "out")
                self.assertFalse((self.path.parent / "outside").exists())


if __name__ == "__main__":
    unittest.main()
