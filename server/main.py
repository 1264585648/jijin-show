from __future__ import annotations

import math
import os
import time
from typing import Any, Callable, Literal

import akshare as ak
import pandas as pd
import requests
from cachetools import TTLCache
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

SectorType = Literal["industry", "concept"]
Period = Literal["today", "5d", "10d"]

APP_VERSION = "0.3.0"
SOURCE_NAME = "AKShare / 东方财富"
CACHE_TTL_SECONDS = int(os.getenv("JIJIN_CACHE_TTL", "30"))
CACHE_MAXSIZE = int(os.getenv("JIJIN_CACHE_MAXSIZE", "256"))
UPSTREAM_RETRY_DELAYS = (1, 2, 4)
EASTMONEY_CLIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"
EASTMONEY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
}


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
STALE_CACHE: dict[str, pd.DataFrame] = {}
STALE_CACHE_UPDATED_AT: dict[str, int] = {}

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


def validate_dataframe(cache_key: str, df: Any) -> pd.DataFrame:
    if not isinstance(df, pd.DataFrame):
        raise UpstreamDataError(f"{cache_key} 返回值不是 DataFrame")
    if df.empty:
        raise UpstreamDataError(f"{cache_key} 返回空数据")
    return df


def call_with_retry(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    last_exc: Exception | None = None
    for attempt in range(len(UPSTREAM_RETRY_DELAYS) + 1):
        try:
            return validate_dataframe(cache_key, loader())
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt >= len(UPSTREAM_RETRY_DELAYS):
                break
            time.sleep(UPSTREAM_RETRY_DELAYS[attempt])
    raise UpstreamDataError(f"{cache_key} 上游连续失败: {last_exc}") from last_exc


def call_loader(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    df = loader()
    return validate_dataframe(cache_key, df)


def cached_dataframe(cache_key: str, loader: Callable[[], pd.DataFrame]) -> pd.DataFrame:
    cached = CACHE.get(cache_key)
    if cached is not None:
        df = cached.copy()
        df.attrs["stale"] = False
        return df

    try:
        df = call_with_retry(cache_key, loader)
    except Exception as exc:
        stale_df = STALE_CACHE.get(cache_key)
        if stale_df is None:
            raise
        df = stale_df.copy()
        df.attrs["stale"] = True
        df.attrs["error"] = "upstream failed, served stale cache"
        df.attrs["upstreamError"] = str(exc)
        df.attrs["staleUpdatedAt"] = STALE_CACHE_UPDATED_AT.get(cache_key)
        return df

    now = now_ts()
    df.attrs["stale"] = False
    CACHE[cache_key] = df.copy()
    STALE_CACHE[cache_key] = df.copy()
    STALE_CACHE_UPDATED_AT[cache_key] = now
    return df


def dataframe_warning(df: pd.DataFrame, cache_key: str) -> dict[str, Any] | None:
    if not df.attrs.get("stale"):
        return None
    return {
        "cacheKey": cache_key,
        "error": df.attrs.get("error", "upstream failed, served stale cache"),
        "upstreamError": df.attrs.get("upstreamError", ""),
        "staleUpdatedAt": df.attrs.get("staleUpdatedAt"),
    }


def response_cache_state(*items: tuple[str, pd.DataFrame]) -> dict[str, Any]:
    warnings = [
        warning
        for cache_key, df in items
        if (warning := dataframe_warning(df, cache_key)) is not None
    ]
    return {
        "stale": bool(warnings),
        "error": "upstream failed, served stale cache" if warnings else None,
        "warnings": warnings,
    }


def fetch_eastmoney_clist(cache_key: str, params: dict[str, Any]) -> pd.DataFrame:
    page_size = int(params.get("pz", 100))
    first_params = {**params, "pn": 1, "pz": page_size}
    response = requests.get(
        EASTMONEY_CLIST_URL,
        params=first_params,
        headers=EASTMONEY_HEADERS,
        timeout=20,
    )
    response.raise_for_status()
    data_json = response.json()
    data = data_json.get("data") or {}
    total = safe_int(data.get("total"))
    rows = list(data.get("diff") or [])

    if not rows:
        raise UpstreamDataError(f"{cache_key} 东方财富直连返回空数据")

    total_page = max(1, math.ceil(total / page_size))
    for page in range(2, total_page + 1):
        page_params = {**params, "pn": page, "pz": page_size}
        response = requests.get(
            EASTMONEY_CLIST_URL,
            params=page_params,
            headers=EASTMONEY_HEADERS,
            timeout=20,
        )
        response.raise_for_status()
        page_json = response.json()
        rows.extend((page_json.get("data") or {}).get("diff") or [])

    return validate_dataframe(cache_key, pd.DataFrame(rows))


def normalize_numeric_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for column in columns:
        if column in df.columns:
            df[column] = pd.to_numeric(df[column], errors="coerce")
    return df


def eastmoney_board_df(sector_type: SectorType) -> pd.DataFrame:
    if sector_type == "industry":
        params = {
            "pn": "1",
            "pz": "100",
            "po": "1",
            "np": "1",
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": "2",
            "invt": "2",
            "fid": "f3",
            "fs": "m:90 t:2 f:!50",
            "fields": (
                "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,"
                "f18,f20,f21,f23,f24,f25,f26,f22,f33,f11,f62,f128,f136,"
                "f115,f152,f124,f107,f104,f105,f140,f141,f207,f208,f209,f222"
            ),
        }
    else:
        params = {
            "pn": "1",
            "pz": "100",
            "po": "1",
            "np": "1",
            "ut": "bd1d9ddb04089700cf9c27f6f7426281",
            "fltt": "2",
            "invt": "2",
            "fid": "f12",
            "fs": "m:90 t:3 f:!50",
            "fields": (
                "f2,f3,f4,f8,f12,f14,f15,f16,f17,f18,f20,f21,f24,f25,f22,"
                "f33,f11,f62,f128,f124,f107,f104,f105,f136"
            ),
        }

    raw_df = fetch_eastmoney_clist(f"board:{sector_type}:eastmoney", params)
    df = pd.DataFrame(
        {
            "排名": range(1, len(raw_df) + 1),
            "板块名称": raw_df.get("f14"),
            "板块代码": raw_df.get("f12"),
            "最新价": raw_df.get("f2"),
            "涨跌额": raw_df.get("f4"),
            "涨跌幅": raw_df.get("f3"),
            "总市值": raw_df.get("f20"),
            "换手率": raw_df.get("f8"),
            "上涨家数": raw_df.get("f104"),
            "下跌家数": raw_df.get("f105"),
            "领涨股票": raw_df.get("f128"),
            "领涨股票-涨跌幅": raw_df.get("f136"),
        }
    )
    return normalize_numeric_columns(
        df,
        ["最新价", "涨跌额", "涨跌幅", "总市值", "换手率", "上涨家数", "下跌家数", "领涨股票-涨跌幅"],
    )


def eastmoney_fund_flow_df(sector_type: SectorType, period: Period) -> pd.DataFrame:
    sector_type_map = {"industry": "2", "concept": "3"}
    indicator_map = {
        "today": [
            "f62",
            "1",
            "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124",
            "今日",
        ],
        "5d": [
            "f164",
            "5",
            "f12,f14,f2,f109,f164,f165,f166,f167,f168,f169,f170,f171,f172,f173,f257,f258,f124",
            "5日",
        ],
        "10d": [
            "f174",
            "10",
            "f12,f14,f2,f160,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f260,f261,f124",
            "10日",
        ],
    }
    fid0, stat, fields, prefix = indicator_map[period]
    params = {
        "pn": "1",
        "pz": "100",
        "po": "1",
        "np": "1",
        "ut": "b2884a393a59ad64002292a3e90d46a5",
        "fltt": "2",
        "invt": "2",
        "fid0": fid0,
        "fs": f"m:90 t:{sector_type_map[sector_type]}",
        "stat": stat,
        "fields": fields,
        "_": int(time.time() * 1000),
    }
    raw_df = fetch_eastmoney_clist(f"fund:{sector_type}:{period}:eastmoney", params)

    if period == "today":
        df = pd.DataFrame(
            {
                "名称": raw_df.get("f14"),
                "今日涨跌幅": raw_df.get("f3"),
                "今日主力净流入-净额": raw_df.get("f62"),
                "今日主力净流入-净占比": raw_df.get("f184"),
                "今日超大单净流入-净额": raw_df.get("f66"),
                "今日超大单净流入-净占比": raw_df.get("f69"),
                "今日大单净流入-净额": raw_df.get("f72"),
                "今日大单净流入-净占比": raw_df.get("f75"),
                "今日中单净流入-净额": raw_df.get("f78"),
                "今日中单净流入-净占比": raw_df.get("f81"),
                "今日小单净流入-净额": raw_df.get("f84"),
                "今日小单净流入-净占比": raw_df.get("f87"),
                "今日主力净流入最大股": raw_df.get("f204"),
            }
        )
    else:
        field_map = {
            "5d": ["f109", "f164", "f165", "f166", "f167", "f168", "f169", "f170", "f171", "f172", "f173", "f257"],
            "10d": ["f160", "f174", "f175", "f176", "f177", "f178", "f179", "f180", "f181", "f182", "f183", "f260"],
        }
        change, main, main_ratio, super_large, super_large_ratio, big, big_ratio, middle, middle_ratio, small, small_ratio, top = field_map[period]
        df = pd.DataFrame(
            {
                "名称": raw_df.get("f14"),
                f"{prefix}涨跌幅": raw_df.get(change),
                f"{prefix}主力净流入-净额": raw_df.get(main),
                f"{prefix}主力净流入-净占比": raw_df.get(main_ratio),
                f"{prefix}超大单净流入-净额": raw_df.get(super_large),
                f"{prefix}超大单净流入-净占比": raw_df.get(super_large_ratio),
                f"{prefix}大单净流入-净额": raw_df.get(big),
                f"{prefix}大单净流入-净占比": raw_df.get(big_ratio),
                f"{prefix}中单净流入-净额": raw_df.get(middle),
                f"{prefix}中单净流入-净占比": raw_df.get(middle_ratio),
                f"{prefix}小单净流入-净额": raw_df.get(small),
                f"{prefix}小单净流入-净占比": raw_df.get(small_ratio),
                f"{prefix}主力净流入最大股": raw_df.get(top),
            }
        )

    numeric_columns = [column for column in df.columns if column != "名称" and "最大股" not in column]
    df = normalize_numeric_columns(df, numeric_columns)
    main_column = f"{prefix}主力净流入-净额"
    if main_column in df.columns:
        df.sort_values([main_column], ascending=False, inplace=True)
    df.reset_index(drop=True, inplace=True)
    df.insert(0, "序号", range(1, len(df) + 1))
    return df


def load_with_fallback(
    cache_key: str,
    primary: Callable[[], pd.DataFrame],
    fallback: Callable[[], pd.DataFrame],
) -> pd.DataFrame:
    try:
        return call_loader(cache_key, primary)
    except Exception as primary_exc:
        try:
            df = call_loader(f"{cache_key}:fallback", fallback)
        except Exception as fallback_exc:
            raise UpstreamDataError(
                f"{cache_key} primary failed: {primary_exc}; fallback failed: {fallback_exc}"
            ) from fallback_exc
        df.attrs["fallback"] = True
        df.attrs["primaryError"] = str(primary_exc)
        return df


def get_board_df(sector_type: SectorType) -> pd.DataFrame:
    meta = SECTOR_META[sector_type]
    return cached_dataframe(
        f"board:{sector_type}",
        lambda: load_with_fallback(
            f"board:{sector_type}",
            lambda: eastmoney_board_df(sector_type),
            meta["name_func"],
        ),
    )


def get_fund_flow_df(sector_type: SectorType, period: Period) -> pd.DataFrame:
    meta = SECTOR_META[sector_type]
    indicator = PERIOD_MAP[period]
    return cached_dataframe(
        f"fund:{sector_type}:{period}",
        lambda: load_with_fallback(
            f"fund:{sector_type}:{period}",
            lambda: eastmoney_fund_flow_df(sector_type, period),
            lambda: ak.stock_sector_fund_flow_rank(indicator=indicator, sector_type=meta["fund_type"]),
        ),
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
    cache_state = response_cache_state(
        (f"board:{type}", board_df),
        (f"fund:{type}:{period}", fund_df),
    )

    return {
        "market": "A股",
        "type": type,
        "period": period,
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "stale": cache_state["stale"],
        "error": cache_state["error"],
        "warnings": cache_state["warnings"],
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
    cache_state = response_cache_state((f"stocks:{type}:{sector_symbol}", df))

    return {
        "sectorCode": resolved_code,
        "sectorName": sector_symbol,
        "type": type,
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "stale": cache_state["stale"],
        "error": cache_state["error"],
        "warnings": cache_state["warnings"],
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
    cache_state = response_cache_state(("etf:spot", df))

    return {
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "stale": cache_state["stale"],
        "error": cache_state["error"],
        "warnings": cache_state["warnings"],
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
        "stale": response_cache_state(
            (f"board:{type}", board_df),
            (f"fund:{type}:{period}", fund_df),
            ("etf:spot", etf_df),
        )["stale"],
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
        "staleKeys": list(STALE_CACHE.keys()),
        "staleUpdatedAt": STALE_CACHE_UPDATED_AT,
        "updatedAt": now_ts(),
    }


@app.get("/api/warmup")
def warmup() -> dict[str, Any]:
    checks: dict[str, dict[str, Any]] = {}
    loaders: list[tuple[str, Callable[[], pd.DataFrame]]] = [
        ("board:industry", lambda: get_board_df("industry")),
        ("fund:industry:today", lambda: get_fund_flow_df("industry", "today")),
        ("board:concept", lambda: get_board_df("concept")),
        ("fund:concept:today", lambda: get_fund_flow_df("concept", "today")),
        ("etf:spot", get_etf_spot_df),
    ]

    for key, loader in loaders:
        try:
            df = loader()
            checks[key] = {
                "ok": True,
                "rows": len(df),
                "stale": bool(df.attrs.get("stale")),
                "error": df.attrs.get("error"),
            }
        except Exception as exc:  # noqa: BLE001
            checks[key] = {"ok": False, "rows": 0, "stale": False, "error": str(exc)}

    return {
        "source": SOURCE_NAME,
        "updatedAt": now_ts(),
        "ok": all(item["ok"] for item in checks.values()),
        "checks": checks,
    }
