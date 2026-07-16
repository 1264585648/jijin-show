import { fetchSectorHeatmap, getApiBase } from './services/sector-api.js';

const state = {
  type: 'industry',
  sort: 'inflow',
  data: [],
  loading: false,
  lastError: null,
  stale: false,
  sourceUpdatedAt: null,
  visibleCount: 24,
  lastTrigger: null,
  closeTimer: null,
};

const els = {
  dataState: document.querySelector('#dataState'),
  refreshBtn: document.querySelector('#refreshBtn'),
  updatedAt: document.querySelector('#updatedAt'),
  dataNotice: document.querySelector('#dataNotice'),
  noticeText: document.querySelector('#noticeText'),
  totalFund: document.querySelector('#totalFund'),
  inflowCount: document.querySelector('#inflowCount'),
  signalCount: document.querySelector('#signalCount'),
  signalSummary: document.querySelector('#signalSummary'),
  signalPills: document.querySelector('#signalPills'),
  listTitle: document.querySelector('#listTitle'),
  resultCount: document.querySelector('#resultCount'),
  flowList: document.querySelector('#flowList'),
  sheetBackdrop: document.querySelector('#sheetBackdrop'),
  detailSheet: document.querySelector('#detailSheet'),
  sheetClose: document.querySelector('#sheetClose'),
  sheetContent: document.querySelector('#sheetContent'),
};

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatPercent(value, digits = 2) {
  const number = finite(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}%`;
}

function formatMoney(value, digits = 1) {
  const number = finite(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}亿`;
}

function valueClass(value) {
  return finite(value) > 0 ? 'positive' : finite(value) < 0 ? 'negative' : 'neutral';
}

