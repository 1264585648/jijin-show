# data 目录说明

该目录用于本地开发或部署环境中的数据缓存、原始数据和标准化数据。

## 不提交真实数据

不要把第三方接口采集到的大体量数据提交到 Git 仓库。建议只保留目录说明和必要的样例结构。

## 推荐结构

```text
data/
├── local/                   # 本地数据库，例如 DuckDB / SQLite
├── raw/                     # 原始接口结果
│   ├── akshare/
│   └── efinance/
├── processed/               # 标准化后的 Parquet / CSV
└── exports/                 # 前端或分析脚本消费的导出数据
```

## 原始数据命名

```text
data/raw/{source}/{task_name}/{trade_date}/{timestamp}.parquet
```

示例：

```text
data/raw/akshare/sector_flow_rank/2026-07-06/20260706T151000.parquet
```

## 标准化数据命名

```text
data/processed/{asset_name}/{trade_date}.parquet
```

示例：

```text
data/processed/sector_flow_rank_daily/2026-07-06.parquet
```

## 前端导出数据

如果前端先使用静态 JSON，可以导出到：

```text
public/data/market-overview.json
public/data/sector-flow-rank.json
public/data/etf-watchlist.json
public/data/flow-anomaly.json
```

## 数据状态

每份前端导出数据建议包含：

```json
{
  "source": "akshare",
  "trade_date": "2026-07-06",
  "fetched_at": "2026-07-06T20:30:00+08:00",
  "status": "fresh",
  "data": []
}
```

状态枚举建议：

| 状态 | 说明 |
| --- | --- |
| fresh | 最新采集成功 |
| stale | 使用上一次成功缓存 |
| partial | 部分接口失败 |
| empty | 接口返回为空，未覆盖旧数据 |
| error | 当前数据不可用 |
