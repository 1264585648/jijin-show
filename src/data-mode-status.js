import { getApiBase, getDataModeLabel } from './services/sector-api.js';

function renderDataMode() {
  const label = document.querySelector('#dataModeLabel');
  if (!label) return;

  const mode = getDataModeLabel();
  const apiBase = getApiBase();
  label.textContent = mode === '真实接口' ? 'A 股真实接口' : 'Mock 模拟盘中';
  label.title = mode === '真实接口'
    ? `当前连接后端接口：${apiBase}`
    : '当前使用前端 Mock 数据；可在 src/config.js 配置 API_BASE，或本地设置 localStorage.JIJIN_API_BASE 切换真实接口';
}

function injectEtfQuoteStyles() {
  if (document.querySelector('link[href="./src/etf-quotes.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './src/etf-quotes.css';
  document.head.appendChild(link);
}

injectEtfQuoteStyles();
renderDataMode();
window.addEventListener('storage', renderDataMode);
