# 数据源与接口梳理

更新时间：2026-07-06

本文档用于沉淀基金大盘项目可依赖的数据接口、开源项目、接入优先级和风险边界。

## 选型结论

| 优先级 | 数据源 | 定位 | 适合阶段 | 是否建议作为主源 |
| --- | --- | --- | --- | --- |
| P0 | AKShare | 免费开源 Python 财经数据接口库 | MVP / 个人研究 / 低频采集 | 是 |
| P1 | EFinance | 轻量级行情与基金数据补充库 | 快速补充 / 备用源 | 否，建议备用 |
| P1 | Tushare Pro | 标准化数据与长期归档 | 正式化 / 稳定历史库 | 后期接入 |
| P2 | QStock | 量化研究、可视化、策略研究参考 | Demo / 研究参考 | 否 |
| P2 | 东方财富 / 天天基金页面 | 原始公开网页数据 | 人工核验 / 来源说明 | 不建议直接硬爬 |

## P0：AKShare

建议作为第一阶段主数据源。理由：覆盖基金、ETF、A 股行情、板块资金流、个股主力资金流，调用成本低，适合快速形成数据资产。

### 资金流相关接口

| 数据资产 | 接口 | 说明 | 建议刷新 |
| --- | --- | --- | --- |
| 行业 / 概念 / 地域板块资金流排名 | `stock_sector_fund_flow_rank(indicator, sector_type)` | 支持 `今日`、`5日`、`10日`；支持 `行业资金流`、`概念资金流`、`地域资金流` | 盘中低频 + 收盘后 |
| 行业历史资金流 | `stock_sector_fund_flow_hist(symbol)` | 单个行业近期历史资金流，包含主力、超大单、大单、中单、小单 | 每日收盘后 |
| 概念历史资金流 | `stock_concept_fund_flow_hist(symbol)` | 单个概念近期历史资金流 | 每日收盘后 |
| 个股资金流排名 | `stock_individual_fund_flow_rank(indicator)` | 支持今日、3 日、5 日、10 日等维度 | 盘中低频 + 收盘后 |
| 主力净流入排名 | `stock_main_fund_flow(symbol)` | 支持全部股票、沪深 A 股、沪市 A 股、科创板、深市 A 股、创业板等 | 盘中低频 + 收盘后 |

示例：

```python
import akshare as ak

# 行业板块今日资金流
sector_flow = ak.stock_sector_fund_flow_rank(
    indicator="今日",
    sector_type="行业资金流",
)

# 概念板块 5 日资金流
concept_flow_5d = ak.stock_sector_fund_flow_rank(
    indicator="5日",
    sector_type="概念资金流",
)

# 行业历史资金流
sector_hist = ak.stock_sector_fund_flow_hist(symbol="汽车服务")

# 概念历史资金流
concept_hist = ak.stock_concept_fund_flow_hist(symbol="数据要素")

# 个股主力资金排名
stock_flow = ak.stock_individual_fund_flow_rank(indicator="今日")

# 主力净流入排名
main_flow = ak.stock_main_fund_flow(symbol="沪深A股")
```

### 基金 / ETF 相关接口

| 数据资产 | 接口 | 说明 | 建议刷新 |
| --- | --- | --- | --- |
| 基金基础信息 | `fund_name_em()` | 所有基金基础信息：基金代码、简称、类型等 | 每日 / 每周 |
| 指数基金信息 | `fund_info_index_em(symbol, indicator)` | 指数型基金，包含跟踪标的、跟踪方式、阶段收益 | 每日收盘后 |
| 开放式基金实时净值 | `fund_open_fund_daily_em()` | 天天基金开放式基金数据，交易日 16:00-23:00 更新 | 每日 20:00 后 |
| 场内交易基金 / ETF 数据 | `fund_etf_fund_daily_em()` | 场内基金、ETF 实时数据，交易日 16:00-23:00 更新 | 每日 20:00 后 |
| 基金持仓 | `fund_portfolio_hold_em(symbol, date)` | 指定基金、年份的股票持仓 | 季报披露后 |
| 基金行业配置 | `fund_portfolio_industry_allocation_em(symbol, date)` | 指定基金、年份的行业配置 | 季报披露后 |
| 基金规模走势 | `fund_aum_trend_em()` | 全市场基金规模走势 | 每月 / 每季 |

示例：

