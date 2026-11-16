"""Offline CPU denoiser quality research; never imported by the app."""
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[2] / 'backend'
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
