# Jijin Show Sector API

板块实时热力图后端适配器。

作用：

```text
AKShare / 东方财富原始数据 -> 字段清洗 -> 前端统一 JSON
```

当前后端用于给 Cloudflare Pages 上的纯前端页面提供真实数据。前端不直接抓第三方网页接口，而是统一请求这个 FastAPI 服务。

## 已完成能力

- 行业板块 / 概念板块热力图
- 今日 / 5 日 / 10 日资金流周期
- 板块 BK 代码自动解析为 AKShare 成份股接口需要的板块名称
- 板块成份股接口
- ETF 实时行情接口
- 统一金额单位为「亿元」
- 字段兼容：适配 AKShare / 东方财富字段名变化
- TTL 缓存，降低上游公开接口压力
- CORS 支持，方便 Cloudflare Pages 前端调用
- 调试接口：查看上游字段、缓存状态
- Dockerfile / Docker Compose / 冒烟测试

## 安装

建议使用 Python 3.10+。

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell：

```powershell
cd server
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 启动

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```text
http://localhost:8000/api/health
```

接口文档：

```text
http://localhost:8000/docs
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `JIJIN_CACHE_TTL` | `30` | 缓存秒数，避免前端频繁刷新打爆上游 |
| `JIJIN_CACHE_MAXSIZE` | `256` | 缓存最大条目数 |
| `JIJIN_CORS_ORIGINS` | `*` | 允许跨域来源；生产可改成 Cloudflare Pages 域名 |

示例：

```bash
JIJIN_CACHE_TTL=60 \
JIJIN_CORS_ORIGINS=https://jijin-show.pages.dev \
uvicorn main:app --host 0.0.0.0 --port 8000
```

## Docker 启动

在仓库根目录执行：

```bash
docker compose up --build
```

默认服务：

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 | `http://localhost:8000` |
| 健康检查 | `http://localhost:8000/api/health` |

## 接口

### 1. 健康检查

```text
GET /api/health
```

返回缓存大小、版本号、数据源和时间戳。

### 2. 板块热力图

```text
GET /api/sector/heatmap?type=industry&period=today&limit=120
GET /api/sector/heatmap?type=concept&period=today&limit=120
```

参数：

| 参数 | 可选值 | 说明 |
| --- | --- | --- |
| `type` | `industry` / `concept` | 行业板块 / 概念板块 |
| `period` | `today` / `5d` / `10d` | 今日 / 5 日 / 10 日资金流 |
| `limit` | `1` - `300` | 返回节点数量 |

返回结构：

```json
{
  "market": "A股",
  "type": "industry",
  "period": "today",
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
  "count": 120,
  "nodes": [
    {
      "id": "BK0737",
      "name": "软件开发",
      "type": "industry",
      "category": "行业",
      "changePct": 2.86,
      "turnoverRate": 3.02,
      "marketCap": 12800,
      "amount": 0,
      "mainNetIn": 23.5,
      "mainNetInRatio": 5.42,
      "superLargeNetIn": 9.8,
      "bigNetIn": 13.7,
      "upCount": 179,
      "downCount": 8,
      "leadingStock": "国投智能",
      "leadingStockChangePct": 20,
      "topFundFlowStock": "云赛智联",
      "relatedEtfs": []
    }
  ]
}
```

### 3. 板块成份股

```text
GET /api/sector/BK0737/stocks?type=industry&limit=50
GET /api/sector/软件开发/stocks?type=industry&limit=50
GET /api/sector/BK1128/stocks?type=concept&limit=50
```

说明：

- 前端可以继续传 `BKxxxx`。
- 后端会先从板块列表中解析出板块名称，再调用 AKShare 成份股接口。
- 如果没有匹配到，会直接用原始参数尝试调用。

返回结构：

```json
{
  "sectorCode": "BK0737",
  "sectorName": "软件开发",
  "type": "industry",
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
  "count": 50,
  "stocks": [
    {
      "code": "000001",
      "name": "示例股票",
      "price": 10.23,
      "changePct": 2.13,
      "amount": 12.6,
      "turnoverRate": 4.18,
      "fundNetIn": 0,
      "role": "成份股"
    }
  ]
}
```

### 4. ETF 实时行情

```text
GET /api/etf/quotes?codes=512480,159995,515230
```

返回结构：

```json
{
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
  "count": 3,
  "quotes": [
    {
      "code": "512480",
      "name": "半导体ETF",
      "price": 0.9123,
      "changePct": 2.31,
      "amount": 18.6,
      "volume": 12345678,
      "premiumRate": 0.08,
      "updatedAt": 1720000000
    }
  ]
}
```

### 5. 缓存状态

```text
GET /api/cache
```

### 6. 上游字段调试

```text
GET /api/debug/columns?type=industry&period=today
```

用于 AKShare / 东方财富字段变化后快速定位问题。

## 冒烟测试

本地启动后，在仓库根目录执行：

```bash
bash scripts/smoke-test.sh
```

指定其他接口地址：

```bash
JIJIN_API_BASE=https://your-api.example.com bash scripts/smoke-test.sh
```

当前会验证：

- `/api/health`
- `/api/cache`
- `/api/sector/heatmap`
- `/api/sector/{sector_code}/stocks`
- `/api/etf/quotes`
- `/api/debug/columns`

## 前端接入

前端不包含 Mock 行情；必须连接真实后端，否则直接显示数据错误。

如果要切换到真实后端，可以在浏览器控制台执行：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
location.reload();
```

断开接口（页面会直接报错）：

```js
localStorage.removeItem('JIJIN_API_BASE');
location.reload();
```

如果后端已经部署到公网，例如：

```text
https://jijin-api.example.com
```

则执行：

```js
localStorage.setItem('JIJIN_API_BASE', 'https://jijin-api.example.com');
location.reload();
```

后续也可以直接改前端 `src/config.js`：

```js
window.JIJIN_CONFIG = {
  API_BASE: 'https://jijin-api.example.com',
};
```

## 数据源说明

当前后端主要使用：

| 数据 | AKShare 接口 |
| --- | --- |
| 行业板块行情 | `stock_board_industry_name_em()` |
| 概念板块行情 | `stock_board_concept_name_em()` |
| 板块资金流 | `stock_sector_fund_flow_rank()` |
| 行业成份股 | `stock_board_industry_cons_em()` |
| 概念成份股 | `stock_board_concept_cons_em()` |
| ETF 实时行情 | `fund_etf_spot_em()` |

## 限制

- 免费公开接口字段和稳定性可能变化；仅允许最近一次真实缓存快照，不允许 Mock、测试或推导行情兜底。
- 当前后端没有鉴权，公开部署时建议只开放 GET，并限制 CORS 来源。
- AKShare 依赖第三方公开数据，偶发失败属于正常风险。
- 本项目仅做信息展示和研究，不构成投资建议。
