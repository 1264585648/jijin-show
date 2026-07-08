# 真实接口模式与海外行情源

更新时间：2026-07-08

## 目标

本次调整的目标是：

1. 前端不再使用任何 Mock 数据。
2. 接口不可用时直接显示错误和空态，避免误看模拟数据。
3. 可替换的行情类接口优先支持海外源。
4. 暂时不替换东方财富式行业 / 概念资金流，因为海外源没有等效字段。

## 当前替换范围

| 模块 | 是否替换 | 当前策略 |
| --- | --- | --- |
| ETF 行情 | 可替换 | 支持 Alpha Vantage / AKShare 切换 |
| 行业 / 概念板块涨跌 | 暂不替换 | 继续使用 AKShare / 东方财富 |
| 板块资金流 | 暂不替换 | 继续使用 AKShare / 东方财富 |
| 主力净流入 | 暂不替换 | 继续使用 AKShare / 东方财富 |
| 成份股 | 暂不替换 | 继续使用 AKShare |

## 启动严格真实接口后端

默认后端入口 `main:app` 保持不变。若要启用“无旧缓存兜底 + 海外 ETF 行情源”，使用新增入口：

```bash
cd server
uvicorn overseas_main:app --host 0.0.0.0 --port 8000
```

## 使用 Alpha Vantage 作为 ETF 行情源

设置环境变量：

```bash
export JIJIN_ETF_QUOTE_PROVIDER=alpha_vantage
export ALPHA_VANTAGE_API_KEY=你的_key
export JIJIN_ALLOW_STALE_CACHE=false
uvicorn overseas_main:app --host 0.0.0.0 --port 8000
```

说明：

- `JIJIN_ETF_QUOTE_PROVIDER=auto` 时，如果配置了 `ALPHA_VANTAGE_API_KEY`，ETF 行情优先走 Alpha Vantage；否则走 AKShare。
- `JIJIN_ALLOW_STALE_CACHE=false` 是默认值。上游失败时直接返回 502，不再用旧缓存伪装正常。
- 如果需要临时保留旧缓存兜底，可显式设置 `JIJIN_ALLOW_STALE_CACHE=true`。

## 前端真实接口配置

本地预览时不会再回退 Mock。需要手动设置真实后端：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://你的后端IP:8000');
location.reload();
```

Cloudflare Pages 线上环境默认走同源 `/api/*`。如果没有配置代理或后端不可用，页面会显示“数据接口不可用”。

## Alpha Vantage 字段差异

Alpha Vantage 可以提供 ETF / 股票价格、涨跌幅、成交量等行情字段，但没有东方财富的 ETF 溢折价字段。因此后端会返回：

```json
{
  "premiumRateAvailable": false,
  "amountEstimated": true,
  "source": "Alpha Vantage",
  "note": "成交额按 price * volume 估算；溢折价不可用"
}
```

前端应把这类字段视为“行情兜底”，不能等同于东方财富完整 ETF 数据。

## 不再使用 Mock 后的表现

接口失败时：

1. 热力图不展示模拟板块。
2. ETF 观察池不展示模拟行情。
3. 页面顶部出现错误提示，展示失败接口和错误详情。
4. 后端返回 502，方便直接定位哪个接口不可用。
