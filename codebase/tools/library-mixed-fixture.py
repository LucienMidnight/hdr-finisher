"""Frozen v1 and curated v2 Library test folders.

The folder lives outside the repository, beside the film data sheets, in
`test-fixtures/library-mixed-v2` next to the repository folder ("ai"), e.g.
    D:\\AI\\AI Projects\\HDR Finisher Tool\\test-fixtures\\library-mixed-v2
Its photos are read-only. The manifest committed beside this script
(`library-mixed-v2.manifest.json`) records every file's size and SHA-256.
The default remains the frozen v1 for ongoing before/after measurements.

    python tools/library-mixed-fixture.py build --version=v2 # copy approved sources
    python tools/library-mixed-fixture.py verify --version=v2 # full hash check
    python tools/library-mixed-fixture.py run-copy --version=v2 # reset v2 run folder

The selected run folder (`output/test-photos/library-mixed-v2-run` for v2) holds a one-time
read-only copy of the photos (D: has no hard links) plus fresh copies of the
sidecars and nothing else, so a test can never change the fixture. Sources are only read;
D:\\Photos is never written.
"""
import hashlib, json, os, shutil, stat, sys
from pathlib import Path
from lib.machine_settings import settings, photos_path

CODEBASE = Path(__file__).resolve().parents[1]
# Beside the repository folder ("ai"), on every machine.
FIXTURE = Path(settings()["testFixturesRoot"]) / "library-mixed-v1"
MANIFEST = Path(__file__).with_name("library-mixed-v1.manifest.json")
RUN = CODEBASE / "output" / "test-photos" / "library-mixed-v1-run"

VERSION = next((arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--version=')), 'v1')
if VERSION not in ('v1', 'v2'):
    sys.exit('Use --version=v1 or --version=v2')
if VERSION == 'v2':
    FIXTURE = Path(settings()["testFixturesRoot"]) / "library-mixed-v2"
    MANIFEST = Path(__file__).with_name("library-mixed-v2.manifest.json")
    RUN = CODEBASE / "output/test-photos/library-mixed-v2-run"
from lib.test_photos import manifest_files, photo_root, verify_photos
SOURCES = [(str(photo_root() / entry['name']), 'curated ' + Path(entry['name']).suffix)
           for entry in manifest_files() if not entry['name'].startswith('Projects/')]
MISSING = [".heif", ".nrw", ".ori", ".pef", ".srw"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 << 20), b""):
            h.update(block)
    return h.hexdigest()


def is_sidecar(name):
    return name.lower().endswith(".hdrf")


def build():
    if VERSION == 'v1':
        sys.exit('library-mixed-v1 is frozen for the Library speed comparison; build --version=v2 instead.')
    problems = verify_photos()
    if problems:
        sys.exit('\n'.join(problems))
    if FIXTURE.exists() and any(FIXTURE.iterdir()):
        sys.exit(f"{FIXTURE} already exists; the fixture is locked. Keep it read-only; verify instead.")
    FIXTURE.mkdir(parents=True, exist_ok=True)
    entries = []
    for source, why in SOURCES:
        src = Path(photos_path(source.replace('\\', '/')))
        dst = FIXTURE / src.name
        assert not dst.exists(), f"duplicate name {src.name}"
        shutil.copy2(src, dst)  # reads the source only
        entries.append({"name": src.name, "bytes": dst.stat().st_size, "sha256": sha256(dst),
                        "why": why, "source": "HDR Test Images/" + src.name})
        os.chmod(dst, stat.S_IREAD)
        print("copied", src.name)
    MANIFEST.write_text(json.dumps({"fixture": "library-mixed-" + VERSION, "missing_formats": MISSING,
                                    "files": entries}, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(len(entries), "files,", round(sum(e["bytes"] for e in entries) / 1e9, 2), "GB")


def load():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))["files"]


def verify(full=True):
    bad = []
    for e in load():
        p = FIXTURE / e["name"]
        if not p.exists() or p.stat().st_size != e["bytes"] or (full and sha256(p) != e["sha256"]):
            bad.append(e["name"])
    extra = sorted(set(os.listdir(FIXTURE)) - {e["name"] for e in load()})
    if bad or extra:
        sys.exit(f"fixture changed: {bad} extra: {extra}")
    print("fixture ok")


def run_copy():
    verify(full=False)
    RUN.mkdir(parents=True, exist_ok=True)
    wanted = {e["name"]: e for e in load()}
    for name in os.listdir(RUN):
        p = RUN / name
        if name not in wanted or is_sidecar(name):
            if p.is_dir():
                shutil.rmtree(p)
            else:
                os.chmod(p, stat.S_IWRITE) if is_sidecar(name) or name not in wanted else None
                p.unlink()
    for name in wanted:
        p, src = RUN / name, FIXTURE / name
        if p.exists():
            continue
        if is_sidecar(name):
            shutil.copyfile(src, p)
            os.chmod(p, stat.S_IREAD | stat.S_IWRITE)
        else:
            # Reuse originals without copying large photos into each worktree.
            if os.name != "nt":
                p.symlink_to(src)
            else:
                try:
                    os.link(src, p)
                except OSError:
                    shutil.copy2(src, p)  # exFAT has no hard links: one shared run copy.
            os.chmod(p, stat.S_IREAD)
    for name, e in wanted.items():
        if not is_sidecar(name):
            assert (RUN / name).stat().st_size == e["bytes"], f"run copy changed: {name}"
    print(RUN)


if __name__ == "__main__":
    {"build": build, "verify": verify, "run-copy": run_copy}[sys.argv[1]]()
