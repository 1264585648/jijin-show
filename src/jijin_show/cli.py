from __future__ import annotations

from pathlib import Path
from typing import Callable

import typer
from rich.console import Console
from rich.table import Table

from jijin_show.collectors.akshare_collector import AkshareCollector
from jijin_show.config import load_config
from jijin_show.exporters.frontend_json import export_dataset_json, export_market_overview_json
from jijin_show.models import Dataset
from jijin_show.signals.sector import compute_sector_heat_score
from jijin_show.storage.duckdb_store import DuckDBStore

app = typer.Typer(help="jijin-show fund market data toolkit")
console = Console()

AssetCollector = Callable[[AkshareCollector], Dataset]


def _asset_collectors() -> dict[str, AssetCollector]:
    return {
        "fund_master": lambda collector: collector.collect_fund_master(),
        "fund_index_master": lambda collector: collector.collect_fund_index_master(),
        "fund_nav_daily": lambda collector: collector.collect_fund_nav_daily(),
        "etf_market_daily": lambda collector: collector.collect_etf_market_daily(),
        "sector_flow_rank_daily": lambda collector: collector.collect_sector_flow_rank(),
        "stock_flow_rank_daily": lambda collector: collector.collect_stock_flow_rank(),
    }


@app.command("assets")
def list_assets() -> None:
    """List supported MVP assets."""
    table = Table(title="Supported assets")
    table.add_column("Asset")
    table.add_column("Description")

    descriptions = {
        "fund_master": "基金基础信息",
        "fund_index_master": "指数基金主数据",
        "fund_nav_daily": "开放式基金每日净值",
        "etf_market_daily": "ETF / 场内基金数据",
        "sector_flow_rank_daily": "行业 / 概念 / 地域板块资金流排名",
        "stock_flow_rank_daily": "个股主力资金流排名",
    }

    for asset, description in descriptions.items():
        table.add_row(asset, description)
    console.print(table)


@app.command("collect")
def collect(
    asset: str = typer.Argument(..., help="Asset name, or 'all'. Run `jijin-show assets` to list."),
    config: Path | None = typer.Option(None, "--config", "-c", help="Config YAML path."),
    save: bool = typer.Option(True, help="Save dataset to DuckDB."),
    export: bool = typer.Option(True, help="Export dataset JSON for frontend."),
    mode: str = typer.Option("replace", help="DuckDB write mode: replace or append."),
) -> None:
    """Collect one asset or all MVP assets."""
    app_config = load_config(config)
    collector = AkshareCollector(timezone=app_config.timezone)
    store = DuckDBStore(app_config.storage.database)

    collectors = _asset_collectors()
    asset_names = list(collectors) if asset == "all" else [asset]

    unknown_assets = [name for name in asset_names if name not in collectors]
    if unknown_assets:
        raise typer.BadParameter(f"Unsupported asset: {', '.join(unknown_assets)}")

    table = Table(title="Collection result")
    table.add_column("Asset")
    table.add_column("Rows", justify="right")
    table.add_column("Saved")
    table.add_column("Exported")

    for name in asset_names:
        dataset = collectors[name](collector)
        saved = "no"
        exported = "no"

        if save:
            store.save_dataset(dataset, mode=mode)
            saved = "yes"

        if export:
            export_path = export_dataset_json(dataset, app_config.storage.frontend_export_dir)
            exported = str(export_path)

        table.add_row(dataset.name, str(dataset.rows), saved, exported)

    console.print(table)


@app.command("overview")
def overview(
    config: Path | None = typer.Option(None, "--config", "-c", help="Config YAML path."),
    save: bool = typer.Option(True, help="Save source datasets and signal table to DuckDB."),
) -> None:
    """Collect sector / stock flow and export market-overview JSON."""
    app_config = load_config(config)
    collector = AkshareCollector(timezone=app_config.timezone)
    store = DuckDBStore(app_config.storage.database)

    sector_flow = collector.collect_sector_flow_rank()
    stock_flow = collector.collect_stock_flow_rank()

    sector_heat = Dataset(
        name="sector_heat_score",
        data=compute_sector_heat_score(sector_flow.data),
        source=sector_flow.source,
        fetched_at=sector_flow.fetched_at,
        status=sector_flow.status,
    )

    if save:
        store.save_dataset(sector_flow, mode="replace")
        store.save_dataset(stock_flow, mode="replace")
        store.save_dataset(sector_heat, mode="replace")

    overview_path = export_market_overview_json(
        sector_flow=sector_flow,
        stock_flow=stock_flow,
        output_dir=app_config.storage.frontend_export_dir,
    )
    heat_path = export_dataset_json(sector_heat, app_config.storage.frontend_export_dir)

    console.print(f"Exported overview: {overview_path}")
    console.print(f"Exported sector heat score: {heat_path}")


if __name__ == "__main__":
    app()
