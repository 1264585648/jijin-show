from __future__ import annotations

import math
import os
import time
from typing import Any, Callable, Literal

import akshare as ak
import pandas as pd
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

SectorType = Literal["industry", "concept"]
Period = Literal["today", "5d", "10d"]

APP_VERSION = "0.3.0"
SOURCE_NAME = "AKShare / 东方财富"
CACHE_TTL_SECONDS = int(os.getenv("JIJIN_CACHE_TTL", "30"))
CACHE_MAXSIZE = int(os.getenv("JIJIN_CACHE_MAXSIZE", "256"))


def get_cors_origins() -> list[str]:
    raw = os.getenv("JIJIN_CORS_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    return [item.strip() for item in raw.split(",") if item.strip()]


app = FastAPI(
    title="Jijin Show Sector API",
    description="板块实时热力图后端适配器：AKShare -> 前端统一 JSON。",
    version=APP_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

CACHE = TTLCache(maxsize=CACHE_MAXSIZE, ttl=CACHE_TTL_SECONDS)

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


class UpstreamDataError(RuntimeError):
    """上游公开数据源不可用或字段结构异常。"""


def now_ts() -> int:
    return int(time.time())


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_number_text(value: str) -> str:
    return (
        value.replace(",", "")
        .replace("%", "")
        .replace("亿元", "亿")
        .replace("万元", "万")
        .replace("人民币", "")
        .replace(" ", "")
        .strip()
    )


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, str):
        value = normalize_number_text(value)
        for unit in ("亿", "万", "元", "股", "手"):
            value = value.replace(unit, "")
        if not value or value in {"-", "--", "nan", "None", "null"}:
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
    """把金额统一转为「亿元」。

    AKShare 的字段有时是元，有时字符串自带「亿/万」，也有字段已是亿元。
    这里做温和推断：绝对值大于 100 万时按元处理，否则认为已是亿元。
    """
    if value is None:
        return 0.0

    if isinstance(value, str):
        text = normalize_number_text(value)
        number = safe_float(text)
        if "亿" in text:
            return round(number, 2)
        if "万" in text:
            return round(number / 10_000, 2)
        if "元" in text:
            return round(number / 100_000_000, 2)
        if abs(number) > 1_000_000:
            return round(number / 100_000_000, 2)
        return round(number, 2)

    number = safe_float(value)
    if abs(number) > 1_000_000:
        return round(number / 100_000_000, 2)
    return round(number, 2)


def market_cap_to_yi(value: Any) -> float:
    return money_to_yi(value)


def pick_column(row: pd.Series, include: list[str], exclude: list[str] | None = None) -> Any:
    exclude = exclude or []
    for column in row.index:
        name = str(column)
        if all(key in name for key in include) and not any(key in name for key in exclude):
            return row[column]
    return None


def pick_first(row: pd.Series, names: list[str], default: Any = None) -> Any:
    for name in names:
        if name in row.index:
            return row.get(name)
    return default


def call_loader(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    df = loader()
    if not isinstance(df, pd.DataFrame):
        raise UpstreamDataError(f"{cache_key} 返回值不是 DataFrame")
    if df.empty:
        raise UpstreamDataError(f"{cache_key} 返回空数据")
    return df


def cached_dataframe(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    cached = CACHE.get(cache_key)
    if cached is not None:
        return cached.copy()
    df = call_loader(cache_key, loader)
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


def get_sector_name(row: pd.Series) -> str:
    return clean_text(pick_first(row, ["板块名称", "名称"]))


def get_sector_code(row: pd.Series) -> str:
    return clean_text(pick_first(row, ["板块代码", "代码"]))


def build_fund_flow_map(flow_df: pd.DataFrame) -> dict[str, pd.Series]:
    result: dict[str, pd.Series] = {}
    for _, row in flow_df.iterrows():
        name = clean_text(pick_first(row, ["名称", "板块名称"]))
        if name:
            result[name] = row
    return result


def resolve_sector_symbol(sector_type: SectorType, sector_code_or_name: str) -> tuple[str, str]:
    """把前端传入的 BK 代码解析成 AKShare 成份股接口需要的板块名称。"""
    target = clean_text(sector_code_or_name)
    if not target:
        raise HTTPException(status_code=400, detail="sector_code 不能为空")

    board_df = get_board_df(sector_type)
    for _, row in board_df.iterrows():
        code = get_sector_code(row)
        name = get_sector_name(row)
        if target in {code, name}:
            return name or target, code or target

    # AKShare 的 cons 接口通常使用板块名称；如果没有匹配到，继续用原值尝试。
    return target, target


def normalize_sector(row: pd.Series, flow_row: pd.Series | None, sector_type: SectorType) -> dict[str, Any]:
    name = get_sector_name(row)
    board_code = get_sector_code(row)

    main_net_in = 0.0
    main_net_in_ratio = 0.0
    super_large_net_in = 0.0
    big_net_in = 0.0
    top_fund_flow_stock = clean_text(pick_first(row, ["领涨股票"]))

    if flow_row is not None:
        main_net_in = money_to_yi(pick_column(flow_row, ["主力净流入", "净额"]))
        main_net_in_ratio = round(safe_float(pick_column(flow_row, ["主力净流入", "净占比"])), 2)
        super_large_net_in = money_to_yi(pick_column(flow_row, ["超大单", "净额"]))
        big_net_in = money_to_yi(pick_column(flow_row, ["大单", "净额"], exclude=["超大单"]))
        top_fund_flow_stock = clean_text(pick_column(flow_row, ["主力净流入最大股"]) or top_fund_flow_stock)

    return {
        "id": board_code or name,
        "name": name,
        "type": sector_type,
        "category": "行业" if sector_type == "industry" else "概念",
        "changePct": round(safe_float(pick_first(row, ["涨跌幅", "涨幅"])), 2),
        "turnoverRate": round(safe_float(pick_first(row, ["换手率"])), 2),
        "marketCap": market_cap_to_yi(pick_first(row, ["总市值", "流通市值"])),
        "amount": money_to_yi(pick_first(row, ["成交额", "成交金额"], 0)),
        "mainNetIn": main_net_in,
        "mainNetInRatio": main_net_in_ratio,
        "superLargeNetIn": super_large_net_in,
        "bigNetIn": big_net_in,
        "upCount": safe_int(pick_first(row, ["上涨家数"])),
        "downCount": safe_int(pick_first(row, ["下跌家数"])),
        "leadingStock": clean_text(pick_first(row, ["领涨股票"])),
        "leadingStockChangePct": round(safe_float(pick_first(row, ["领涨股票-涨跌幅", "领涨股涨跌幅"])), 2),
        "topFundFlowStock": top_fund_flow_stock,
        "relatedEtfs": [],
    }


def normalize_stock(row: pd.Series) -> dict[str, Any]:
    return {
        "code": clean_text(pick_first(row, ["代码", "股票代码"])),
        "name": clean_text(pick_first(row, ["名称", "股票名称"])),
        "price": round(safe_float(pick_first(row, ["最新价", "收盘价"])), 2),
        "changePct": round(safe_float(pick_first(row, ["涨跌幅", "涨幅"])), 2),
        "amount": money_to_yi(pick_first(row, ["成交额", "成交金额"], 0)),
        "turnoverRate": round(safe_float(pick_first(row, ["换手率"])), 2),
        "fundNetIn": money_to_yi(pick_first(row, ["主力净流入", "资金净流入"], 0)),
        "role": "成份股",
    }


def normalize_etf(row: pd.Series) -> dict[str, Any]:
    return {
        "code": clean_text(pick_first(row, ["代码", "基金代码"])),
        "name": clean_text(pick_first(row, ["名称", "基金简称", "基金名称"])),
        "price": round(safe_float(pick_first(row, ["最新价", "单位净值"])), 4),
        "changePct": round(safe_float(pick_first(row, ["涨跌幅", "涨幅"])), 2),
        "amount": money_to_yi(pick_first(row, ["成交额", "成交金额"], 0)),
        "volume": safe_float(pick_first(row, ["成交量"], 0)),
        "premiumRate": round(safe_float(pick_first(row, ["溢价率", "折价率", "溢折率"], 0)), 2),
        "updatedAt": now_ts(),
    }


def parse_codes(codes: str) -> set[str]:
    return {item.strip() for item in codes.split(",") if item.strip()}


def upstream_error(message: str, exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail={
            "message": message,
            "error": str(exc),
            "source": SOURCE_NAME,
            "updatedAt": now_ts(),
        },
    )


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "jijin-show-sector-api",
        "version": APP_VERSION,
        "source": SOURCE_NAME,
        "cache": {
            "size": len(CACHE),
            "maxSize": CACHE_MAXSIZE,
            "ttlSeconds": CACHE_TTL_SECONDS,
            "keys": list(CACHE.keys()),
        },
        "timestamp": now_ts(),
    }


@app.get("/api/sector/heatmap")
def sector_heatmap(
    type: SectorType = Query("industry", description="industry 或 concept"),
    period: Period = Query("today", description="today / 5d / 10d"),
    limit: int = Query(120, ge=1, le=300, description="最多返回节点数"),
) -> dict[str, Any]:
    try:
        board_df = get_board_df(type)
        fund_df = get_fund_flow_df(type, period)
    except Exception as exc:  # noqa: BLE001
        raise upstream_error("获取板块热力图数据失败", exc) from exc

    fund_map = build_fund_flow_map(fund_df)
    nodes = [
        normalize_sector(row, fund_map.get(get_sector_name(row)), type)
        for _, row in board_df.iterrows()
    ]

    nodes = [node for node in nodes if node["name"]]
    nodes.sort(key=lambda item: (item["mainNetIn"], item["changePct"]), reverse=True)

    return {
        "market": "A股",
        "type": type,
        "period": period,
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "count": min(len(nodes), limit),
        "nodes": nodes[:limit],
    }


@app.get("/api/sector/{sector_code}/stocks")
def sector_stocks(
    sector_code: str,
    type: SectorType = Query("industry", description="industry 或 concept"),
    limit: int = Query(50, ge=1, le=300, description="最多返回成份股数量"),
) -> dict[str, Any]:
    meta = SECTOR_META[type]
    try:
        sector_symbol, resolved_code = resolve_sector_symbol(type, sector_code)
        df = cached_dataframe(
            f"stocks:{type}:{sector_symbol}",
            lambda: meta["cons_func"](symbol=sector_symbol),
        )
    except Exception as exc:  # noqa: BLE001
        raise upstream_error("获取板块成份股失败", exc) from exc

    stocks = [normalize_stock(row) for _, row in df.iterrows()]
    stocks = [stock for stock in stocks if stock["name"]]
    stocks.sort(key=lambda item: (item["changePct"], item["amount"]), reverse=True)

    return {
        "sectorCode": resolved_code,
        "sectorName": sector_symbol,
        "type": type,
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "count": min(len(stocks), limit),
        "stocks": stocks[:limit],
    }


@app.get("/api/etf/quotes")
def etf_quotes(codes: str = Query("", description="ETF 代码，英文逗号分隔")) -> dict[str, Any]:
    wanted = parse_codes(codes)
    if not wanted:
        return {"source": SOURCE_NAME, "updatedAt": now_ts(), "count": 0, "quotes": []}

    try:
        df = get_etf_spot_df()
    except Exception as exc:  # noqa: BLE001
        raise upstream_error("获取 ETF 行情失败", exc) from exc

    quotes = [
        normalize_etf(row)
        for _, row in df.iterrows()
        if clean_text(pick_first(row, ["代码", "基金代码"])) in wanted
    ]

    quote_order = {code: index for index, code in enumerate(codes.split(","))}
    quotes.sort(key=lambda item: quote_order.get(item["code"], 999))

    return {
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "count": len(quotes),
        "quotes": quotes,
    }


@app.get("/api/debug/columns")
def debug_columns(
    type: SectorType = Query("industry", description="industry 或 concept"),
    period: Period = Query("today", description="today / 5d / 10d"),
) -> dict[str, Any]:
    """调试上游字段变化，方便 AKShare 字段变更后快速定位。"""
    try:
        board_df = get_board_df(type)
        fund_df = get_fund_flow_df(type, period)
        etf_df = get_etf_spot_df()
    except Exception as exc:  # noqa: BLE001
        raise upstream_error("获取调试字段失败", exc) from exc

    return {
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "boardColumns": list(map(str, board_df.columns)),
        "fundFlowColumns": list(map(str, fund_df.columns)),
        "etfColumns": list(map(str, etf_df.columns)),
    }


@app.get("/api/cache")
def cache_status() -> dict[str, Any]:
    return {
        "size": len(CACHE),
        "maxSize": CACHE_MAXSIZE,
        "ttlSeconds": CACHE_TTL_SECONDS,
        "keys": list(CACHE.keys()),
        "updatedAt": now_ts(),
    }
