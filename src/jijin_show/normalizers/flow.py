from __future__ import annotations

from datetime import datetime

import pandas as pd

from jijin_show.normalizers.common import (
    add_runtime_columns,
    drop_empty_rows,
    ensure_columns,
    pick_column,
    to_numeric,
    today_from,
)


SECTOR_FLOW_RANK_COLUMNS = [
    "trade_date",
    "snapshot_time",
    "sector_type",
    "period",
    "rank",
    "sector_name",
    "pct_change",
    "main_net_inflow",
    "main_net_inflow_ratio",
    "super_large_net_inflow",
    "super_large_net_inflow_ratio",
    "large_net_inflow",
    "large_net_inflow_ratio",
    "medium_net_inflow",
    "medium_net_inflow_ratio",
    "small_net_inflow",
    "small_net_inflow_ratio",
    "source",
    "fetched_at",
]

STOCK_FLOW_RANK_COLUMNS = [
    "trade_date",
    "snapshot_time",
    "period",
    "rank",
    "stock_code",
    "stock_name",
    "last_price",
    "pct_change",
    "main_net_inflow",
    "main_net_inflow_ratio",
    "super_large_net_inflow",
    "super_large_net_inflow_ratio",
    "large_net_inflow",
    "large_net_inflow_ratio",
    "medium_net_inflow",
    "medium_net_inflow_ratio",
    "small_net_inflow",
    "small_net_inflow_ratio",
    "source",
    "fetched_at",
]


def normalize_sector_flow_rank(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=SECTOR_FLOW_RANK_COLUMNS)

    df = pd.DataFrame(
        {
            "trade_date": today_from(fetched_at),
            "snapshot_time": fetched_at.isoformat(),
            "sector_type": pick_column(raw, ["_sector_type", "sector_type"]),
            "period": pick_column(raw, ["_period", "period"]),
            "rank": to_numeric(pick_column(raw, ["序号", "排名", "rank"])),
            "sector_name": pick_column(raw, ["名称", "板块名称", "行业", "概念", "sector_name"]),
            "pct_change": to_numeric(pick_column(raw, ["今日涨跌幅", "涨跌幅", "pct_change"])),
            "main_net_inflow": to_numeric(pick_column(raw, ["主力净流入-净额", "主力净流入净额", "main_net_inflow"])),
            "main_net_inflow_ratio": to_numeric(pick_column(raw, ["主力净流入-净占比", "主力净流入净占比", "main_net_inflow_ratio"])),
            "super_large_net_inflow": to_numeric(pick_column(raw, ["超大单净流入-净额", "超大单净流入净额", "super_large_net_inflow"])),
            "super_large_net_inflow_ratio": to_numeric(pick_column(raw, ["超大单净流入-净占比", "超大单净流入净占比", "super_large_net_inflow_ratio"])),
            "large_net_inflow": to_numeric(pick_column(raw, ["大单净流入-净额", "大单净流入净额", "large_net_inflow"])),
            "large_net_inflow_ratio": to_numeric(pick_column(raw, ["大单净流入-净占比", "大单净流入净占比", "large_net_inflow_ratio"])),
            "medium_net_inflow": to_numeric(pick_column(raw, ["中单净流入-净额", "中单净流入净额", "medium_net_inflow"])),
            "medium_net_inflow_ratio": to_numeric(pick_column(raw, ["中单净流入-净占比", "中单净流入净占比", "medium_net_inflow_ratio"])),
            "small_net_inflow": to_numeric(pick_column(raw, ["小单净流入-净额", "小单净流入净额", "small_net_inflow"])),
            "small_net_inflow_ratio": to_numeric(pick_column(raw, ["小单净流入-净占比", "小单净流入净占比", "small_net_inflow_ratio"])),
        }
    )
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "sector_name")
    return ensure_columns(df, SECTOR_FLOW_RANK_COLUMNS)


def normalize_stock_flow_rank(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=STOCK_FLOW_RANK_COLUMNS)

    df = pd.DataFrame(
        {
            "trade_date": today_from(fetched_at),
            "snapshot_time": fetched_at.isoformat(),
            "period": pick_column(raw, ["_period", "period"]),
            "rank": to_numeric(pick_column(raw, ["序号", "排名", "rank"])),
            "stock_code": pick_column(raw, ["代码", "股票代码", "stock_code"]),
            "stock_name": pick_column(raw, ["名称", "股票简称", "股票名称", "stock_name"]),
            "last_price": to_numeric(pick_column(raw, ["最新价", "last_price"])),
            "pct_change": to_numeric(pick_column(raw, ["今日涨跌幅", "涨跌幅", "pct_change"])),
            "main_net_inflow": to_numeric(pick_column(raw, ["主力净流入-净额", "主力净流入净额", "main_net_inflow"])),
            "main_net_inflow_ratio": to_numeric(pick_column(raw, ["主力净流入-净占比", "主力净流入净占比", "main_net_inflow_ratio"])),
            "super_large_net_inflow": to_numeric(pick_column(raw, ["超大单净流入-净额", "超大单净流入净额", "super_large_net_inflow"])),
            "super_large_net_inflow_ratio": to_numeric(pick_column(raw, ["超大单净流入-净占比", "超大单净流入净占比", "super_large_net_inflow_ratio"])),
            "large_net_inflow": to_numeric(pick_column(raw, ["大单净流入-净额", "大单净流入净额", "large_net_inflow"])),
            "large_net_inflow_ratio": to_numeric(pick_column(raw, ["大单净流入-净占比", "大单净流入净占比", "large_net_inflow_ratio"])),
            "medium_net_inflow": to_numeric(pick_column(raw, ["中单净流入-净额", "中单净流入净额", "medium_net_inflow"])),
            "medium_net_inflow_ratio": to_numeric(pick_column(raw, ["中单净流入-净占比", "中单净流入净占比", "medium_net_inflow_ratio"])),
            "small_net_inflow": to_numeric(pick_column(raw, ["小单净流入-净额", "小单净流入净额", "small_net_inflow"])),
            "small_net_inflow_ratio": to_numeric(pick_column(raw, ["小单净流入-净占比", "小单净流入净占比", "small_net_inflow_ratio"])),
        }
    )
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "stock_code")
    return ensure_columns(df, STOCK_FLOW_RANK_COLUMNS)