```python
import akshare as ak

fund_master = ak.fund_name_em()
index_funds = ak.fund_info_index_em(symbol="行业主题", indicator="全部")
open_funds = ak.fund_open_fund_daily_em()
etf_funds = ak.fund_etf_fund_daily_em()
fund_holdings = ak.fund_portfolio_hold_em(symbol="000001", date="2024")
fund_industry = ak.fund_portfolio_industry_allocation_em(symbol="000001", date="2024")
fund_aum = ak.fund_aum_trend_em()
```

### A 股行情和市场总貌

| 数据资产 | 接口 | 说明 | 建议刷新 |
| --- | --- | --- | --- |
| 沪深京 A 股实时行情 | `stock_zh_a_spot_em()` | 全 A 实时行情，包含涨跌幅、成交额、总市值、换手率等 | 盘中低频 |
| 上交所市场总貌 | `stock_sse_summary()` | 上交所市场总貌，收盘后统计 | 每日收盘后 |
| 深交所市场总貌 | `stock_szse_summary(date)` | 深交所证券类别统计、成交金额、总市值等 | 每日收盘后 |

## P1：EFinance

定位：备用行情源。适合在 AKShare 某些接口异常时补充基金、股票、ETF 历史和实时行情。

建议用途：

| 数据资产 | 接口示例 | 说明 |
| --- | --- | --- |
| 股票实时行情 | `ef.stock.get_realtime_quotes()` | 获取 A 股等实时行情 |
| 股票 / ETF 历史行情 | `ef.stock.get_quote_history("513050")` | ETF 也可按股票方式获取历史行情 |
| 基金历史净值 | `ef.fund.get_quote_history("161725")` | 获取基金单位净值、累计净值、涨跌幅 |

示例：

```python
import efinance as ef

stock_quotes = ef.stock.get_realtime_quotes()
etf_history = ef.stock.get_quote_history("513050")
fund_history = ef.fund.get_quote_history("161725")
```

接入建议：

- 不作为第一主源。
- 作为 AKShare 异常时的兜底。
- 同一指标要做字段归一化，避免多个来源字段名不一致。

## P1：Tushare Pro

定位：后期稳定归档层。Tushare Pro 有积分和权限体系，不适合作为零成本 MVP 的强依赖，但适合后续补充标准化历史数据。

建议用途：

| 数据资产 | 可能接口 | 说明 |
| --- | --- | --- |
| 公募基金列表 | `fund_basic` | 基础基金信息，适合标准化归档 |
| 基金行情 | `pro_bar(asset="FD")` | 基金行情数据 |
| 个股资金流 | `moneyflow_dc` | 东方财富个股资金流向 |
| 行业 / 概念资金流 | `moneyflow_ind_dc` | 东方财富板块资金流向 |

注意事项：

- Pro 版接口通常有积分门槛。
- 高频接口、分钟接口、ETF 实时参考等可能需要单独权限。
- 适合在项目有稳定需求之后再接入。

## P2：QStock

定位：量化研究和可视化参考。QStock 包含数据获取、可视化、选股、回测模块，也包含板块、ETF、盘口异动、资金流模型等能力。

建议用途：

- 参考可视化设计。
- 快速验证资金流、热点、选股模型。
- 不建议作为核心生产采集源。

## P2：东方财富 / 天天基金网页

这些是很多免费库背后的公开数据来源。项目中建议只作为「来源说明」和「人工核验入口」。

不建议直接依赖前端网页接口的原因：

- 字段名可能变化。
- 可能限流。
- 可能有反爬策略。
- 不适合直接暴露给前端。
- 需要遵守来源网站服务条款。

## 接口可靠性分级

| 等级 | 定义 | 项目处理方式 |
| --- | --- | --- |
| S | 官方授权、稳定 SLA | 后续可作为生产强依赖 |
| A | 开源库封装公开数据，使用广泛 | MVP 主力使用，必须缓存 |
| B | 社区库 / 研究库 | 备用或研究验证 |
| C | 网页非公开接口 | 只做核验，不直接强依赖 |

当前建议：

```text
AKShare：A
EFinance：B
QStock：B
Tushare Pro：S/A，取决于权限和付费情况
东方财富 / 天天基金网页：C
```

## 合规与风险说明

- 免费公开接口主要适合学习、研究、个人项目和低频展示。
- 若项目后续商业化，需要重新评估数据授权、调用频率、缓存策略和来源网站条款。
- 所有资金流、主力资金、板块热度指标都只能作为市场观察，不应直接展示为买卖建议。
