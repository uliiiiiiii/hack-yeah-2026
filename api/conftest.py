"""Ensure the api/ package modules (graph, main, profiles) are importable in tests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
