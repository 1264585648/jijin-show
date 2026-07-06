# 数据采集计划

更新时间：2026-07-06

本文档定义第一阶段数据采集、清洗、缓存、落库和异常处理方案。

## 1. 第一阶段目标

先完成一个低成本、低频、可缓存的基金大盘数据底座。

第一阶段不追求高频实时，而是优先保证：

1. 数据能稳定拿到。
2. 字段能统一。
3. 页面能快速消费。
4. 异动指标能复现。
5. 后续可以平滑切换到更稳定数据源。

## 2. 技术建议

| 模块 | 建议 |
| --- | --- |
| 语言 | Python |
| 主数据源 | AKShare |
| 备用数据源 | EFinance |
| 本地存储 | DuckDB 或 SQLite |
| 大文件存储 | Parquet，不提交 Git |
| 定时任务 | cron / GitHub Actions / 云函数 / 后端调度器 |
| 前端消费 | 先读静态 JSON，后续改成 API |
| 缓存 | 文件缓存 + 数据库缓存 |

建议先采用：

```text
AKShare -> Pandas -> 字段标准化 -> DuckDB/SQLite -> 导出 JSON -> 前端展示
```

## 3. 采集任务设计

### 3.1 基金基础信息任务：`collect_fund_master`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_name_em()` |
| 目标表 | `fund_master` |
| 频率 | 每日一次，或每周一次 |
| 触发时间 | 交易日 20:30 后 |
| 失败策略 | 保留上一次成功数据 |

输出：

- 基金代码
- 基金简称
- 基金类型
- 拼音缩写
- 拼音全称

### 3.2 指数基金任务：`collect_fund_index_master`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_info_index_em()` |
| 目标表 | `fund_index_master` |
| 频率 | 每日一次 |
| 触发时间 | 交易日 20:30 后 |
| 参数 | `symbol` 覆盖全部、行业主题、沪深指数、大盘指数等 |

建议参数组合：

```text
symbol: 全部 / 沪深指数 / 行业主题 / 大盘指数 / 中盘指数 / 小盘指数 / 股票指数 / 债券指数
indicator: 全部 / 被动指数型 / 增强指数型
```

### 3.3 开放式基金净值任务：`collect_fund_nav_daily`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_open_fund_daily_em()` |
| 目标表 | `fund_nav_daily` |
| 频率 | 每日一次 |
| 触发时间 | 交易日 20:30 后 |
| 注意 | 天天基金净值通常交易日 16:00-23:00 更新，建议不要太早采集 |

### 3.4 ETF / 场内基金任务：`collect_etf_market_daily`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_etf_fund_daily_em()` |
| 备用 | EFinance `ef.stock.get_quote_history()` |
| 目标表 | `etf_market_daily` |
| 频率 | 每日一次 |
| 触发时间 | 交易日 20:30 后 |

### 3.5 板块资金流任务：`collect_sector_flow_rank`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `stock_sector_fund_flow_rank()` |
| 目标表 | `sector_flow_rank_daily` |
| 频率 | 盘中低频 + 收盘后 |
| 参数 | 行业资金流 / 概念资金流 / 地域资金流；今日 / 5日 / 10日 |

建议采集点：

```text
10:00   观察早盘资金方向
11:30   上午收盘快照
14:30   尾盘前快照
15:10   收盘后快照
20:30   盘后补采 / 校准
```

第一阶段如果只想简单，可以只做：

```text
15:10 + 20:30
```

### 3.6 板块历史资金流任务：`collect_sector_flow_history`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `stock_sector_fund_flow_hist()`、`stock_concept_fund_flow_hist()` |
| 目标表 | `sector_flow_history` |
| 频率 | 每日一次 |
| 触发时间 | 交易日 20:30 后 |
| 前置依赖 | 先从 `sector_flow_rank_daily` 得到板块名称列表 |

策略：

1. 先采集当日行业 / 概念资金流排名。
2. 取排名靠前、靠后、昨日热门、人工关注板块。
3. 对这些板块拉取历史资金流。
4. 避免一次性全量抓取，降低接口压力。

### 3.7 个股资金流任务：`collect_stock_flow_rank`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `stock_individual_fund_flow_rank()`、`stock_main_fund_flow()` |
| 目标表 | `stock_flow_rank_daily` |
| 频率 | 盘中低频 + 收盘后 |
| 参数 | 今日 / 3日 / 5日 / 10日 |

用途：

- 主力资金异动榜。
- 热门板块龙头识别。
- 基金持仓个股资金变化。

### 3.8 基金持仓任务：`collect_fund_holdings`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_portfolio_hold_em()` |
| 目标表 | `fund_stock_holding` |
| 频率 | 季度 / 月度补采 |
| 参数 | fund_code、年份 |
| 注意 | 持仓数据来自定期报告，有披露滞后 |

策略：

