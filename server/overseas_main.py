from __future__ import annotations

import os
from typing import Any

import pandas as pd
import requests
from fastapi import Query

import main as base

app = base.app

ALLOW_STALE_CACHE = os.getenv("JIJIN_ALLOW_STALE_CACHE", "false").strip().lower() in {"1", "true", "yes", "on"}
ETF_QUOTE_PROVIDER = os.getenv("JIJIN_ETF_QUOTE_PROVIDER", "auto").strip().lower() or "auto"
ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query"


def selected_etf_quote_provider() -> str:
    if ETF_QUOTE_PROVIDER not in {"auto", "akshare", "alpha_vantage"}:
        return "auto"
    if ETF_QUOTE_PROVIDER == "auto":
        return "alpha_vantage" if ALPHA_VANTAGE_API_KEY else "akshare"
    return ETF_QUOTE_PROVIDER


def source_name() -> str:
    if selected_etf_quote_provider() == "alpha_vantage":
        return "AKShare / 东方财富 + Alpha Vantage"
    return "AKShare / 东方财富"


base.SOURCE_NAME = source_name()


def strict_cached_dataframe(cache_key: str, loader):
    cached = base.CACHE.get(cache_key)
    if cached is not None:
        df = cached.copy()
        df.attrs["stale"] = False
        return df

    try:
        df = base.call_with_retry(cache_key, loader)
    except Exception as exc:
        stale_df = base.STALE_CACHE.get(cache_key)
        if not ALLOW_STALE_CACHE or stale_df is None:
            raise
        df = stale_df.copy()
        df.attrs["stale"] = True
        df.attrs["error"] = "upstream failed, served stale cache"
        df.attrs["upstreamError"] = str(exc)
        df.attrs["staleUpdatedAt"] = base.STALE_CACHE_UPDATED_AT.get(cache_key)
        return df

    now = base.now_ts()
    df.attrs["stale"] = False
    base.CACHE[cache_key] = df.copy()
    base.STALE_CACHE[cache_key] = df.copy()
    base.STALE_CACHE_UPDATED_AT[cache_key] = now
    return df


base.cached_dataframe = strict_cached_dataframe


def alpha_vantage_symbol(code: str) -> str:
    code = base.clean_text(code)
    if "." in code:
        return code
    if code.startswith("5"):
        return f"{code}.SHH"
    if code.startswith(("15", "16", "18")):
        return f"{code}.SHZ"
    return code


def parse_alpha_percent(value: Any) -> float:
    return base.safe_float(str(value or "").replace("%", ""))


