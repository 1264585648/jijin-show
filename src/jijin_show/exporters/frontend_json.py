from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

from jijin_show.models import Dataset


def export_dataset_json(dataset: Dataset, output_dir: str | Path) -> Path:
    """Export normalized dataset to frontend-friendly JSON."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{dataset.name}.json"

    payload = {
        "name": dataset.name,
        "source": dataset.source,
        "fetched_at": dataset.fetched_at.isoformat(),
        "status": dataset.status,
        "rows": dataset.rows,
        "data": _records(dataset.data),
    }

    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    return output_path


def export_market_overview_json(
    sector_flow: Dataset,
    stock_flow: Dataset | None,
    output_dir: str | Path,
) -> Path:
    """Create a compact market overview JSON for the first dashboard."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "market-overview.json"

    sector_data = sector_flow.data.copy()
    top_sectors = _top_records(
        sector_data,
        sort_by="main_net_inflow",
        limit=20,
        filters={"period": "今日"},
    )

    top_concepts = _top_records(
        sector_data,
        sort_by="main_net_inflow",
        limit=20,
        filters={"period": "今日", "sector_type": "概念资金流"},
    )

    stock_data = stock_flow.data.copy() if stock_flow is not None else pd.DataFrame()
    top_stocks = _top_records(
        stock_data,
        sort_by="main_net_inflow",
        limit=20,
        filters={"period": "今日"},
    )

    payload = {
        "name": "market-overview",
        "source": ",".join(filter(None, [sector_flow.source, stock_flow.source if stock_flow else None])),
        "fetched_at": sector_flow.fetched_at.isoformat(),
        "status": "fresh" if sector_flow.status == "fresh" else sector_flow.status,
        "sections": {
            "top_sectors": top_sectors,
            "top_concepts": top_concepts,
            "top_stocks": top_stocks,
        },
    }

    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, default=_json_default),
        encoding="utf-8",
    )
    return output_path


def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty:
        return []
    return df.where(pd.notna(df), None).to_dict(orient="records")


def _top_records(
    df: pd.DataFrame,
    *,
    sort_by: str,
    limit: int,
    filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    if df.empty or sort_by not in df.columns:
        return []

    result = df.copy()
    for column, value in (filters or {}).items():
        if column in result.columns:
            result = result[result[column] == value]

    result = result.sort_values(sort_by, ascending=False, na_position="last").head(limit)
    return _records(result)


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    return str(value)