- MVP 先只采 ETF / 指数基金 / 热门基金。
- 不要一开始全市场基金全量拉持仓。
- 后续做队列和断点续采。

### 3.9 基金行业配置任务：`collect_fund_industry_allocation`

| 项 | 内容 |
| --- | --- |
| 来源 | AKShare `fund_portfolio_industry_allocation_em()` |
| 目标表 | `fund_industry_allocation` |
| 频率 | 季度 / 月度补采 |
| 参数 | fund_code、年份 |

## 4. 清洗与标准化

### 4.1 字段命名规范

第三方接口常见中文字段，项目内部统一改成英文 snake_case。

示例：

| 原始字段 | 标准字段 |
| --- | --- |
| 基金代码 | fund_code |
| 基金简称 | fund_name |
| 单位净值 | unit_nav |
| 累计净值 | accumulated_nav |
| 日增长率 | daily_return |
| 主力净流入-净额 | main_net_inflow |
| 主力净流入-净占比 | main_net_inflow_ratio |
| 超大单净流入-净额 | super_large_net_inflow |
| 涨跌幅 | pct_change |
| 成交额 | amount |

### 4.2 金额单位规范

建议内部统一为「元」。

如果来源字段是万元、亿元，需要在清洗时转为元，并保留字段说明。

### 4.3 日期时间规范

| 字段 | 说明 |
| --- | --- |
| trade_date | 交易日 |
| report_date | 报告截止日 |
| snapshot_time | 盘中快照时间 |
| fetched_at | 实际采集时间 |
| updated_at | 数据更新 / 入库时间 |

建议统一使用 Asia/Shanghai 时区。

## 5. 缓存策略

### 5.1 原始缓存

每次采集保存原始数据：

```text
data/raw/{source}/{task_name}/{date}/{timestamp}.parquet
```

用途：

- 方便排查字段变化。
- 方便重新清洗。
- 避免重复请求源站。

### 5.2 标准化缓存

标准化后保存：

```text
data/processed/{asset_name}/{date}.parquet
```

### 5.3 前端缓存

第一阶段可以导出页面 JSON：

```text
public/data/market-overview.json
public/data/sector-flow-rank.json
public/data/etf-watchlist.json
public/data/flow-anomaly.json
```

## 6. 异常处理

### 6.1 接口失败

处理顺序：

1. 重试 2-3 次。
2. 使用上一次成功缓存。
3. 尝试备用源。
4. 标记数据为 stale。
5. 页面展示「数据更新时间」和「数据状态」。

### 6.2 字段变化

每个采集任务需要做字段校验：

```text
required_columns = ["基金代码", "基金简称", "单位净值"]
```

如果缺字段：

- 写入错误日志。
- 保留原始响应。
- 不覆盖上一版有效数据。

### 6.3 空数据

如果返回空 DataFrame：

- 不直接覆盖旧数据。
- 记录为空原因。
- 盘中接口可允许空，但盘后任务要告警。

## 7. 数据质量规则

| 资产 | 规则 |
| --- | --- |
| `fund_master` | fund_code 不为空且唯一 |
| `fund_nav_daily` | unit_nav >= 0；daily_return 合理区间 |
| `sector_flow_rank_daily` | sector_name 不为空；period 枚举合法 |
| `stock_flow_rank_daily` | stock_code 不为空；金额字段可为空但不能为非法字符串 |
| `fund_sector_mapping` | exposure_weight 在 0-1 或 0-100 范围内统一标准 |

## 8. 任务依赖关系

```text
collect_fund_master
  -> collect_fund_index_master
  -> collect_fund_nav_daily
  -> collect_etf_market_daily

collect_sector_flow_rank
  -> collect_sector_flow_history
  -> compute_sector_heat_score
  -> build_etf_watchlist

collect_stock_flow_rank
  -> compute_stock_flow_anomaly
  -> enrich_fund_holding_flow

collect_fund_holdings
  -> collect_fund_industry_allocation
  -> build_fund_sector_mapping
```

## 9. 第一阶段推荐落地顺序

### Step 1：只做文档与配置

已完成：

- 数据源文档。
- 数据资产文档。
- 采集计划。
- 数据源配置模板。

### Step 2：实现采集脚本

建议新增：

```text
src/collectors/akshare_collector.py
src/normalizers/fund.py
src/normalizers/flow.py
src/storage/duckdb_store.py
```

### Step 3：导出前端 JSON

建议新增：

```text
src/exporters/frontend_json.py
public/data/*.json
```

### Step 4：做第一版页面

优先页面：

1. 大盘资金概览。
2. 行业资金流。
3. 概念资金流。
4. ETF / 指数基金观察榜。

## 10. MVP 最小任务集

真正开始写代码时，可以先只实现这 5 个任务：

```text
collect_fund_master
collect_fund_index_master
collect_fund_nav_daily
collect_sector_flow_rank
collect_stock_flow_rank
```

这 5 个任务已经足够支撑第一版基金大盘页面。
