# Changelog

## 0.8.0

### Added

- ETF 观察池新增交互式筛选控件。
- 支持隐藏低流动性 ETF。
- 支持只看高热观察 ETF。
- 支持最低成交额阈值：不限、1 亿、5 亿、20 亿。
- ETF 观察池新增风险标签展示，例如高流动性、流动性不足、溢折正常、高溢折风险、追高谨慎。
- 新增 `docs/etf-watchlist-filters.md`，记录筛选交互和数据流。

### Changed

- `buildEtfWatchlist` 支持第三个参数 `filters`。
- ETF 筛选变化时只重绘左侧榜单，避免热力图和详情面板闪动。
- `package.json` 版本升级到 `0.8.0`。

## 0.7.0

### Added

- ETF 流动性分层。
- ETF 溢折价风险分层。
- 低流动性 ETF 降权。
- 高溢折价 ETF 风险提示。
- 新增 `docs/etf-risk-filtering.md`。

## 0.6.0

### Added

- Dockerfile、Docker Compose、API 冒烟测试脚本和基础 CI。
- 新增部署文档 `docs/deployment.md`。
