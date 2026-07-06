# 数据资产梳理

更新时间：2026-07-06

本文档把可依赖接口进一步转化为项目内部可以长期沉淀的数据资产、指标资产和页面资产。

## 数据资产总览

```text
原始数据源
  -> 采集适配器
  -> 原始落库 raw_xxx
  -> 标准化明细 dwd_xxx
  -> 聚合指标 dws_xxx
  -> 页面资产 app_xxx
  -> 异动信号 signal_xxx
```

第一阶段不必一开始做复杂数仓，但建议从命名上提前区分层级，避免后面返工。

## 1. 基础主数据资产

### 1.1 基金主数据：`fund_master`

来源：AKShare `fund_name_em()`、后续可用 Tushare `fund_basic` 增强。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| fund_code | string | 基金代码 |
| fund_name | string | 基金简称 / 基金名称 |
| fund_type | string | 基金类型，如股票型、混合型、债券型、指数型、QDII 等 |
| pinyin_abbr | string | 拼音缩写 |
| pinyin_full | string | 拼音全称 |
| source | string | 数据来源 |
| updated_at | datetime | 更新时间 |

用途：

- 基金搜索。
- 基金详情页。
- ETF / 指数基金映射。
- 持仓和净值数据的维表。

### 1.2 指数基金主数据：`fund_index_master`

来源：AKShare `fund_info_index_em()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| fund_code | string | 基金代码 |
| fund_name | string | 基金名称 |
| track_index | string | 跟踪标的 |
| track_method | string | 被动指数型 / 增强指数型 |
| index_category | string | 沪深指数、行业主题、大盘指数等 |
| nav | decimal | 单位净值 |
| nav_date | date | 净值日期 |
| return_1w | decimal | 近 1 周收益率 |
| return_1m | decimal | 近 1 月收益率 |
| return_3m | decimal | 近 3 月收益率 |
| return_ytd | decimal | 今年来收益率 |
| fee | decimal | 手续费 |
| updated_at | datetime | 更新时间 |

用途：

- ETF / 指数基金热度榜。
- 板块资金流到基金的映射。
- 主题基金池构建。

### 1.3 A 股证券主数据：`stock_master`

来源：AKShare `stock_zh_a_spot_em()`，后续可接入交易所 / Tushare 标准证券列表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| stock_code | string | 股票代码 |
| stock_name | string | 股票名称 |
| market | string | 市场，如沪市、深市、北交所 |
| board | string | 板块，如主板、创业板、科创板等 |
| source | string | 数据来源 |
| updated_at | datetime | 更新时间 |

用途：

- 个股资金流归因。
- 基金持仓映射。
- 行业 / 概念成分股映射。

## 2. 行情与净值资产

### 2.1 开放式基金净值：`fund_nav_daily`

来源：AKShare `fund_open_fund_daily_em()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trade_date | date | 交易日 / 净值日期 |
| fund_code | string | 基金代码 |
| fund_name | string | 基金简称 |
| unit_nav | decimal | 单位净值 |
| accumulated_nav | decimal | 累计净值 |
| prev_unit_nav | decimal | 前交易日单位净值 |
| daily_change | decimal | 日增长值 |
| daily_return | decimal | 日增长率 |
| subscribe_status | string | 申购状态 |
| redeem_status | string | 赎回状态 |
| fee | string | 手续费 |
| source | string | 数据来源 |
| fetched_at | datetime | 采集时间 |

### 2.2 场内基金 / ETF 行情：`etf_market_daily`

来源：AKShare `fund_etf_fund_daily_em()`，EFinance `ef.stock.get_quote_history()` 可备用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trade_date | date | 交易日 |
| fund_code | string | 基金代码 |
| fund_name | string | 基金简称 |
| fund_type | string | ETF / LOF / 场内基金类型 |
| unit_nav | decimal | 单位净值 |
| accumulated_nav | decimal | 累计净值 |
| growth_value | decimal | 增长值 |
| growth_rate | decimal | 增长率 |
| market_price | decimal | 市价 |
| discount_rate | decimal | 折价率 |
| source | string | 数据来源 |
| fetched_at | datetime | 采集时间 |

### 2.3 全 A 行情快照：`stock_quote_snapshot`

