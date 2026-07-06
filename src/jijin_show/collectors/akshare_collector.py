from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from jijin_show.models import Dataset
from jijin_show.normalizers.flow import normalize_sector_flow_rank, normalize_stock_flow_rank
from jijin_show.normalizers.fund import (
    normalize_etf_market_daily,
    normalize_fund_index_master,
    normalize_fund_master,
    normalize_fund_nav_daily,
)


class AkshareCollector:
    """Low-frequency AKShare collector for fund market overview assets."""

    def __init__(self, timezone: str = "Asia/Shanghai") -> None:
        self.timezone = timezone

    def _now(self) -> datetime:
        return datetime.now(ZoneInfo(self.timezone))

    @staticmethod
    def _ak():
        try:
            import akshare as ak  # type: ignore
        except ImportError as exc:
            raise RuntimeError("akshare is not installed. Run: pip install akshare") from exc
        return ak

    def collect_fund_master(self) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        raw = ak.fund_name_em()
        data = normalize_fund_master(raw, fetched_at=fetched_at)
        return Dataset("fund_master", data, source="akshare.fund_name_em", fetched_at=fetched_at)

    def collect_fund_index_master(
        self,
        symbols: Iterable[str] | None = None,
        indicators: Iterable[str] | None = None,
    ) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        symbols = symbols or ["全部", "沪深指数", "行业主题", "大盘指数", "中盘指数", "小盘指数"]
        indicators = indicators or ["全部"]

        frames: list[pd.DataFrame] = []
        for symbol in symbols:
            for indicator in indicators:
                frame = ak.fund_info_index_em(symbol=symbol, indicator=indicator)
                if frame is None or frame.empty:
                    continue
                frame = frame.copy()
                frame["_index_category"] = symbol
                frame["_index_indicator"] = indicator
                frames.append(frame)

        raw = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        data = normalize_fund_index_master(raw, fetched_at=fetched_at)
        return Dataset("fund_index_master", data, source="akshare.fund_info_index_em", fetched_at=fetched_at)

    def collect_fund_nav_daily(self) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        raw = ak.fund_open_fund_daily_em()
        data = normalize_fund_nav_daily(raw, fetched_at=fetched_at)
        return Dataset("fund_nav_daily", data, source="akshare.fund_open_fund_daily_em", fetched_at=fetched_at)

    def collect_etf_market_daily(self) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        raw = ak.fund_etf_fund_daily_em()
        data = normalize_etf_market_daily(raw, fetched_at=fetched_at)
        return Dataset("etf_market_daily", data, source="akshare.fund_etf_fund_daily_em", fetched_at=fetched_at)

    def collect_sector_flow_rank(
        self,
        indicators: Iterable[str] | None = None,
        sector_types: Iterable[str] | None = None,
    ) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        indicators = indicators or ["今日", "5日", "10日"]
        sector_types = sector_types or ["行业资金流", "概念资金流", "地域资金流"]

        frames: list[pd.DataFrame] = []
        for indicator in indicators:
            for sector_type in sector_types:
                frame = ak.stock_sector_fund_flow_rank(
                    indicator=indicator,
                    sector_type=sector_type,
                )
                if frame is None or frame.empty:
                    continue
                frame = frame.copy()
                frame["_period"] = indicator
                frame["_sector_type"] = sector_type
                frames.append(frame)

        raw = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        data = normalize_sector_flow_rank(raw, fetched_at=fetched_at)
        return Dataset(
            "sector_flow_rank_daily",
            data,
            source="akshare.stock_sector_fund_flow_rank",
            fetched_at=fetched_at,
        )

    def collect_stock_flow_rank(self, indicators: Iterable[str] | None = None) -> Dataset:
        ak = self._ak()
        fetched_at = self._now()
        indicators = indicators or ["今日", "3日", "5日", "10日"]

        frames: list[pd.DataFrame] = []
        for indicator in indicators:
            frame = ak.stock_individual_fund_flow_rank(indicator=indicator)
            if frame is None or frame.empty:
                continue
            frame = frame.copy()
            frame["_period"] = indicator
            frames.append(frame)

        raw = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        data = normalize_stock_flow_rank(raw, fetched_at=fetched_at)
        return Dataset(
            "stock_flow_rank_daily",
            data,
            source="akshare.stock_individual_fund_flow_rank",
            fetched_at=fetched_at,
        )
