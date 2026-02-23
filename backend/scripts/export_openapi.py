from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
os.environ["DEBUG"] = "0"

from app.main import app


def main() -> int:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    schema = app.openapi()
    out_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    print(f"Wrote OpenAPI schema to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