来源：AKShare `stock_zh_a_spot_em()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| snapshot_time | datetime | 快照时间 |
| stock_code | string | 股票代码 |
| stock_name | string | 股票名称 |
| last_price | decimal | 最新价 |
| pct_change | decimal | 涨跌幅 |
| amount | decimal | 成交额 |
| volume | decimal | 成交量 |
| turnover_rate | decimal | 换手率 |
| market_cap | decimal | 总市值 |
| float_market_cap | decimal | 流通市值 |
| pe_dynamic | decimal | 动态市盈率 |
| pb | decimal | 市净率 |
| source | string | 数据来源 |

用途：

- 计算市场宽度。
- 识别涨跌结构。
- 辅助资金流异动判断。

## 3. 资金流资产

### 3.1 板块资金流排名：`sector_flow_rank_daily`

来源：AKShare `stock_sector_fund_flow_rank()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trade_date | date | 交易日 |
| snapshot_time | datetime | 快照时间 |
| sector_type | string | 行业资金流 / 概念资金流 / 地域资金流 |
| period | string | 今日 / 5日 / 10日 |
| rank | integer | 排名 |
| sector_name | string | 板块名称 |
| pct_change | decimal | 涨跌幅 |
| main_net_inflow | decimal | 主力净流入净额 |
| main_net_inflow_ratio | decimal | 主力净流入净占比 |
| super_large_net_inflow | decimal | 超大单净流入净额 |
| super_large_net_inflow_ratio | decimal | 超大单净占比 |
| large_net_inflow | decimal | 大单净流入净额 |
| large_net_inflow_ratio | decimal | 大单净占比 |
| medium_net_inflow | decimal | 中单净流入净额 |
| medium_net_inflow_ratio | decimal | 中单净占比 |
| small_net_inflow | decimal | 小单净流入净额 |
| small_net_inflow_ratio | decimal | 小单净占比 |
| source | string | 数据来源 |

页面用途：

- 行业资金流榜。
- 概念资金流榜。
- 地域资金流榜。
- 今日 / 5 日 / 10 日资金持续性对比。

### 3.2 板块资金流历史：`sector_flow_history`

来源：AKShare `stock_sector_fund_flow_hist()`、`stock_concept_fund_flow_hist()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trade_date | date | 交易日 |
| sector_type | string | 行业 / 概念 |
| sector_name | string | 板块名称 |
| main_net_inflow | decimal | 主力净流入净额 |
| main_net_inflow_ratio | decimal | 主力净流入净占比 |
| super_large_net_inflow | decimal | 超大单净流入净额 |
| large_net_inflow | decimal | 大单净流入净额 |
| medium_net_inflow | decimal | 中单净流入净额 |
| small_net_inflow | decimal | 小单净流入净额 |
| source | string | 数据来源 |

页面用途：

- 板块资金流趋势图。
- 资金持续性判断。
- 资金流均值、分位数、异常值检测。

### 3.3 个股资金流排名：`stock_flow_rank_daily`

来源：AKShare `stock_individual_fund_flow_rank()`、`stock_main_fund_flow()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trade_date | date | 交易日 |
| snapshot_time | datetime | 快照时间 |
| period | string | 今日 / 3日 / 5日 / 10日 |
| stock_code | string | 股票代码 |
| stock_name | string | 股票名称 |
| last_price | decimal | 最新价 |
| pct_change | decimal | 涨跌幅 |
| main_net_inflow | decimal | 主力净流入净额 |
| main_net_inflow_ratio | decimal | 主力净占比 |
| super_large_net_inflow | decimal | 超大单净流入 |
| large_net_inflow | decimal | 大单净流入 |
| medium_net_inflow | decimal | 中单净流入 |
| small_net_inflow | decimal | 小单净流入 |
| sector_name | string | 所属板块 |
| source | string | 数据来源 |

页面用途：

- 主力资金异动榜。
- 板块龙头归因。
- 基金持仓个股资金流映射。

## 4. 基金持仓与映射资产

### 4.1 基金股票持仓：`fund_stock_holding`

