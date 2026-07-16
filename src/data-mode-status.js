import { getApiBase, getDataModeLabel } from './services/sector-api.js';

const apiErrors = new Map();
const SNAPSHOT_STALE_AFTER_MS = 30 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function ensureStatusBanner() {
  let banner = document.querySelector('#apiStatusBanner');
  if (banner) return banner;

  banner = document.createElement('section');
  banner.id = 'apiStatusBanner';
  banner.className = 'api-status-banner is-hidden';

  const topbar = document.querySelector('.topbar');
  topbar?.insertAdjacentElement('afterend', banner);
  return banner;
}

function formatErrorDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (detail.message || detail.error) return [detail.message, detail.error].filter(Boolean).join('：');
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

function renderApiBanner() {
  const banner = ensureStatusBanner();
  const errors = [...apiErrors.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  if (!errors.length) {
    banner.classList.add('is-hidden');
    banner.innerHTML = '';
    return;
  }

  const latest = errors[0];
  banner.classList.remove('is-hidden');
  banner.innerHTML = `
    <div>
      <strong>数据接口不可用</strong>
      <p>${escapeHtml(latest.endpoint)} · ${escapeHtml(latest.message)}</p>
      ${latest.detail ? `<p class="api-error-detail">${escapeHtml(formatErrorDetail(latest.detail))}</p>` : ''}
    </div>
    <button id="apiStatusDismiss" type="button">知道了</button>
  `;

  document.querySelector('#apiStatusDismiss')?.addEventListener('click', () => {
    apiErrors.clear();
    renderApiBanner();
  });
}

function formatTimestamp(value) {
  const number = Number(value || 0);
  if (!number) return '';
  const timestamp = number < 1e12 ? number * 1000 : number;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

function renderDataMode(payload = null) {
  const label = document.querySelector('#dataModeLabel');
  if (!label) return;

  const mode = getDataModeLabel();
  const apiBase = getApiBase();
  if (payload && mode === '真实接口') {
    const timestamp = formatTimestamp(payload.updatedAt);
    const rawTimestamp = Number(payload.updatedAt || 0);
    const timestampMs = rawTimestamp ? (rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp) : 0;
    const snapshot = String(payload.delivery || '').includes('snapshot');
    const stale = payload.stale === true || (snapshot && timestampMs > 0 && Date.now() - timestampMs > SNAPSHOT_STALE_AFTER_MS);
    label.textContent = stale ? '缓存快照' : '最新快照';
    label.title = `${stale ? '当前显示最近成功快照' : '当前数据快照'}${timestamp ? ` · ${timestamp}` : ''}`;
  } else {
    label.textContent = mode === '真实接口' ? '真实数据接口' : '未连接后端';
    label.title = mode === '真实接口'
      ? `当前连接后端接口：${apiBase}`
      : '当前没有人工行情兜底；请配置 window.JIJIN_CONFIG.API_BASE 或 localStorage.JIJIN_API_BASE';
  }
}

function injectEtfQuoteStyles() {
  if (document.querySelector('link[href="./src/etf-quotes.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './src/etf-quotes.css';
  document.head.appendChild(link);
}

function bindApiEvents() {
  window.addEventListener('jijin:api-error', (event) => {
    const detail = event.detail || {};
    if (detail.endpoint) apiErrors.set(detail.endpoint, detail);
    renderApiBanner();
  });

  window.addEventListener('jijin:api-success', (event) => {
    const endpoint = event.detail?.endpoint;
    if (!endpoint) return;
    apiErrors.delete(endpoint);
    renderApiBanner();
    if (String(endpoint).includes('/api/sector/heatmap')) renderDataMode(event.detail?.payload || null);
  });
}

injectEtfQuoteStyles();
bindApiEvents();
renderDataMode();
window.addEventListener('storage', renderDataMode);
