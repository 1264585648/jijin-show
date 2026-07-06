from __future__ import annotations

import math
import time
from typing import Any, Callable, Literal

import akshare as ak
import pandas as pd
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

SectorType = Literal["industry", "concept"]
Period = Literal["today", "5d", "10d"]

app = FastAPI(
    title="Jijin Show Sector API",
    description="板块实时热力图后端适配器：AKShare -> 前端统一 JSON。",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

CACHE = TTLCache(maxsize=128, ttl=20)
PERIOD_MAP: dict[str, str] = {
    "today": "今日",
    "5d": "5日",
    "10d": "10日",
}

SECTOR_META: dict[str, dict[str, Any]] = {
    "industry": {
        "name_func": ak.stock_board_industry_name_em,
        "cons_func": ak.stock_board_industry_cons_em,
        "fund_type": "行业资金流",
        "display_name": "行业板块",
    },
    "concept": {
        "name_func": ak.stock_board_concept_name_em,
        "cons_func": ak.stock_board_concept_cons_em,
        "fund_type": "概念资金流",
        "display_name": "概念板块",
    },
}


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str):
        value = value.replace(",", "").replace("%", "").strip()
        if not value or value in {"-", "--", "nan", "None"}:
            return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def safe_int(value: Any, default: int = 0) -> int:
    return int(round(safe_float(value, default)))


def money_to_yi(value: Any) -> float:
    """AKShare/东方财富资金字段通常以元为单位，前端统一使用亿元。"""
    return round(safe_float(value) / 100_000_000, 2)


def market_cap_to_yi(value: Any) -> float:
    return round(safe_float(value) / 100_000_000, 2)


def pick_column(row: pd.Series, include: list[str], exclude: list[str] | None = None) -> Any:
    exclude = exclude or []
    for column in row.index:
        name = str(column)
        if all(key in name for key in include) and not any(key in name for key in exclude):
            return row[column]
    return None