来源：AKShare `fund_portfolio_hold_em()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| fund_code | string | 基金代码 |
| report_year | string | 年份 |
| report_quarter | string | 季度 |
| stock_code | string | 股票代码 |
| stock_name | string | 股票名称 |
| nav_weight | decimal | 占净值比例，单位 % |
| shares | decimal | 持股数，单位万股 |
| market_value | decimal | 持仓市值，单位万元 |
| source | string | 数据来源 |
| fetched_at | datetime | 采集时间 |

用途：

- 基金持仓穿透。
- 基金对某行业 / 概念 / 热门股的暴露。
- 主力资金流映射到基金。

### 4.2 基金行业配置：`fund_industry_allocation`

来源：AKShare `fund_portfolio_industry_allocation_em()`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| fund_code | string | 基金代码 |
| report_year | string | 年份 |
| report_date | date | 截止时间 |
| industry_name | string | 行业类别 |
| nav_weight | decimal | 占净值比例，单位 % |
| market_value | decimal | 市值，单位万元 |
| source | string | 数据来源 |

用途：

- 基金行业暴露分析。
- 行业资金流映射到基金。
- 基金风格画像。

### 4.3 基金-板块映射：`fund_sector_mapping`

来源：内部计算，由 `fund_index_master`、`fund_stock_holding`、`fund_industry_allocation`、板块成分股数据共同生成。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| fund_code | string | 基金代码 |
| fund_name | string | 基金名称 |
| sector_type | string | 行业 / 概念 / 指数 |
| sector_name | string | 板块名称 |
| exposure_weight | decimal | 暴露权重 |
| mapping_method | string | index_track / holding_weight / industry_allocation / manual_tag |
| confidence | decimal | 映射置信度 |
| updated_at | datetime | 更新时间 |

建议映射优先级：

1. 指数基金：优先用跟踪标的。
2. ETF：优先用基金名称、跟踪指数、场内品类。
3. 主动基金：优先用持仓和行业配置。
4. 无法自动识别：使用人工标签。

## 5. 指标资产

### 5.1 资金热度指标：`sector_heat_score`

用于衡量板块资金强弱。

建议公式：

```text
sector_heat_score =
  zscore(今日主力净流入) * 0.35
+ zscore(今日主力净占比) * 0.25
+ zscore(5日主力净流入) * 0.20
+ zscore(涨跌幅) * 0.10
+ zscore(成交额变化) * 0.10
```

### 5.2 资金持续性指标：`flow_persistence_score`

用于判断板块不是一日游。

```text
flow_persistence_score =
  sign(今日主力净流入)
+ sign(5日主力净流入)
+ sign(10日主力净流入)
+ 连续净流入天数加分
```

### 5.3 资金背离指标：`flow_divergence_signal`

典型场景：

| 信号 | 说明 |
| --- | --- |
| price_up_flow_out | 板块涨，但主力净流出，可能是冲高出货 |
| price_down_flow_in | 板块跌，但主力净流入，可能是承接或提前埋伏 |
| retail_institution_diverge | 小单流入、主力流出，风险偏高 |
| super_large_attack | 超大单显著流入，可能为机构 / 大资金推动 |

### 5.4 基金观察分：`fund_watch_score`

用于把板块资金映射到基金。

```text
fund_watch_score =
  sector_heat_score * exposure_weight * 0.45
+ flow_persistence_score * 0.20
+ fund_liquidity_score * 0.15
+ fund_recent_return_score * 0.10
- risk_penalty * 0.10
```

注意：该分数只能用于「观察优先级」，不能展示为买入建议。

## 6. 页面资产

### 6.1 大盘资金概览

核心组件：

- 今日主力净流入总览。
- 行业 / 概念 / 地域资金流 Top N。
- 超大单净流入 Top N。
- 资金流入 / 流出结构图。
- 市场涨跌家数、成交额、指数表现。

### 6.2 板块资金流页面

核心组件：

- 行业资金流榜。
- 概念资金流榜。
- 今日 / 5 日 / 10 日切换。
- 主力、超大单、大单、中单、小单切换。
- 板块历史资金流趋势。
- 资金背离标签。

### 6.3 ETF / 指数基金热度榜

核心组件：

- 资金热度映射基金榜。
- 跟踪标的。
- 近 1 周 / 近 1 月 / 年内收益。
- 折溢价 / 流动性提示。
- 暴露板块标签。

### 6.4 主力资金异动榜

核心组件：

- 个股主力净流入 Top N。
- 个股主力净流出 Top N。
- 所属板块。
- 是否被热门基金重仓。
- 资金异动原因标签。

### 6.5 基金详情页

核心组件：

- 净值走势。
- 近期收益。
- 行业配置。
- 重仓股。
- 对热门板块的暴露。
- 重仓股资金流变化。

## 7. 第一阶段必须先落的数据表

MVP 只需要先做下面 8 张表：

| 优先级 | 表名 | 原因 |
| --- | --- | --- |
| P0 | `fund_master` | 基金基础搜索和关联 |
| P0 | `fund_index_master` | ETF / 指数基金映射核心 |
| P0 | `fund_nav_daily` | 基金净值和涨跌 |
| P0 | `etf_market_daily` | ETF 页面核心 |
| P0 | `sector_flow_rank_daily` | 板块资金流核心 |
| P0 | `sector_flow_history` | 趋势和异动计算 |
| P1 | `stock_flow_rank_daily` | 主力资金异动 |
| P1 | `fund_sector_mapping` | 资金流映射到基金 |

## 8. 不建议第一阶段做的资产

- 高频 Tick 数据。
- 分钟级全市场行情。
- 复杂回测系统。
- 自动买卖建议。
- 付费数据强依赖。
- 未经缓存的前端实时直连第三方接口。
