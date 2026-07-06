# ETF 实时行情接入说明

## 本版目标

第五版把 ETF 观察池从「本地规则评分」升级为：

```text
板块热度 + 板块资金 + 板块扩散度 + ETF 实时行情
```

这样左侧 ETF 观察池不再只显示一个抽象分数，而是可以同时看到：

- ETF 涨跌幅
- ETF 成交额
- ETF 溢折价
- 关联板块
- 观察信号

## 新增后端接口

```text
GET /api/etf/quotes?codes=512480,159995,515230
```

返回结构：

```json
{
  "source": "AKShare / 东方财富",
  "updatedAt": 1720000000,
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

## 前端适配

新增 / 更新文件：

```text
src/services/sector-api.js       # 新增 fetchEtfQuotes
src/data/etf-map.js              # 新增 quoteMap 合并逻辑
src/main.js                      # 刷新板块后同步刷新 ETF 行情
src/etf-quotes.css               # ETF 行情字段样式
src/data-mode-status.js          # 动态注入 ETF 行情样式
```

## 数据刷新流程

```text
1. fetchSectorHeatmap 获取板块数据
2. enrichSector 补全板块热度、异动标签、ETF 映射
3. collectEtfLabelsFromSectors 收集需要查询的 ETF
4. fetchEtfQuotes 拉取 ETF 行情
5. buildEtfQuoteMap 构建 code -> quote 映射
6. buildEtfWatchlist 合并板块热度和 ETF 行情
7. 左侧 ETF 观察池和右侧 ETF Tab 展示最新结果
```

## 观察池评分增强

基础分：

```text
sector.hotScore
+ sector.mainNetInRatio * 2
+ sector.changePct * 1.8
+ sector.riseRatio * 0.08
```

行情加成：

```text
ETF 涨跌幅 * 1.5
+ log10(ETF 成交额 + 1) * 2
- abs(ETF 溢折价) * 1.2
```

最终分数限制在 0 到 100。

## Mock / 真实接口兼容

前端默认还是 Mock 数据。

如果设置了：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
```

则会调用真实后端：

```text
/api/sector/heatmap
/api/sector/{sector_code}/stocks
/api/etf/quotes
```

如果真实接口失败，前端会自动回退到 Mock ETF 行情，避免页面空白。

## 下一步

建议继续增强：

1. 增加 ETF 规模、基金公司、费率等静态字段。
2. 加入 ETF 流动性过滤，默认隐藏成交额过低的 ETF。
3. 增加溢价风险标签，例如「高溢价谨慎」。
4. 建立后端 `sector_etf_map` 表，把本地 JS 规则迁移到可维护数据表。
5. 增加 ETF 历史表现接口，支持 5 日 / 10 日趋势。