def alpha_vantage_quote_df(codes: set[str]) -> pd.DataFrame:
    if not ALPHA_VANTAGE_API_KEY:
        raise base.UpstreamDataError("Alpha Vantage API key 未配置，请设置 ALPHA_VANTAGE_API_KEY")

    rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    for code in sorted(codes):
        symbol = alpha_vantage_symbol(code)
        response = requests.get(
            ALPHA_VANTAGE_URL,
            params={"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": ALPHA_VANTAGE_API_KEY},
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("Error Message") or payload.get("Note") or payload.get("Information"):
            warnings.append(f"{code}: {payload.get('Error Message') or payload.get('Note') or payload.get('Information')}")
            continue

        quote = payload.get("Global Quote") or {}
        price = base.safe_float(quote.get("05. price"))
        volume = base.safe_float(quote.get("06. volume"))
        if not quote or price <= 0:
            warnings.append(f"{code}: Alpha Vantage 未返回有效 Global Quote")
            continue

        rows.append(
            {
                "代码": code,
                "基金简称": symbol,
                "最新价": price,
                "涨跌幅": parse_alpha_percent(quote.get("10. change percent")),
                "成交量": volume,
                "成交额": price * volume,
                "溢折率": None,
                "数据源": "Alpha Vantage",
                "数据说明": "成交额按 price * volume 估算；溢折价不可用",
                "更新时间": quote.get("07. latest trading day") or base.now_ts(),
            }
        )

    if not rows:
        message = "Alpha Vantage ETF 行情无有效返回"
        if warnings:
            message += f": {'; '.join(warnings[:3])}"
        raise base.UpstreamDataError(message)

    df = pd.DataFrame(rows)
    if warnings:
        df.attrs["warnings"] = warnings[:10]
    return base.validate_dataframe("etf:alpha_vantage", df)


def get_etf_spot_df(codes: set[str]) -> pd.DataFrame:
    if selected_etf_quote_provider() == "alpha_vantage":
        cache_key = "etf:alpha_vantage:" + ",".join(sorted(codes))
        return strict_cached_dataframe(cache_key, lambda: alpha_vantage_quote_df(codes))
    return strict_cached_dataframe("etf:akshare", base.ak.fund_etf_spot_em)


def normalize_etf(row: pd.Series) -> dict[str, Any]:
    provider = base.clean_text(base.pick_first(row, ["数据源"], selected_etf_quote_provider()))
    premium_raw = base.pick_first(row, ["溢价率", "折价率", "溢折率"])
    return {
        "code": base.clean_text(base.pick_first(row, ["代码", "基金代码"])),
        "name": base.clean_text(base.pick_first(row, ["名称", "基金简称", "基金名称"])),
        "price": round(base.safe_float(base.pick_first(row, ["最新价", "单位净值"])), 4),
        "changePct": round(base.safe_float(base.pick_first(row, ["涨跌幅", "涨幅"])), 2),
        "amount": base.money_to_yi(base.pick_first(row, ["成交额", "成交金额"], 0)),
        "volume": base.safe_float(base.pick_first(row, ["成交量"], 0)),
        "premiumRate": round(base.safe_float(premium_raw, 0), 2),
        "premiumRateAvailable": premium_raw is not None,
        "amountEstimated": provider == "Alpha Vantage",
        "source": provider,
        "note": base.clean_text(base.pick_first(row, ["数据说明"])),
        "updatedAt": base.now_ts(),
    }


def remove_get_route(path: str) -> None:
    app.router.routes[:] = [
        route
        for route in app.router.routes
        if not (getattr(route, "path", None) == path and "GET" in getattr(route, "methods", set()))
    ]


remove_get_route("/api/health")
remove_get_route("/api/etf/quotes")
remove_get_route("/api/cache")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "jijin-show-sector-api",
        "version": "0.4.0",
        "source": source_name(),
        "settings": {
            "allowStaleCache": ALLOW_STALE_CACHE,
            "etfQuoteProvider": selected_etf_quote_provider(),
            "alphaVantageConfigured": bool(ALPHA_VANTAGE_API_KEY),
            "mockEnabled": False,
        },
        "cache": {
            "size": len(base.CACHE),
            "maxSize": base.CACHE_MAXSIZE,
            "ttlSeconds": base.CACHE_TTL_SECONDS,
            "keys": list(base.CACHE.keys()),
        },
        "timestamp": base.now_ts(),
    }


@app.get("/api/etf/quotes")
def etf_quotes(codes: str = Query("", description="ETF 代码，英文逗号分隔")) -> dict[str, Any]:
    wanted = base.parse_codes(codes)
    if not wanted:
        return {"source": source_name(), "provider": selected_etf_quote_provider(), "updatedAt": base.now_ts(), "count": 0, "quotes": []}

    try:
        df = get_etf_spot_df(wanted)
    except Exception as exc:  # noqa: BLE001
        raise base.upstream_error("获取 ETF 行情失败", exc) from exc

    quotes = [
        normalize_etf(row)
        for _, row in df.iterrows()
        if base.clean_text(base.pick_first(row, ["代码", "基金代码"])) in wanted
    ]
    quote_order = {code: index for index, code in enumerate(codes.split(","))}
    quotes.sort(key=lambda item: quote_order.get(item["code"], 999))

    cache_key = "etf:alpha_vantage:" + ",".join(sorted(wanted)) if selected_etf_quote_provider() == "alpha_vantage" else "etf:akshare"
    cache_state = base.response_cache_state((cache_key, df))
    return {
        "source": source_name(),
        "provider": selected_etf_quote_provider(),
        "updatedAt": base.now_ts(),
        "stale": cache_state["stale"],
        "error": cache_state["error"],
        "warnings": [*cache_state["warnings"], *(df.attrs.get("warnings") or [])],
        "count": len(quotes),
        "quotes": quotes,
    }


@app.get("/api/cache")
def cache_status() -> dict[str, Any]:
    return {
        "size": len(base.CACHE),
        "maxSize": base.CACHE_MAXSIZE,
        "ttlSeconds": base.CACHE_TTL_SECONDS,
        "allowStaleCache": ALLOW_STALE_CACHE,
        "keys": list(base.CACHE.keys()),
        "staleKeys": list(base.STALE_CACHE.keys()),
    }
