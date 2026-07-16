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

function normalizeFundAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  // Compatibility for persisted snapshots generated before the provider
  // boundary fix: those snapshots can contain small raw-yuan residuals mixed
  // with 亿元 values. New responses are normalized in server/main.py.
  return Math.abs(number) >= 1_000 ? number / 100_000_000 : number;
}

function normalizeSectorMoneyFields(node) {
  if (!node || typeof node !== 'object') return node;
  return {
    ...node,
    mainNetIn: normalizeFundAmount(node.mainNetIn),
    superLargeNetIn: normalizeFundAmount(node.superLargeNetIn),
    bigNetIn: normalizeFundAmount(node.bigNetIn),
  };
}

function isRejectedPayload(payload) {
  if (!payload || typeof payload !== 'object') return '接口未返回有效对象';
  if (!String(payload.source || '').trim()) return '接口缺少真实数据来源标识';
  const marker = `${payload.source || ''} ${payload.delivery || ''}`.toLowerCase();
  if (/\b(mock|demo|test|simulated|synthetic)\b/.test(marker)) return '接口返回了测试或模拟数据';
  if (payload.partial === true) return '接口仅返回部分数据';
  if (String(payload.delivery || '').toLowerCase().includes('derived')) return '接口返回了推导数据';
  return '';
}

function rejectPayload(endpoint, reason, detail = null, message = `${reason}，已停止展示`) {
  dispatchApiStatus('error', {
    endpoint,
    message,
    status: 'REAL_DATA_REQUIRED',
    detail,
    updatedAt: Date.now(),
  });
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
      if (error.detail?.error === 'REAL_DATA_UNAVAILABLE') {
        error.message = error.detail.message || '完整真实数据不可用';
        error.status = 'REAL_DATA_REQUIRED';
        error.detail = null;
      }
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
  const endpoint = `/api/sector/heatmap?type=${encodeURIComponent(type)}&period=today`;
  const payload = await fetchJson(endpoint);
  if (!payload) return [];
  const rejectedReason = isRejectedPayload(payload);
  if (rejectedReason) {
    rejectPayload(endpoint, rejectedReason);
    return [];
  }
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const requiredNumericFields = [
    'changePct',
    'amount',
    'marketCap',
    'mainNetIn',
    'mainNetInRatio',
    'superLargeNetIn',
    'bigNetIn',
    'upCount',
    'downCount',
    'turnoverRate',
  ];
  const invalidNode = nodes.find((node) => (
    !node?.id
    || !node?.name
    || requiredNumericFields.some((field) => node[field] === null || node[field] === undefined || !Number.isFinite(Number(node[field])))
  ));
  if (!nodes.length || invalidNode) {
    rejectPayload(endpoint, nodes.length ? '板块数据缺少必需字段' : '接口未返回板块数据');
    return [];
  }
  if (nodes.every((node) => Number(node.amount) === 0)) {
    rejectPayload(endpoint, '成交额字段没有有效数据', null, '成交额字段没有有效数据，已将该字段标记为数据错误');
  }
  return nodes.map(normalizeSectorMoneyFields);
}

export async function fetchSectorStocks(sector) {
  const sectorId = encodeURIComponent(sector.id);
  const sectorType = encodeURIComponent(sector.type || 'industry');
  const endpoint = `/api/sector/${sectorId}/stocks?type=${sectorType}`;
  const payload = await fetchJson(endpoint);
  if (!payload) return { ok: false, stocks: [], error: '完整真实成份股数据不可用' };
  const rejectedReason = isRejectedPayload(payload);
  if (rejectedReason) {
    rejectPayload(endpoint, rejectedReason);
    return { ok: false, stocks: [], error: `${rejectedReason}，未展示任何成份股` };
  }
  const stocks = Array.isArray(payload.stocks) ? payload.stocks : [];
  const requiredNumericFields = ['price', 'changePct', 'amount', 'turnoverRate', 'fundNetIn'];
  const invalidStock = stocks.find((stock) => (
    !stock?.code
    || !stock?.name
    || requiredNumericFields.some((field) => stock[field] === null || stock[field] === undefined || !Number.isFinite(Number(stock[field])))
  ));
  if (!stocks.length || invalidStock) {
    const reason = stocks.length ? '成份股数据缺少必需字段' : '接口未返回成份股数据';
    rejectPayload(endpoint, reason);
    return { ok: false, stocks: [], error: `${reason}，未展示任何成份股` };
  }
  return { ok: true, stocks, error: '' };
}

export async function fetchEtfQuotes(labels = []) {
  const uniqueLabels = [...new Set(labels.filter(Boolean))];
  const codes = [...new Set(uniqueLabels.map(parseEtfCode).filter(Boolean))];
  if (!codes.length) return [];

  const endpoint = `/api/etf/quotes?codes=${codes.join(',')}`;
  const payload = await fetchJson(endpoint);
  if (!payload) return [];
  const rejectedReason = isRejectedPayload(payload);
  if (rejectedReason) {
    rejectPayload(endpoint, rejectedReason);
    return [];
  }
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  const requiredNumericFields = ['price', 'changePct', 'amount', 'premiumRate'];
  const validQuotes = quotes.filter((quote) => (
    quote?.code
    && quote?.name
    && requiredNumericFields.every((field) => quote[field] !== null && quote[field] !== undefined && Number.isFinite(Number(quote[field])))
  ));
  if (validQuotes.length !== quotes.length) {
    rejectPayload(endpoint, `ETF 行情有 ${quotes.length - validQuotes.length} 条缺少必需字段`);
  }
  const returnedCodes = new Set(validQuotes.map((quote) => String(quote.code)));
  const missingCodes = codes.filter((code) => !returnedCodes.has(code));
  if (missingCodes.length) {
    rejectPayload(endpoint, `ETF 真实行情缺失 ${missingCodes.length} 只`, `缺失代码：${missingCodes.join(', ')}`);
  }
  return validQuotes;
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
