from __future__ import annotations

from datetime import date, datetime
from typing import Any

import pandas as pd


def pick_column(df: pd.DataFrame, candidates: list[str], default: Any = None) -> pd.Series:
    """Return the first existing column from candidates, otherwise a default series."""
    for column in candidates:
        if column in df.columns:
            return df[column]
    return pd.Series([default] * len(df), index=df.index)


def to_numeric(series: pd.Series) -> pd.Series:
    """Convert percent / amount-like strings to numeric values."""
    if series.empty:
        return series
    cleaned = (
        series.astype(str)
        .str.replace("%", "", regex=False)
        .str.replace(",", "", regex=False)
        .str.replace("--", "", regex=False)
        .str.strip()
    )
    return pd.to_numeric(cleaned, errors="coerce")


def to_datetime_series(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce")


def today_from(fetched_at: datetime) -> date:
    return fetched_at.date()


def add_runtime_columns(
    df: pd.DataFrame,
    *,
    source: str,
    fetched_at: datetime,
) -> pd.DataFrame:
    result = df.copy()
    result["source"] = source
    result["fetched_at"] = fetched_at.isoformat()
    return result


def ensure_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    result = df.copy()
    for column in columns:
        if column not in result.columns:
            result[column] = None
    return result[columns]


def drop_empty_rows(df: pd.DataFrame, required_column: str) -> pd.DataFrame:
    if required_column not in df.columns:
        return df
    return df[df[required_column].notna() & (df[required_column].astype(str).str.len() > 0)]
