# Cloudflare Pages 部署说明

本项目采用「静态前端 + 独立后端」部署方式。

```text
Cloudflare Pages
  └── index.html / src/* 静态前端

Render / Railway / Fly.io / VPS
  └── server/main.py FastAPI 后端
```

## 1. 只部署前端 Mock 版本

如果只想先展示页面，不接真实后端，可以直接把仓库接入 Cloudflare Pages。

推荐配置：

| 配置项 | 值 |
| --- | --- |
| Framework preset | `None` |
| Production branch | `main` |
| Build command | `exit 0` |
| Build output directory | `.` |

部署完成后，页面会默认使用前端 Mock 数据。

## 2. 前端接入线上后端

后端单独部署完成后，修改：

```text
src/config.js
```

把 `API_BASE` 改成真实后端地址：

```js
window.JIJIN_CONFIG = {
  API_BASE: 'https://your-api-domain.com',
};
```

注意：地址末尾不需要 `/`。

前端会请求：

```text
GET https://your-api-domain.com/api/sector/heatmap?type=industry&period=today
GET https://your-api-domain.com/api/sector/heatmap?type=concept&period=today
GET https://your-api-domain.com/api/sector/{sector_code}/stocks?type=industry
GET https://your-api-domain.com/api/etf/quotes?codes=512480,159995
```

## 3. 本地调试真实后端

本地启动后端：

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

本地启动前端：

```bash
python3 -m http.server 5173
```

浏览器访问：

```text
http://localhost:5173
```

临时切换到本地后端：

```js
localStorage.setItem('JIJIN_API_BASE', 'http://localhost:8000');
location.reload();
```

恢复 Mock：

```js
localStorage.removeItem('JIJIN_API_BASE');
location.reload();
```

## 4. CORS 注意事项

当前 FastAPI 后端默认允许所有来源，适合本地 Demo。

上线后建议把 `server/main.py` 里的 CORS 从：

```python
allow_origins=["*"]
```

改成你的 Cloudflare Pages 域名，例如：

```python
allow_origins=[
    "https://jijin-show.pages.dev",
    "https://your-custom-domain.com",
]
```

## 5. 推荐上线架构

第一版推荐：

```text
前端：Cloudflare Pages
后端：Render / Railway / Fly.io / VPS
数据源：AKShare
缓存：后端 TTLCache，后续可升级 Redis
```

不建议第一版把 AKShare + pandas + FastAPI 直接迁到 Cloudflare Workers。当前项目后端依赖 Python 科学计算和财经数据库，单独部署更稳。