function formatDateTime(timestamp = Date.now()) {
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

function enrichSector(item) {
  const upCount = finite(item.upCount);
  const downCount = finite(item.downCount);
  const total = upCount + downCount;
  return {
    ...item,
    id: String(item.id || ''),
    name: String(item.name || '未命名板块'),
    category: String(item.category || '市场'),
    changePct: finite(item.changePct),
    amount: finite(item.amount),
    mainNetIn: finite(item.mainNetIn),
    mainNetInRatio: finite(item.mainNetInRatio),
    turnoverRate: finite(item.turnoverRate),
    superLargeNetIn: finite(item.superLargeNetIn),
    bigNetIn: finite(item.bigNetIn),
    upCount,
    downCount,
    riseRatio: total ? (upCount / total) * 100 : 0,
  };
}

function getSignal(item) {
  if (item.changePct >= 1 && item.mainNetIn > 0 && item.riseRatio >= 65) return { label: '强势共振', tone: 'positive' };
  if (item.changePct > 0 && item.mainNetIn < 0) return { label: '涨价流出', tone: 'negative' };
  if (item.changePct < 0 && item.mainNetIn > 0) return { label: '逆势吸筹', tone: 'positive' };
  if (item.changePct <= -1 && item.mainNetIn < 0) return { label: '同步走弱', tone: 'negative' };
  if (item.mainNetInRatio >= 3) return { label: '资金集中', tone: 'positive' };
  if (item.mainNetInRatio <= -3) return { label: '流出集中', tone: 'negative' };
  return { label: '常规波动', tone: 'neutral' };
}

function getSortedData() {
  const data = [...state.data];
  if (state.sort === 'outflow') return data.sort((a, b) => a.mainNetIn - b.mainNetIn);
  if (state.sort === 'change') return data.sort((a, b) => b.changePct - a.changePct);
  if (state.sort === 'breadth') return data.sort((a, b) => b.riseRatio - a.riseRatio);
  return data.sort((a, b) => b.mainNetIn - a.mainNetIn);
}

function setDataState(label, tone) {
  els.dataState.classList.toggle('is-live', tone === 'live');
  els.dataState.classList.toggle('is-error', tone === 'error');
  els.dataState.querySelector('span').textContent = label;
}

function renderSummary() {
  const topInflow = [...state.data].sort((a, b) => b.mainNetIn - a.mainNetIn)[0];
  const inflows = state.data.filter((item) => item.mainNetIn > 0).length;
  const signals = state.data.filter((item) => getSignal(item).label !== '常规波动').length;
  els.totalFund.previousElementSibling.textContent = topInflow ? `${topInflow.name}居前` : '流入居前';
  els.totalFund.textContent = topInflow ? formatMoney(topInflow.mainNetIn) : '--';
  els.totalFund.className = topInflow ? valueClass(topInflow.mainNetIn) : 'neutral';
  els.totalFund.title = topInflow ? `${topInflow.name} ${formatMoney(topInflow.mainNetIn)}` : '';
  els.inflowCount.textContent = `${inflows}个`;
  els.signalCount.textContent = `${signals}个`;
}

function renderSignals() {
  const resonance = state.data
    .filter((item) => getSignal(item).label === '强势共振')
    .sort((a, b) => b.mainNetIn - a.mainNetIn)[0];
  const divergence = state.data
    .filter((item) => ['涨价流出', '逆势吸筹'].includes(getSignal(item).label))
    .sort((a, b) => Math.abs(b.mainNetIn) - Math.abs(a.mainNetIn))[0];
  const weak = state.data
    .filter((item) => getSignal(item).label === '同步走弱')
    .sort((a, b) => a.mainNetIn - b.mainNetIn)[0];
  const signals = [resonance, divergence, weak].filter(Boolean);

  els.signalSummary.textContent = signals.length ? `${signals.length} 类重点信号` : '暂无显著信号';
  els.signalPills.innerHTML = signals.length
    ? signals.map((item) => {
      const signal = getSignal(item);
      return `
        <button class="signal-pill" type="button" data-sector-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(signal.label)} · ${escapeHtml(item.name)}</strong>
          <span>涨跌 ${formatPercent(item.changePct)} · 主力 ${formatMoney(item.mainNetIn)}</span>
        </button>
      `;
    }).join('')
    : '<span class="empty-inline">当前数据未识别到明显共振或背离</span>';
}

function renderList() {
  const data = getSortedData();
  const visibleData = data.slice(0, state.visibleCount);
  const titles = { inflow: '主力净流入', outflow: '主力净流出', change: '板块涨跌幅', breadth: '内部扩散度' };
  els.listTitle.textContent = titles[state.sort];
  els.resultCount.textContent = `${data.length} 个板块`;

  if (!data.length) {
    els.flowList.innerHTML = '<div class="page-empty"><strong>暂无板块资金数据</strong><span>请检查真实接口后重试。</span></div>';
    return;
  }

  const maxAbsFund = Math.max(...data.map((item) => Math.abs(item.mainNetIn)), 1);
  els.flowList.innerHTML = visibleData.map((item) => {
    const signal = getSignal(item);
    return `
      <button class="flow-row" type="button" data-sector-id="${escapeHtml(item.id)}">
        <span class="flow-primary">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.category)} · 扩散 ${item.riseRatio.toFixed(0)}%</span>
          <span class="row-tags"><span>${escapeHtml(signal.label)}</span></span>
        </span>
        <span class="flow-numbers">
          <strong class="${valueClass(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong>
          <span class="${valueClass(item.changePct)}">${formatPercent(item.changePct)}</span>
        </span>
        <span class="flow-track" aria-label="资金规模相对强度"><i class="${item.mainNetIn < 0 ? 'is-negative' : ''}" style="width:${Math.max(3, Math.abs(item.mainNetIn) / maxAbsFund * 100)}%"></i></span>
      </button>
    `;
  }).join('') + (visibleData.length < data.length
    ? `<button class="load-more" type="button" data-load-more>再显示 ${Math.min(24, data.length - visibleData.length)} 个板块</button>`
    : '');
}

function render() {
  renderSummary();
  renderSignals();
  renderList();
}

function renderSheet(item) {
  const signal = getSignal(item);
  els.sheetContent.innerHTML = `
    <div class="sheet-title-row">
      <div>
        <span class="page-kicker">${escapeHtml(item.category)} · ${escapeHtml(item.id)}</span>
        <h2>${escapeHtml(item.name)}</h2>
        <p><span class="sheet-tag">${escapeHtml(signal.label)}</span></p>
      </div>
      <strong class="sheet-value ${valueClass(item.changePct)}">${formatPercent(item.changePct)}</strong>
    </div>
    <div class="sheet-metrics">
      <div><span>主力净流入</span><strong class="${valueClass(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong></div>
      <div><span>主力净占比</span><strong class="${valueClass(item.mainNetInRatio)}">${formatPercent(item.mainNetInRatio)}</strong></div>
      <div><span>成交额</span><strong>${item.amount > 0 ? `${item.amount.toFixed(1)}亿` : '待更新'}</strong></div>
      <div><span>内部扩散</span><strong>${item.riseRatio.toFixed(0)}%</strong></div>
      <div><span>上涨 / 下跌</span><strong>${item.upCount} / ${item.downCount}</strong></div>
      <div><span>换手率</span><strong>${formatPercent(item.turnoverRate)}</strong></div>
    </div>
    <div class="sheet-section"><span>当前判断</span><p>${escapeHtml(item.name)}当前为“${escapeHtml(signal.label)}”，价格${item.changePct >= 0 ? '上涨' : '下跌'}且主力资金${item.mainNetIn >= 0 ? '净流入' : '净流出'}，内部上涨家数占比${item.riseRatio.toFixed(0)}%。</p></div>
    <div class="sheet-section"><span>资金结构</span><p>超大单 ${formatMoney(item.superLargeNetIn)} · 大单 ${formatMoney(item.bigNetIn)}</p></div>
    <a class="sheet-action" href="./heatmap.html?type=${encodeURIComponent(item.type || state.type)}&sector=${encodeURIComponent(item.id)}">在板块热力中查看</a>
  `;
}

function openSheet(item) {
  if (!item) return;
  window.clearTimeout(state.closeTimer);
  state.lastTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  renderSheet(item);
  els.sheetBackdrop.hidden = false;
  window.requestAnimationFrame(() => els.sheetBackdrop.classList.add('is-visible'));
  els.detailSheet.classList.add('is-open');
  els.detailSheet.setAttribute('aria-hidden', 'false');
  els.detailSheet.inert = false;
  document.body.classList.add('sheet-open');
  els.sheetClose.focus();
}

function closeSheet() {
  els.sheetBackdrop.classList.remove('is-visible');
  els.detailSheet.classList.remove('is-open');
  els.detailSheet.setAttribute('aria-hidden', 'true');
  els.detailSheet.inert = true;
  document.body.classList.remove('sheet-open');
  window.clearTimeout(state.closeTimer);
  state.closeTimer = window.setTimeout(() => {
    if (!els.sheetBackdrop.classList.contains('is-visible')) els.sheetBackdrop.hidden = true;
  }, 190);
  if (state.lastTrigger?.isConnected) state.lastTrigger.focus();
}

function setLoading(loading) {
  state.loading = loading;
  els.refreshBtn.disabled = loading;
  els.refreshBtn.classList.toggle('is-loading', loading);
}

async function loadData() {
  if (state.loading) return;
  setLoading(true);
  state.stale = false;
  state.sourceUpdatedAt = null;
  setDataState('更新中', 'loading');
  try {
    const result = await fetchSectorHeatmap({ type: state.type });
    const data = Array.isArray(result) ? result.map(enrichSector).filter((item) => item.id && item.name) : [];
    if (data.length) {
      state.data = data;
      state.lastError = null;
      els.updatedAt.textContent = `数据 ${formatDateTime(state.sourceUpdatedAt || Date.now())}`;
      if (state.stale) {
        els.dataNotice.classList.remove('is-hidden');
        els.noticeText.textContent = '上游行情暂不可用，当前显示最近一次成功快照。';
        setDataState('缓存数据', 'error');
      } else {
        els.dataNotice.classList.add('is-hidden');
        setDataState('最新快照', 'live');
      }
      render();
    } else {
      state.lastError = new Error(getApiBase() ? '接口未返回板块数据' : '尚未配置真实数据接口');
      els.dataNotice.classList.remove('is-hidden');
      els.noticeText.textContent = state.lastError.message;
      setDataState('数据异常', 'error');
      if (!state.data.length) render();
    }
  } finally {
    setLoading(false);
  }
}

document.addEventListener('click', (event) => {
  const filterButton = event.target.closest('[data-filter] .filter-chip');
  if (filterButton) {
    const group = filterButton.closest('[data-filter]');
    group.querySelectorAll('.filter-chip').forEach((button) => {
      const isActive = button === filterButton;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
    const key = group.dataset.filter;
    const nextValue = filterButton.dataset.value;
    if (key === 'type' && nextValue !== state.type) {
      state.type = nextValue;
      state.data = [];
      state.visibleCount = 24;
      render();
      loadData();
    } else if (key === 'sort') {
      state.sort = nextValue;
      state.visibleCount = 24;
      renderList();
    }
    return;
  }

  const target = event.target.closest('[data-sector-id]');
  if (target) openSheet(state.data.find((item) => item.id === target.dataset.sectorId));
  if (event.target.closest('[data-load-more]')) {
    state.visibleCount += 24;
    renderList();
  }
});

els.refreshBtn.addEventListener('click', loadData);
els.sheetClose.addEventListener('click', closeSheet);
els.sheetBackdrop.addEventListener('click', closeSheet);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSheet();
});
window.addEventListener('jijin:api-error', (event) => {
  state.lastError = event.detail || new Error('接口不可用');
});
window.addEventListener('jijin:api-success', (event) => {
  const payload = event.detail?.payload;
  const timestamp = finite(payload?.snapshotCollectedAt || payload?.updatedAt);
  if (timestamp) {
    const value = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    state.sourceUpdatedAt = value;
    const snapshot = String(payload?.delivery || '').includes('snapshot');
    if (snapshot && Date.now() - value > 30 * 60 * 1000) state.stale = true;
  }
  if (payload?.stale) state.stale = true;
});

loadData();
