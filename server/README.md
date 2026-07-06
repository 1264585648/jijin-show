# Jijin Show Sector API

板块实时热力图后端适配器。

作用：

```text
AKShare / 东方财富原始数据 -> 字段清洗 -> 前端统一 JSON
```

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

## 接口

### 1. 板块热力图

```text
GET /api/sector/heatmap?type=industry&period=today
GET /api/sector/heatmap?type=concept&period=today
```

参数：

| 参数 | 可选值 | 说明 |
| --- | --- | --- |
| `type` | `industry` / `concept` | 行业板块 / 概念板块 |
| `period` | `today` / `5d` / `10d` | 今日 / 5 日 / 10 日资金流 |

返回结构：

```json
{
  "market": "A股",
  "type": "industry",
  "period": "today",
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
  "nodes": [
    {
      "id": "BK0737",
      "name": "软件开发",
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

注意：`stock_board_industry_name_em` / `stock_board_concept_name_em` 不直接返回成交额，当前后端 `amount` 先返回 0。前端可以使用“资金规模 / 总市值”面积口径。后续如需成交额，可对重点板块补调用 spot 接口。

### 2. 板块成份股

```text
GET /api/sector/BK0737/stocks?type=industry
GET /api/sector/BK1128/stocks?type=concept
```

返回结构：

```json
{
  "sectorCode": "BK0737",
  "type": "industry",
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
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

## 前端接入

前端默认使用 Mock 数据。

如果要切换到真实后端，可以在浏览器控制台执行：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
location.reload();
```

恢复 Mock：

```js
localStorage.removeItem('JIJIN_API_BASE');
location.reload();
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

## 限制

- 免费公开接口字段和稳定性可能变化，需要在生产环境增加日志、重试和字段兼容。
- 当前缓存 TTL 为 20 秒，避免前端刷新过快导致数据源压力过大。
- 当前没有做鉴权，只适合本地或内网 Demo。
- 本项目仅做信息展示和研究，不构成投资建议。