def cached_dataframe(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    cached = CACHE.get(cache_key)
    if cached is not None:
        return cached.copy()
    df = loader()
    if not isinstance(df, pd.DataFrame):
        raise RuntimeError(f"AKShare 返回值不是 DataFrame: {cache_key}")
    CACHE[cache_key] = df.copy()
    return df


def get_board_df(sector_type: SectorType) -> pd.DataFrame:
    meta = SECTOR_META[sector_type]
    return cached_dataframe(f"board:{sector_type}", meta["name_func"])


def get_fund_flow_df(sector_type: SectorType, period: Period) -> pd.DataFrame:
    meta = SECTOR_META[sector_type]
    indicator = PERIOD_MAP[period]
    return cached_dataframe(
        f"fund:{sector_type}:{period}",
        lambda: ak.stock_sector_fund_flow_rank(indicator=indicator, sector_type=meta["fund_type"]),
    )


def get_etf_spot_df() -> pd.DataFrame:
    return cached_dataframe("etf:spot", ak.fund_etf_spot_em)


def build_fund_flow_map(flow_df: pd.DataFrame) -> dict[str, pd.Series]:
    result: dict[str, pd.Series] = {}
    for _, row in flow_df.iterrows():
        name = str(row.get("名称", "")).strip()
        if name:
            result[name] = row
    return result


def normalize_sector(row: pd.Series, flow_row: pd.Series | None, sector_type: SectorType) -> dict[str, Any]:
    name = str(row.get("板块名称", row.get("名称", ""))).strip()
    board_code = str(row.get("板块代码", row.get("代码", ""))).strip()

    main_net_in = 0.0
    main_net_in_ratio = 0.0
    super_large_net_in = 0.0
    big_net_in = 0.0
    top_fund_flow_stock = str(row.get("领涨股票", "")).strip()

    if flow_row is not None:
        main_net_in = money_to_yi(pick_column(flow_row, ["主力净流入", "净额"]))
        main_net_in_ratio = round(safe_float(pick_column(flow_row, ["主力净流入", "净占比"])), 2)
        super_large_net_in = money_to_yi(pick_column(flow_row, ["超大单", "净额"]))
        big_net_in = money_to_yi(pick_column(flow_row, ["大单", "净额"], exclude=["超大单"]))
        top_fund_flow_stock = str(pick_column(flow_row, ["主力净流入最大股"]) or top_fund_flow_stock).strip()

    return {
        "id": board_code or name,
        "name": name,
        "type": sector_type,
        "category": "行业" if sector_type == "industry" else "概念",
        "changePct": round(safe_float(row.get("涨跌幅")), 2),
        "turnoverRate": round(safe_float(row.get("换手率")), 2),
        "marketCap": market_cap_to_yi(row.get("总市值")),
        "amount": 0,
        "mainNetIn": main_net_in,
        "mainNetInRatio": main_net_in_ratio,
        "superLargeNetIn": super_large_net_in,
        "bigNetIn": big_net_in,
        "upCount": safe_int(row.get("上涨家数")),
        "downCount": safe_int(row.get("下跌家数")),
        "leadingStock": str(row.get("领涨股票", "")).strip(),
        "leadingStockChangePct": round(safe_float(row.get("领涨股票-涨跌幅")), 2),
        "topFundFlowStock": top_fund_flow_stock,
        "relatedEtfs": [],
    }


def normalize_etf(row: pd.Series) -> dict[str, Any]:
    return {
        "code": str(row.get("代码", "")).strip(),
        "name": str(row.get("名称", "")).strip(),
        "price": round(safe_float(row.get("最新价")), 4),
        "changePct": round(safe_float(row.get("涨跌幅")), 2),
        "amount": money_to_yi(row.get("成交额")),
        "volume": safe_float(row.get("成交量")),
        "premiumRate": round(safe_float(row.get("溢价率", row.get("折价率"))), 2),
        "updatedAt": int(time.time()),
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "jijin-show-sector-api",
        "cacheSize": len(CACHE),
        "timestamp": int(time.time()),
    }


@app.get("/api/sector/heatmap")
def sector_heatmap(
    type: SectorType = Query("industry", description="industry 或 concept"),
    period: Period = Query("today", description="today / 5d / 10d"),
) -> dict[str, Any]:
    try:
        board_df = get_board_df(type)
        fund_df = get_fund_flow_df(type, period)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"获取 AKShare 数据失败: {exc}") from exc

    fund_map = build_fund_flow_map(fund_df)
    nodes = [
        normalize_sector(row, fund_map.get(str(row.get("板块名称", "")).strip()), type)
        for _, row in board_df.iterrows()
    ]

    nodes = [node for node in nodes if node["name"]]
    nodes.sort(key=lambda item: (item["mainNetIn"], item["changePct"]), reverse=True)

    return {
        "market": "A股",
        "type": type,
        "period": period,
        "source": "AKShare / 东方财富",
        "updatedAt": int(time.time()),
        "nodes": nodes,
    }


@app.get("/api/sector/{sector_code}/stocks")
def sector_stocks(
    sector_code: str,
    type: SectorType = Query("industry", description="industry 或 concept"),
) -> dict[str, Any]:
    meta = SECTOR_META[type]
    try:
        df = cached_dataframe(f"stocks:{type}:{sector_code}", lambda: meta["cons_func"](symbol=sector_code))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"获取板块成份股失败: {exc}") from exc

    stocks: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        stocks.append(
            {
                "code": str(row.get("代码", "")).strip(),
                "name": str(row.get("名称", "")).strip(),
                "price": round(safe_float(row.get("最新价")), 2),
                "changePct": round(safe_float(row.get("涨跌幅")), 2),
                "amount": money_to_yi(row.get("成交额")),
                "turnoverRate": round(safe_float(row.get("换手率")), 2),
                "fundNetIn": 0,
                "role": "成份股",
            }
        )

    return {
        "sectorCode": sector_code,
        "type": type,
        "source": "AKShare / 东方财富",
        "updatedAt": int(time.time()),
        "stocks": stocks,
    }


@app.get("/api/etf/quotes")
def etf_quotes(codes: str = Query("", description="ETF 代码，英文逗号分隔")) -> dict[str, Any]:
    wanted = {code.strip() for code in codes.split(",") if code.strip()}
    if not wanted:
        return {"source": "AKShare / 东方财富", "updatedAt": int(time.time()), "quotes": []}

    try:
        df = get_etf_spot_df()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"获取 ETF 行情失败: {exc}") from exc

    quotes = [normalize_etf(row) for _, row in df.iterrows() if str(row.get("代码", "")).strip() in wanted]
    return {"source": "AKShare / 东方财富", "updatedAt": int(time.time()), "quotes": quotes}
