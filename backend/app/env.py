from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = BACKEND_DIR / ".env"


def _decode_value(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]
    return value


def load_env_file(path: Path = DEFAULT_ENV_FILE) -> dict[str, str]:
    """Load simple KEY=VALUE entries without overriding process variables."""
    loaded: dict[str, str] = {}
    if not path.exists():
        return loaded

    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return loaded

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue

        key, raw_value = line.split("=", 1)
        key = key.strip()
        if not key or key[0].isdigit() or not key.replace("_", "").isalnum():
            continue

        value = _decode_value(raw_value)
        if key not in os.environ:
            os.environ[key] = value
            loaded[key] = value

    return loaded
