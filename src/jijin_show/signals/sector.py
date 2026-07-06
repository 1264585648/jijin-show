from __future__ import annotations

import pandas as pd


HEAT_SCORE_COLUMNS = [
    "trade_date",
    "sector_type",
    "period",
    "sector_name",
    "pct_change",
    "main_net_inflow",
    "main_net_inflow_ratio",
    "super_large_net_inflow",
    "sector_heat_score",
    "flow_label",
]


def compute_sector_heat_score(sector_flow_rank: pd.DataFrame) -> pd.DataFrame:
    """Compute a lightweight sector heat score for dashboard sorting.

    The score is intentionally simple for MVP usage. It can be replaced later by
    a more robust model that includes turnover, historical percentile and ETF liquidity.
    """
    if sector_flow_rank is None or sector_flow_rank.empty:
        return pd.DataFrame(columns=HEAT_SCORE_COLUMNS)

    df = sector_flow_rank.copy()
    for column in [
        "main_net_inflow",
        "main_net_inflow_ratio",
        "super_large_net_inflow",
        "pct_change",
    ]:
        if column not in df.columns:
            df[column] = 0
        df[column] = pd.to_numeric(df[column], errors="coerce").fillna(0)

    df["sector_heat_score"] = (
        _zscore(df["main_net_inflow"]) * 0.4
        + _zscore(df["main_net_inflow_ratio"]) * 0.25
        + _zscore(df["super_large_net_inflow"]) * 0.25
        + _zscore(df["pct_change"]) * 0.10
    )
    df["flow_label"] = df.apply(_flow_label, axis=1)

    for column in HEAT_SCORE_COLUMNS:
        if column not in df.columns:
            df[column] = None

    return df[HEAT_SCORE_COLUMNS].sort_values(
        "sector_heat_score",
        ascending=False,
        na_position="last",
    )


def _zscore(series: pd.Series) -> pd.Series:
    std = series.std()
    if not std or pd.isna(std):
        return pd.Series([0] * len(series), index=series.index)
    return (series - series.mean()) / std


def _flow_label(row: pd.Series) -> str:
    main = row.get("main_net_inflow", 0) or 0
    pct = row.get("pct_change", 0) or 0
    super_large = row.get("super_large_net_inflow", 0) or 0

    if main > 0 and super_large > 0 and pct > 0:
        return "主力共振"
    if main > 0 and pct < 0:
        return "下跌承接"
    if main < 0 and pct > 0:
        return "上涨流出"
    if main < 0 and pct < 0:
        return "资金退潮"
    return "中性"
