function normalizeApiBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function getApiBase() {
  try {
    const configBase = normalizeApiBase(window.JIJIN_CONFIG?.API_BASE);
    if (configBase) return configBase;

    return normalizeApiBase(window.localStorage.getItem('JIJIN_API_BASE'));
  } catch {
    return '';
  }
}

function parseEtfCode(label) {
  return String(label || '').match(/\b\d{6}\b/)?.[0] || '';
}

function dispatchApiStatus(type, detail) {
  try {
    window.dispatchEvent(new CustomEvent(`jijin:api-${type}`, { detail }));
  } catch {
    // no-op: status events are only for UI hints
  }
}

function getEndpointError(endpoint, error) {
  return {
    endpoint,
    message: error?.message || '接口不可用',
    status: error?.status || null,
    detail: error?.detail || null,
    updatedAt: Date.now(),
  };
}

function requireApiBase(endpoint) {
  const apiBase = getApiBase();
  if (!apiBase) {
    const error = new Error('未配置真实后端地址。请在 src/config.js 设置 API_BASE，或在浏览器 localStorage 设置 JIJIN_API_BASE。');
    error.status = 'NO_API_BASE';
    dispatchApiStatus('error', getEndpointError(endpoint, error));
    return '';
  }
  return apiBase;
}

async function readErrorDetail(response) {
  try {
    const payload = await response.json();
    return payload.detail || payload;
  } catch {
    return await response.text().catch(() => '');
  }
}

async function fetchJson(endpoint) {
  const apiBase = requireApiBase(endpoint);
  if (!apiBase) return null;

  try {
    const response = await fetch(`${apiBase}${endpoint}`);
    if (!response.ok) {
      const error = new Error(`接口请求失败：${response.status} ${response.statusText}`.trim());
      error.status = response.status;
      error.detail = await readErrorDetail(response);
      throw error;
    }

    const payload = await response.json();
    dispatchApiStatus('success', { endpoint, payload, updatedAt: Date.now() });
    return payload;
  } catch (error) {
    dispatchApiStatus('error', getEndpointError(endpoint, error));
    return null;
  }
}

export async function fetchSectorHeatmap({ type = 'industry' } = {}) {
  const payload = await fetchJson(`/api/sector/heatmap?type=${encodeURIComponent(type)}&period=today`);
  return payload?.nodes || [];
}

export async function fetchSectorStocks(sector) {
  const sectorId = encodeURIComponent(sector.id);
  const sectorType = encodeURIComponent(sector.type || 'industry');
  const payload = await fetchJson(`/api/sector/${sectorId}/stocks?type=${sectorType}`);
  return payload?.stocks || [];
}

export async function fetchEtfQuotes(labels = []) {
  const uniqueLabels = [...new Set(labels.filter(Boolean))];
  const codes = uniqueLabels.map(parseEtfCode).filter(Boolean);
  if (!codes.length) return [];

  const payload = await fetchJson(`/api/etf/quotes?codes=${codes.join(',')}`);
  return payload?.quotes || [];
}

export function getDataModeLabel() {
  return getApiBase() ? '真实接口' : '未配置接口';
}

export const SECTOR_API_CONTRACT = {
  heatmap: '/api/sector/heatmap?type=industry&period=today&metric=change',
  detail: '/api/sector/:code/detail',
  stocks: '/api/sector/:code/stocks',
  etfQuotes: '/api/etf/quotes?codes=512480,159995',
};
