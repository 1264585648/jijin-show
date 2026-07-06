# 开发与运行说明

本文档说明如何在本地跑通第一版数据采集链路。

## 1. 环境准备

建议使用 Python 3.10+。

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Windows PowerShell：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
```

如果只想安装运行依赖：

```bash
pip install -r requirements.txt
```

## 2. 配置文件

默认使用：

```text
config/data-sources.example.yaml
```

可复制一份本地配置：

```bash
cp config/data-sources.example.yaml config/data-sources.yaml
```

然后通过环境变量指定：

```bash
export JIJIN_SHOW_CONFIG=config/data-sources.yaml
```

Windows PowerShell：

```powershell
$env:JIJIN_SHOW_CONFIG="config/data-sources.yaml"
```

## 3. 查看支持的数据资产

```bash
jijin-show assets
```

当前支持：

```text
fund_master
fund_index_master
fund_nav_daily
etf_market_daily
sector_flow_rank_daily
stock_flow_rank_daily
```

## 4. 采集单个资产

示例：采集板块资金流。

```bash
jijin-show collect sector_flow_rank_daily
```

示例：采集指数基金主数据。

```bash
jijin-show collect fund_index_master
```

## 5. 采集全部 MVP 资产

```bash
jijin-show collect all
```

这会依次采集：

1. 基金基础信息
2. 指数基金信息
3. 开放式基金净值
4. ETF / 场内基金数据
5. 板块资金流排名
6. 个股主力资金流排名

## 6. 生成大盘概览 JSON

```bash
jijin-show overview
```

该命令会：

1. 采集板块资金流。
2. 采集个股资金流。
3. 计算 `sector_heat_score`。
4. 写入 DuckDB。
5. 导出前端 JSON。

输出路径默认在：

```text
public/data/market-overview.json
public/data/sector_heat_score.json
```

## 7. 数据落地位置

默认配置：

```text
data/local/jijin_show.duckdb
public/data/*.json
```

这些文件已被 `.gitignore` 忽略，不会提交到仓库。

## 8. 常见问题

### AKShare 接口返回空

可能原因：

- 非交易日。
- 接口源站短暂不可用。
- 字段或接口发生变化。
- 盘后净值尚未更新。

处理方式：

- 晚些重试。
- 保留上一次成功缓存。
- 不要用空结果覆盖前端旧数据。

### 字段对不上

第三方接口字段可能变化。优先修改：

```text
src/jijin_show/normalizers/fund.py
src/jijin_show/normalizers/flow.py
```

### 运行脚本找不到包

确保先执行：

```bash
pip install -e .
```

或临时设置：

```bash
export PYTHONPATH=src
```

## 9. 下一步开发建议

1. 增加 EFinance 备用采集器。
2. 增加字段快照测试，发现 AKShare 字段变化。
3. 增加前端页面读取 `public/data/*.json`。
4. 增加基金-板块映射任务。
5. 增加 GitHub Actions 或服务器定时任务。
