# 部署与验证指南

## 方案一：纯前端 Mock 预览

适合快速看页面，不需要后端、不需要 AKShare。

```bash
python3 -m http.server 5173
```

访问：

```text
http://localhost:5173
```

## 方案二：本地真实后端

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

在仓库根目录：

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

恢复 Mock：

```js
localStorage.removeItem('JIJIN_API_BASE');
location.reload();
```

## 方案三：Docker Compose 一键启动

```bash
docker compose up --build
```

默认端口：

| 服务 | 地址 |
| --- | --- |
| 前端 | `http://localhost:5173` |
| 后端 | `http://localhost:8000` |
| 健康检查 | `http://localhost:8000/api/health` |

停止：

```bash
docker compose down
```

## API 冒烟测试

启动后端后执行：

```bash
bash scripts/smoke-test.sh
```

指定其他后端地址：

```bash
JIJIN_API_BASE=http://localhost:8000 bash scripts/smoke-test.sh
```

当前会验证：

```text
/api/health
/api/sector/heatmap?type=industry&period=today
/api/sector/heatmap?type=concept&period=today
/api/etf/quotes?codes=512480,159995,515230
```

## GitHub Actions

当前 CI 做基础校验：

1. 安装后端依赖。
2. 导入 FastAPI 应用，确认 `server/main.py` 基础可用。
3. 使用 `node --check` 校验主要前端模块语法。

文件位置：

```text
.github/workflows/ci.yml
```

## 生产部署建议

### 前端

前端是纯静态页面，可以部署到：

- GitHub Pages
- Cloudflare Pages
- Nginx
- OSS / COS 静态网站托管

### 后端

后端依赖 AKShare 和第三方数据源，建议单独部署：

- VPS + Docker Compose
- Render / Railway / Fly.io
- 内网服务器

生产环境建议：

1. 不要把第三方数据源直接暴露给浏览器。
2. 后端增加固定域名，例如 `https://api.example.com`。
3. 前端通过 `localStorage.JIJIN_API_BASE` 或后续配置文件指向后端。
4. 后端增加日志、重试、字段快照和限流。
5. AKShare 数据可能因上游字段变化而失败，必须保留 Mock / 缓存兜底。

## 常见问题

### 1. 页面显示 Mock 模拟盘中

说明还没有设置真实后端地址。打开浏览器控制台执行：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
location.reload();
```

### 2. 真实接口设置后仍然是模拟数据

前端会在后端接口失败时自动回退 Mock。请检查：

```text
http://localhost:8000/api/health
```

以及浏览器控制台是否有接口错误。

### 3. ETF 行情为空

可能原因：

- 后端未启动。
- AKShare 当前接口字段变化。
- 查询的 ETF 代码不在 `fund_etf_spot_em` 返回结果中。

优先检查：

```text
http://localhost:8000/api/etf/quotes?codes=512480,159995,515230
```
