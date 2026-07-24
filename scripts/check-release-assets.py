from __future__ import annotations

import argparse
from pathlib import Path

from release_asset_lib import validate_dist

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--dist", type=Path, default=ROOT / "dist")
args = parser.parse_args()
print(validate_dist(ROOT, args.dist.resolve()))
