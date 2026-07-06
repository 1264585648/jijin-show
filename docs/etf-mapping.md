# 板块到 ETF / 指数基金映射设计

## 目标

热力图解决的是「哪里热」。ETF 映射解决的是「热度能落到哪些可观察基金」。

当前第四版新增：

- `src/data/etf-map.js`：本地板块 -> ETF 映射规则。
- 左侧 `ETF 观察池`：根据当前板块热度、资金流、涨幅、扩散度生成 ETF 观察列表。
- 详情页 `相关 ETF` Tab：如果后端没有返回 ETF，也会使用本地映射规则兜底。

## 当前映射方式

采用关键词规则：

```text
板块名称 + 板块分类 -> 命中关键词 -> 返回 ETF 候选
```

示例：

```text
半导体 / 芯片 / CPO / 通信设备 -> 半导体ETF、芯片ETF、通信ETF
软件开发 / 信创 / 数据要素 -> 软件ETF、人工智能ETF、大数据ETF
证券 / 券商 -> 证券ETF、龙头券商ETF
新能源 / 光伏 / 电池 -> 光伏ETF、电池ETF、新能源车ETF
```

## ETF 观察池评分

当前评分在前端临时计算：

```text
ETF score =
  sector.hotScore
+ sector.mainNetInRatio * 2
+ sector.changePct * 1.8
+ sector.riseRatio * 0.08
```

多个板块命中同一个 ETF 时：

- 分数取最高值。
- 主力资金做合计。
- 关联板块最多展示 3 个。

## 信号分层

| 分数 | 信号 |
| --- | --- |
| >= 78 | 高热观察 |
| >= 62 | 加入观察 |
| < 62 | 低优先级 |

## 为什么先用本地映射表

真实基金映射通常需要维护一张稳定表，而不是只靠基金名称模糊匹配。

建议后续沉淀：

```text
sector_etf_map
```

字段建议：

| 字段 | 说明 |
| --- | --- |
| `sector_code` | 板块代码 |
| `sector_name` | 板块名称 |
| `sector_type` | industry / concept |
| `index_code` | 指数代码 |
| `index_name` | 跟踪指数 |
| `fund_code` | ETF / 指数基金代码 |
| `fund_name` | 基金名称 |
| `match_type` | exact / keyword / manual |
| `priority` | 展示优先级 |
| `is_active` | 是否启用 |

## 后续真实数据增强

建议把 ETF 观察池从「规则映射」升级为「实时基金状态」：

| 数据 | 用途 |
| --- | --- |
| ETF 涨跌幅 | 看 ETF 是否已经反映板块行情 |
| ETF 成交额 | 判断交易活跃度 |
| ETF 规模 | 过滤流动性太弱的品种 |
| 溢折价 | 避免高溢价追入 |
| 近 5 日 / 10 日涨跌 | 判断是否已高位加速 |
| 基金持仓行业 | 校验与板块映射是否真实相关 |

## 前端文件

```text
src/data/etf-map.js
```

核心导出：

```js
matchSectorEtfs(sectorName, category)
buildEtfWatchlist(sectors)
normalizeEtfLabel(etf)
```

后续如果后端返回 `relatedEtfs`，前端会优先使用后端数据；如果没有返回，就使用本地规则兜底。
