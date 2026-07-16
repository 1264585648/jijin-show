# jijin-show

基金大盘展示与资金流分析项目。

本项目先围绕「基金大盘」需要的数据源和数据资产做基础梳理，并逐步实现采集任务、缓存服务、前端页面和异动告警。

## 当前进展

已完成第七版 **板块实时热力图 MVP**：

- 行业板块 / 概念板块切换
- 涨跌热力 / 资金热力 / 综合热度切换
- 成交额 / 资金规模 / 总市值面积口径切换
- 板块搜索过滤
- 涨幅榜、主力流入榜、异动板块榜
- ETF 观察池：根据当前板块热度、资金、涨幅、扩散度生成可观察基金列表
- ETF 实时行情接入：支持涨跌幅、成交额、溢折价字段
- ETF 流动性过滤：成交额过低的 ETF 会被降权并排序靠后
- ETF 溢折价风险提示：高溢折价会显示「溢价谨慎」并扣分
- 热力图 Tooltip
- 手动刷新和 15 秒自动刷新
- 基于真实接口源时间记录行情脉冲，相同快照不重复写入
- 点击板块查看详情标签页：板块概览、成份股、相关 ETF、资金结构
- 新增 FastAPI 后端适配器，可通过 AKShare 获取真实行业 / 概念板块行情、资金流、成份股和 ETF 行情
- 前端执行 real-only 策略：部分、推导、测试或模拟响应会被拒绝并直接报错
- Docker Compose 一键启动、冒烟测试、基础 CI
- 纯静态页面可部署到 GitHub Pages / Cloudflare Pages，后端可单独部署

## 运行方式一：只启动前端静态页

因为当前页面使用了 ES Module，建议使用本地静态服务预览。

```bash
python3 -m http.server 5173
```

然后访问。未配置真实 API 时页面会直接显示数据错误，不会生成替代行情：

```text
http://localhost:5173
```

也可以使用任意静态服务器，例如：

```bash
npx serve .
```

## 运行方式二：前端 + 真实后端

### 1. 启动后端

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Windows PowerShell：

```powershell
cd server
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```text
http://localhost:8000/api/health
```

### 2. 启动前端

回到仓库根目录：

```bash
python3 -m http.server 5173
```

访问：

```text
http://localhost:5173
```

### 3. 切换真实接口

在浏览器控制台执行：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
location.reload();
```

断开接口（页面会直接报错）：

```js
localStorage.removeItem('JIJIN_API_BASE');
location.reload();
```

## 运行方式三：Docker Compose

```bash
docker compose up --build
```

默认服务：

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 | `http://localhost:8000` |
| 健康检查 | `http://localhost:8000/api/health` |

## 后端接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/sector/heatmap?type=industry&period=today` | 行业板块热力图数据 |
| `GET /api/sector/heatmap?type=concept&period=today` | 概念板块热力图数据 |
| `GET /api/sector/{sector_code}/stocks?type=industry` | 行业板块成份股 |
| `GET /api/sector/{sector_code}/stocks?type=concept` | 概念板块成份股 |
| `GET /api/etf/quotes?codes=512480,159995,515230` | ETF 实时行情 |

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
| [docs/heatmap-mvp.md](docs/heatmap-mvp.md) | 板块实时热力图实现说明、指标和后续接入计划 |
| [docs/etf-mapping.md](docs/etf-mapping.md) | 板块到 ETF / 指数基金的映射规则、评分和后续扩展 |
| [docs/etf-realtime-quotes.md](docs/etf-realtime-quotes.md) | ETF 实时行情接入和观察池评分增强 |
| [docs/etf-risk-filtering.md](docs/etf-risk-filtering.md) | ETF 流动性与溢折价风险过滤设计 |
| [docs/deployment.md](docs/deployment.md) | 部署、Docker Compose、冒烟测试和常见问题 |
| [server/README.md](server/README.md) | FastAPI + AKShare 后端接口说明 |
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
| P0 | ETF / 指数基金观察池 | 把板块资金流映射到可观察基金，并过滤流动性与溢折价风险 |
| P0 | 大盘资金概览 | 看市场整体强弱、主力净流入方向 |
| P0 | 行业板块资金流 | 看资金正在攻击哪些行业 |
| P0 | 概念板块资金流 | 看主题热点和短线资金方向 |
| P1 | 主力资金异动榜 | 识别异常流入 / 流出个股及所属板块 |
| P1 | 资金持续性看板 | 比较今日、5 日、10 日资金流 |
| P1 | 基金持仓与行业暴露 | 连接基金持仓、行业配置和板块资金 |
| P2 | 异动告警 | 资金突增、背离、连续流入、风险提示 |

## 热力图数据模型

前端通过 `src/services/sector-api.js` 读取真实接口数据。没有配置 `JIJIN_API_BASE`、接口字段缺失、响应为 partial/derived，或来源标记为测试/模拟时，页面会直接报错并停止展示对应数据。

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
  relatedEtfs: ['515230 软件ETF', '159819 人工智能ETF'],
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

## ETF 观察池

当前通过 `src/data/etf-map.js` 做本地规则映射：

```text
板块名称 + 板块分类 -> 命中关键词 -> ETF 候选
```

观察池评分：

```text
ETF score =
  hotScore
+ mainNetInRatio * 2
+ changePct * 1.8
+ riseRatio * 0.08
+ ETF 行情加成
- 流动性惩罚
- 溢折价风险惩罚
```

风险信号优先级：

```text
流动性不足 > 溢价谨慎 > 高热观察 > 加入观察 > 低优先级
```

后续真实版本建议维护 `sector_etf_map` 表，并合并 ETF 实时涨跌幅、成交额、基金规模、溢折价、费率和基金公司等信息。

## 数据使用原则

- 免费公开接口适合 MVP 和个人研究，但字段、频率、限流都可能变化。
- 采集任务必须做缓存、限速、重试和字段兼容。
- 不把第三方网页接口直接暴露给前端。
- 不把采集到的大体量原始数据提交到 Git 仓库。
- 项目输出仅用于信息展示和研究，不构成投资建议。

## 目录规划

```text
jijin-show/
├── .github/                 # GitHub Actions CI
├── config/                  # 数据源、任务、环境配置模板
├── docs/                    # 数据源、数据资产、采集计划、部署文档
├── data/                    # 本地数据目录，仅放 README，不提交数据文件
├── scripts/                 # 冒烟测试等脚本
├── server/                  # FastAPI + AKShare 后端适配器
│   ├── Dockerfile
│   ├── main.py
│   ├── requirements.txt
│   └── README.md
├── src/                     # 当前静态页面代码，后续也可迁移为 web/src
│   ├── data/                # ETF 静态映射规则（不包含行情数据）
│   ├── services/            # 前端数据适配层
│   ├── main.js              # 热力图交互逻辑
│   ├── styles.css           # 页面基础样式
│   ├── realtime.css         # 自动刷新、详情页、成份股等增强样式
│   └── etf-quotes.css       # ETF 行情字段样式
├── docker-compose.yml       # 本地一键启动
├── index.html               # 当前静态前端入口
└── package.json             # 前端模块语法校验脚本
```

## 下一步建议

1. 增加「隐藏低流动性 ETF」开关和最低成交额筛选项。
2. 增加板块分时走势弹窗。
3. 增加“异动板块”独立筛选视图，例如强势共振、资金抢筹、高位分歧、板块退潮。
4. 用 `sector_flow_rank_daily` 和 `fund_index_master` 做第一版「板块资金流 -> ETF / 指数基金」映射归档。
5. 给后端增加日志、失败重试、字段快照和单元测试。
