"""Isolated entry point for the normal harness on untrusted photographic data."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from tools.denoise_eval.run import main


if __name__ == '__main__':
    main()
