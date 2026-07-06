from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


DEFAULT_CONFIG_PATH = "config/data-sources.example.yaml"


@dataclass(frozen=True)
class StorageConfig:
    engine: str
    database: Path
    raw_dir: Path
    processed_dir: Path
    frontend_export_dir: Path


@dataclass(frozen=True)
class AppConfig:
    project: str
    timezone: str
    storage: StorageConfig
    raw: dict[str, Any]


def load_config(config_path: str | Path | None = None) -> AppConfig:
    """Load YAML config and normalize important paths."""
    resolved_path = Path(
        config_path or os.getenv("JIJIN_SHOW_CONFIG") or DEFAULT_CONFIG_PATH
    )

    if not resolved_path.exists():
        raise FileNotFoundError(f"Config file not found: {resolved_path}")

    with resolved_path.open("r", encoding="utf-8") as file:
        raw = yaml.safe_load(file) or {}

    storage_raw = raw.get("storage", {})
    storage = StorageConfig(
        engine=str(storage_raw.get("engine", "duckdb")),
        database=Path(storage_raw.get("database", "data/local/jijin_show.duckdb")),
        raw_dir=Path(storage_raw.get("raw_dir", "data/raw")),
        processed_dir=Path(storage_raw.get("processed_dir", "data/processed")),
        frontend_export_dir=Path(storage_raw.get("frontend_export_dir", "public/data")),
    )

    return AppConfig(
        project=str(raw.get("project", "jijin-show")),
        timezone=str(raw.get("timezone", "Asia/Shanghai")),
        storage=storage,
        raw=raw,
    )
