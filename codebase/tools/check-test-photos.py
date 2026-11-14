"""Verify the approved photographic corpus without running dependency setup."""
from lib.test_photos import photo_root, verify_photos


if __name__ == "__main__":
    problems = verify_photos()
    if problems:
        print("\n".join(problems))
        raise SystemExit(1)
    print(f"Test photos match the manifest: {photo_root()}")
