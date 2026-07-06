# jijin-show

基金大盘展示与资金流分析项目。

本项目先围绕「基金大盘」需要的数据源和数据资产做基础梳理，并逐步实现采集任务、缓存服务、前端页面和异动告警。

## 当前进展

已完成第一版 **板块实时热力图 MVP**：

- 行业板块 / 概念板块切换
- 涨跌热力 / 资金热力 / 综合热度切换
- 成交额 / 资金规模 / 总市值面积口径切换
- 板块搜索过滤
- 涨幅榜、主力流入榜、综合热度榜
- 热力图 Tooltip
- 点击板块查看详情、资金结构、扩散度、领涨股、相关 ETF
- 纯静态页面，可部署到 GitHub Pages / Cloudflare Pages

## 本地预览

因为当前页面使用了 ES Module，建议使用本地静态服务预览。

```bash
python3 -m http.server 5173
```

然后访问：

```text
http://localhost:5173
```

也可以使用任意静态服务器，例如：

```bash
npx serve .
```

## 项目定位

核心不是简单展示基金净值，而是把下面几类信息组合起来：

1. 基金 / ETF / 指数基金基础信息
2. 基金净值、涨跌、规模、持仓、行业配置
3. A 股市场总貌、指数行情、板块行情
4. 行业 / 概念 / 地域板块资金流
5. 个股主力资金、超大单、大单、中单、小单资金流
6. 资金持续性、背离、异动和基金映射信号

最终目标：回答「今天资金流向哪里，对应哪些基金 / ETF / 指数基金值得观察」。

## 当前已整理内容

| 文档 | 内容 |
| --- | --- |
| [docs/data-sources.md](docs/data-sources.md) | 可依赖的数据接口、开源项目、接入优先级、风险说明 |
| [docs/data-assets.md](docs/data-assets.md) | 推荐沉淀的数据资产、指标资产、页面资产、数据表结构 |
| [docs/ingestion-plan.md](docs/ingestion-plan.md) | 第一阶段采集计划、任务编排、缓存策略、异常处理 |
| [config/data-sources.example.yaml](config/data-sources.example.yaml) | 数据源配置模板，后续可直接用于采集服务 |

## 推荐数据源组合

第一阶段建议采用：

```text
AKShare：主数据源，覆盖基金、ETF、板块资金流、个股资金流
EFinance：备用数据源，补充基金、股票、ETF 行情
QStock：研究和可视化参考，不建议作为核心生产数据源
Tushare Pro：后期稳定归档层，有积分和权限门槛
东方财富 / 天天基金网页：只作为数据来源说明和人工核验，不建议前端直接硬爬
```

## 第一阶段页面优先级

| 优先级 | 页面 | 价值 |
| --- | --- | --- |
| P0 | 板块实时热力图 | 一眼看清行业 / 概念板块涨跌、资金、成交和扩散度 |
| P0 | 大盘资金概览 | 看市场整体强弱、主力净流入方向 |
| P0 | 行业板块资金流 | 看资金正在攻击哪些行业 |
| P0 | 概念板块资金流 | 看主题热点和短线资金方向 |
| P0 | ETF / 指数基金热度榜 | 把资金流映射到可观察基金 |
| P1 | 主力资金异动榜 | 识别异常流入 / 流出个股及所属板块 |
| P1 | 资金持续性看板 | 比较今日、5 日、10 日资金流 |
| P1 | 基金持仓与行业暴露 | 连接基金持仓、行业配置和板块资金 |
| P2 | 异动告警 | 资金突增、背离、连续流入、风险提示 |

## 热力图数据模型

前端当前使用 `src/data/mock-sectors.js` 中的 Mock 数据，字段结构如下：

```js
{
  id: 'BK0737',
  name: '软件开发',
  category: 'TMT',
  changePct: 3.86,
  turnoverRate: 4.82,
  marketCap: 12800,
  amount: 860,
  mainNetIn: 23.5,
  mainNetInRatio: 5.42,
  superLargeNetIn: 9.8,
  bigNetIn: 13.7,
  upCount: 179,
  downCount: 8,
  leadingStock: '国投智能',
  leadingStockChangePct: 20,
  topFundFlowStock: '云赛智联',
  relatedEtfs: ['软件ETF', '信创ETF'],
}
```

单位约定：

| 字段 | 含义 | 单位 |
| --- | --- | --- |
| `changePct` | 板块涨跌幅 | % |
| `turnoverRate` | 换手率 | % |
| `marketCap` | 总市值 | 亿元 |
| `amount` | 成交额 | 亿元 |
| `mainNetIn` | 主力净流入 | 亿元 |
| `mainNetInRatio` | 主力净占比 | % |
| `upCount` | 上涨家数 | 家 |
| `downCount` | 下跌家数 | 家 |

## 真实数据接入建议

后续建议通过后端服务接入 AKShare / 东方财富数据，前端只消费清洗后的统一 JSON。

推荐接口：

```text
GET /api/sector/heatmap?type=industry&period=today&metric=change
GET /api/sector/heatmap?type=concept&period=today&metric=change
GET /api/sector/:code/detail
GET /api/sector/:code/stocks
```

## 数据使用原则

- 免费公开接口适合 MVP 和个人研究，但字段、频率、限流都可能变化。
- 采集任务必须做缓存、限速、重试和字段兼容。
- 不把第三方网页接口直接暴露给前端。
- 不把采集到的大体量原始数据提交到 Git 仓库。
- 项目输出仅用于信息展示和研究，不构成投资建议。

## 目录规划

```text
jijin-show/
├── config/                  # 数据源、任务、环境配置模板
├── docs/                    # 数据源、数据资产、采集计划
├── data/                    # 本地数据目录，仅放 README，不提交数据文件
├── src/                     # 当前静态页面代码，后续也可迁移为 web/src
│   ├── data/                # Mock 数据和后续前端适配层
│   ├── main.js              # 热力图交互逻辑
│   └── styles.css           # 页面样式
├── index.html               # 当前静态前端入口
└── web/                     # 后续如果引入 Vite / React，可迁移到该目录
```

## 下一步建议

1. 增加后端 API 适配层，把 Mock 数据替换为实时数据。
2. 增加板块分时走势弹窗。
3. 增加 ETF 映射表，点击板块后展示可交易基金。
4. 增加数据刷新策略，例如 15 秒或 30 秒轮询。
5. 增加“异动板块”独立列表，例如强势共振、资金抢筹、高位分歧、板块退潮。
6. 用 `sector_flow_rank_daily` 和 `fund_index_master` 做第一版「板块资金流 -> ETF / 指数基金」映射。
