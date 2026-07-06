# ETF 观察池交互筛选

## 本版目标

第八版把 ETF 观察池从「自动评分列表」升级为「可交互筛选列表」。

用户可以在左侧 ETF 观察池中直接筛选：

- 隐藏低流动性 ETF
- 只看高热观察
- 设置最低成交额阈值

这样可以把「看热度」和「看能否交易」结合起来。

## 筛选项

### 1. 隐藏低流动性

开关字段：

```js
state.etfFilters.hideWeakLiquidity
```

作用：

```text
隐藏 liquidityLevel === 'weak' 的 ETF
```

也就是隐藏成交额 `< 1 亿`、被标记为「流动性不足」的 ETF。

### 2. 只看高热

开关字段：

```js
state.etfFilters.onlyHighHeat
```

作用：

```text
只保留 signal === '高热观察' 的 ETF
```

注意：如果 ETF 触发「流动性不足」或「溢价谨慎」，即使基础热度高，也会被风险信号覆盖，不会进入「高热观察」。

### 3. 最低成交额

字段：

```js
state.etfFilters.minAmount
```

当前选项：

| 选项 | 说明 |
| --- | --- |
| `0` | 成交额不限 |
| `1` | 成交额至少 1 亿 |
| `5` | 成交额至少 5 亿 |
| `20` | 成交额至少 20 亿 |

## 前端交互流程

```text
1. 用户点击筛选控件
2. document change 事件捕获 data-etf-filter
3. updateEtfFilter 更新 state.etfFilters
4. renderRanks(getCurrentData()) 只重绘左侧榜单
5. buildEtfWatchlist(data, quoteMap, filters) 重新筛选和排序
```

## 代码位置

```text
src/main.js
src/data/etf-map.js
src/etf-quotes.css
```

关键函数：

```js
renderEtfFilterControls()
updateEtfFilter(target)
buildEtfWatchlist(sectors, quoteMap, filters)
```

## 为什么只重绘左侧榜单

ETF 筛选只影响观察池，不影响：

- 热力图
- 板块详情
- 成份股列表
- 资金结构

因此筛选变化时只调用：

```js
renderRanks(getCurrentData())
```

避免页面其它区域闪动。

## 后续建议

1. 增加筛选状态持久化到 `localStorage`。
2. 增加「重置筛选」按钮。
3. 增加 ETF 搜索框，支持按 ETF 代码 / 名称过滤。
4. 增加「高溢价隐藏」开关。
5. 增加更完整的交易可用性评分，例如成交额、价差、基金规模、跟踪误差。
