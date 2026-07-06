from __future__ import annotations

from datetime import datetime

import pandas as pd

from jijin_show.normalizers.common import (
    add_runtime_columns,
    drop_empty_rows,
    ensure_columns,
    pick_column,
    to_datetime_series,
    to_numeric,
    today_from,
)


FUND_MASTER_COLUMNS = [
    "fund_code",
    "fund_name",
    "fund_type",
    "pinyin_abbr",
    "pinyin_full",
    "source",
    "fetched_at",
]

FUND_INDEX_MASTER_COLUMNS = [
    "fund_code",
    "fund_name",
    "track_index",
    "track_method",
    "index_category",
    "index_indicator",
    "nav",
    "nav_date",
    "return_1w",
    "return_1m",
    "return_3m",
    "return_ytd",
    "fee",
    "source",
    "fetched_at",
]

FUND_NAV_DAILY_COLUMNS = [
    "trade_date",
    "fund_code",
    "fund_name",
    "unit_nav",
    "accumulated_nav",
    "prev_unit_nav",
    "daily_change",
    "daily_return",
    "subscribe_status",
    "redeem_status",
    "fee",
    "source",
    "fetched_at",
]

ETF_MARKET_DAILY_COLUMNS = [
    "trade_date",
    "fund_code",
    "fund_name",
    "unit_nav",
    "accumulated_nav",
    "growth_value",
    "growth_rate",
    "market_price",
    "discount_rate",
    "source",
    "fetched_at",
]


def normalize_fund_master(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=FUND_MASTER_COLUMNS)

    df = pd.DataFrame(
        {
            "fund_code": pick_column(raw, ["基金代码", "代码", "fund_code"]),
            "fund_name": pick_column(raw, ["基金简称", "基金名称", "简称", "fund_name"]),
            "fund_type": pick_column(raw, ["基金类型", "类型", "fund_type"]),
            "pinyin_abbr": pick_column(raw, ["拼音缩写", "pinyin_abbr"]),
            "pinyin_full": pick_column(raw, ["拼音全称", "pinyin_full"]),
        }
    )
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "fund_code")
    df = df.drop_duplicates(subset=["fund_code"], keep="last")
    return ensure_columns(df, FUND_MASTER_COLUMNS)


def normalize_fund_index_master(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=FUND_INDEX_MASTER_COLUMNS)

    df = pd.DataFrame(
        {
            "fund_code": pick_column(raw, ["基金代码", "代码", "fund_code"]),
            "fund_name": pick_column(raw, ["基金简称", "基金名称", "简称", "fund_name"]),
            "track_index": pick_column(raw, ["跟踪标的", "跟踪指数", "track_index"]),
            "track_method": pick_column(raw, ["跟踪方式", "类型", "track_method"]),
            "index_category": pick_column(raw, ["_index_category"], default=None),
            "index_indicator": pick_column(raw, ["_index_indicator"], default=None),
            "nav": to_numeric(pick_column(raw, ["单位净值", "最新净值", "nav"])),
            "nav_date": to_datetime_series(pick_column(raw, ["日期", "净值日期", "nav_date"])),
            "return_1w": to_numeric(pick_column(raw, ["近1周", "近一周", "return_1w"])),
            "return_1m": to_numeric(pick_column(raw, ["近1月", "近一月", "return_1m"])),
            "return_3m": to_numeric(pick_column(raw, ["近3月", "近三月", "return_3m"])),
            "return_ytd": to_numeric(pick_column(raw, ["今年来", "return_ytd"])),
            "fee": pick_column(raw, ["手续费", "费率", "fee"]),
        }
    )
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "fund_code")
    df = df.drop_duplicates(subset=["fund_code", "index_category", "index_indicator"], keep="last")
    return ensure_columns(df, FUND_INDEX_MASTER_COLUMNS)


def normalize_fund_nav_daily(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=FUND_NAV_DAILY_COLUMNS)

    df = pd.DataFrame(
        {
            "trade_date": pick_column(raw, ["净值日期", "日期", "trade_date"], default=today_from(fetched_at)),
            "fund_code": pick_column(raw, ["基金代码", "代码", "fund_code"]),
            "fund_name": pick_column(raw, ["基金简称", "基金名称", "简称", "fund_name"]),
            "unit_nav": to_numeric(pick_column(raw, ["单位净值", "unit_nav"])),
            "accumulated_nav": to_numeric(pick_column(raw, ["累计净值", "accumulated_nav"])),
            "prev_unit_nav": to_numeric(pick_column(raw, ["前交易日-单位净值", "前单位净值", "prev_unit_nav"])),
            "daily_change": to_numeric(pick_column(raw, ["日增长值", "daily_change"])),
            "daily_return": to_numeric(pick_column(raw, ["日增长率", "daily_return"])),
            "subscribe_status": pick_column(raw, ["申购状态", "subscribe_status"]),
            "redeem_status": pick_column(raw, ["赎回状态", "redeem_status"]),
            "fee": pick_column(raw, ["手续费", "fee"]),
        }
    )
    df["trade_date"] = to_datetime_series(df["trade_date"]).dt.date
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "fund_code")
    return ensure_columns(df, FUND_NAV_DAILY_COLUMNS)


def normalize_etf_market_daily(raw: pd.DataFrame, *, fetched_at: datetime) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame(columns=ETF_MARKET_DAILY_COLUMNS)

    df = pd.DataFrame(
        {
            "trade_date": pick_column(raw, ["净值日期", "日期", "trade_date"], default=today_from(fetched_at)),
            "fund_code": pick_column(raw, ["基金代码", "代码", "fund_code"]),
            "fund_name": pick_column(raw, ["基金简称", "基金名称", "简称", "fund_name"]),
            "unit_nav": to_numeric(pick_column(raw, ["单位净值", "unit_nav"])),
            "accumulated_nav": to_numeric(pick_column(raw, ["累计净值", "accumulated_nav"])),
            "growth_value": to_numeric(pick_column(raw, ["增长值", "日增长值", "growth_value"])),
            "growth_rate": to_numeric(pick_column(raw, ["增长率", "日增长率", "growth_rate"])),
            "market_price": to_numeric(pick_column(raw, ["市价", "market_price"])),
            "discount_rate": to_numeric(pick_column(raw, ["折价率", "discount_rate"])),
        }
    )
    df["trade_date"] = to_datetime_series(df["trade_date"]).dt.date
    df = add_runtime_columns(df, source="akshare", fetched_at=fetched_at)
    df = drop_empty_rows(df, "fund_code")
    return ensure_columns(df, ETF_MARKET_DAILY_COLUMNS)
