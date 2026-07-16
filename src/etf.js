import { fetchSectorHeatmap, fetchEtfQuotes, getApiBase } from './services/sector-api.js';
import {
  buildEtfQuoteMap,
  buildEtfWatchlist,
  collectEtfLabelsFromSectors,
} from './data/etf-map.js';

const state = {
  sectors: [],
  items: [],
  signal: 'all',
  query: '',
  sort: 'score',
  loading: false,
  stale: false,
  sourceUpdatedAt: null,
  lastTrigger: null,
  closeTimer: null,
};

const els = {
  dataState: document.querySelector('#dataState'),
  refreshBtn: document.querySelector('#refreshBtn'),
  updatedAt: document.querySelector('#updatedAt'),
  dataNotice: document.querySelector('#dataNotice'),
  noticeText: document.querySelector('#noticeText'),
  searchInput: document.querySelector('#searchInput'),
  priorityCount: document.querySelector('#priorityCount'),
  priorityList: document.querySelector('#priorityList'),
  etfList: document.querySelector('#etfList'),
  sortButton: document.querySelector('#sortButton'),
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
    name: String(item.name || '未命名板块'),
    category: String(item.category || '市场'),
    changePct: finite(item.changePct),
    amount: finite(item.amount),
    mainNetIn: finite(item.mainNetIn),
    mainNetInRatio: finite(item.mainNetInRatio),
    hotScore: finite(item.hotScore),
    upCount,
    downCount,
    riseRatio: total ? (upCount / total) * 100 : 0,
  };
}

function setDataState(label, tone) {
  els.dataState.classList.toggle('is-live', tone === 'live');
  els.dataState.classList.toggle('is-error', tone === 'error');
  els.dataState.querySelector('span').textContent = label;
}

function itemName(item) {
  return item.quote?.name || item.label.replace(/^\d{6}\s*/, '');
}

function getFilteredItems() {
  const query = state.query.trim().toLowerCase();
  let items = state.items.filter((item) => {
    if (state.signal === 'hot' && item.signal !== '高热观察') return false;
    if (state.signal === 'liquid' && !['high', 'medium'].includes(item.quoteInfo?.liquidityLevel)) return false;
    if (!query) return true;
    return `${item.code} ${itemName(item)} ${item.sectors.join(' ')}`.toLowerCase().includes(query);
  });

  if (state.sort === 'amount') items = items.sort((a, b) => finite(b.quote?.amount) - finite(a.quote?.amount));
  else if (state.sort === 'change') items = items.sort((a, b) => finite(b.quote?.changePct) - finite(a.quote?.changePct));
  else items = items.sort((a, b) => b.score - a.score);
  return items;
}

function quoteSummary(item) {
  if (!item.quote) return 'ETF行情待更新';
  return `成交 ${finite(item.quote.amount).toFixed(1)}亿 · 溢折 ${formatPercent(item.quote.premiumRate)}`;
}

function observationReason(item) {
  const sectorText = item.sectors.length ? item.sectors.join('、') : '关联板块';
  if (item.signal === '高热观察') return `${sectorText}的涨幅、资金和扩散度形成较强共振。`;
  if (item.signal === '加入观察') return `${sectorText}出现资金信号，可继续观察持续性。`;
  if (item.signal === '溢价谨慎') return `${sectorText}具备热度，但当前溢折价风险需要优先确认。`;
  if (item.signal === '流动性不足') return `${sectorText}存在映射关系，但成交活跃度不足。`;
  return `${sectorText}当前信号偏弱，暂列低优先级观察。`;
}

function primaryRisk(item) {
  const tags = item.quoteInfo?.riskTags || [];
  if (!item.quote) return 'ETF实时行情尚未返回，成交额与溢折价无法确认。';
  if (tags.includes('高溢折风险')) return '溢折价偏离较大，注意价格回归风险。';
  if (tags.includes('流动性不足')) return '成交活跃度不足，注意买卖价差和冲击成本。';
  if (item.score >= 78) return '短线热度较高，注意冲高回落和板块分化。';
  return '板块资金可能变化，需结合后续扩散与成交验证。';
}

function renderPriority(items) {
  const priority = items.slice(0, 3);
  els.priorityCount.textContent = `${priority.length} 只`;
  if (!priority.length) {
    els.priorityList.innerHTML = '<div class="priority-empty">当前筛选条件下暂无优先观察项</div>';
    return;
  }

  els.priorityList.innerHTML = priority.map((item, index) => {
    const change = item.quote?.changePct;
    return `
      <article class="priority-card" data-etf-code="${escapeHtml(item.code)}" data-rank="${index + 1}" tabindex="0" role="button" aria-label="查看${escapeHtml(itemName(item))}详情">
        <div class="priority-top">
          <div><strong>${escapeHtml(itemName(item))}</strong><span>${escapeHtml(item.code)} · ${escapeHtml(item.sectors.join(' / ') || '关联方向待确认')}</span></div>
          <span class="score-ring"><span><strong>${item.score.toFixed(0)}</strong><small>观察分</small></span></span>
        </div>
        <div class="priority-quote"><strong class="${valueClass(change)}">${item.quote ? formatPercent(change) : '--'}</strong><span>${item.signal}</span></div>
        <p class="priority-reason">${escapeHtml(observationReason(item))}</p>
      </article>
    `;
  }).join('');
}

function renderList(items) {
  if (!items.length) {
    els.etfList.innerHTML = '<div class="page-empty"><strong>暂无符合条件的ETF</strong><span>可以切换筛选或清除搜索词。</span></div>';
    return;
  }

  els.etfList.innerHTML = items.map((item) => {
    const change = item.quote?.changePct;
    const risks = item.quoteInfo?.riskTags?.slice(0, 2) || ['行情待更新'];
    return `
      <button class="etf-row" type="button" data-etf-code="${escapeHtml(item.code)}">
        <span class="etf-primary">
          <span class="etf-name-line"><strong>${escapeHtml(itemName(item))}</strong><i class="score-badge">${item.score.toFixed(0)}分</i></span>
          <span class="etf-code">${escapeHtml(item.code)} · ${escapeHtml(item.sectors.join(' / ') || '关联方向待确认')}</span>
          <span class="risk-tags">${risks.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</span>
        </span>
        <span class="etf-quote">
          <strong class="${valueClass(change)}">${item.quote ? formatPercent(change) : '--'}</strong>
          <span>${escapeHtml(quoteSummary(item))}</span>
        </span>
      </button>
    `;
  }).join('');
}

function render() {
  const items = getFilteredItems();
  renderPriority(items);
  renderList(items);
}

function renderSheet(item) {
  const change = item.quote?.changePct;
  const risks = item.quoteInfo?.riskTags || ['ETF行情待更新'];
  els.sheetContent.innerHTML = `
    <div class="sheet-title-row">
      <div>
        <span class="page-kicker">${escapeHtml(item.code)} · ETF观察</span>
        <h2>${escapeHtml(itemName(item))}</h2>
        <p><span class="sheet-tag">${escapeHtml(item.signal)}</span></p>
      </div>
      <strong class="sheet-value ${valueClass(change)}">${item.quote ? formatPercent(change) : '--'}</strong>
    </div>
    <div class="sheet-metrics">
      <div><span>观察分</span><strong>${item.score.toFixed(0)} / 100</strong></div>
      <div><span>成交额</span><strong>${item.quote ? `${finite(item.quote.amount).toFixed(1)}亿` : '待更新'}</strong></div>
      <div><span>溢折价</span><strong class="${valueClass(-Math.abs(finite(item.quote?.premiumRate)))}">${item.quote ? formatPercent(item.quote.premiumRate) : '待更新'}</strong></div>
      <div><span>板块资金</span><strong class="${valueClass(item.fund)}">${formatMoney(item.fund)}</strong></div>
      <div><span>关联主线</span><strong>${escapeHtml(item.sectors.join('、') || '待确认')}</strong></div>
      <div><span>流动性</span><strong>${escapeHtml(item.quoteInfo?.liquidityLabel || '待确认')}</strong></div>
    </div>
    <div class="sheet-section"><span>观察理由</span><p>${escapeHtml(observationReason(item))}</p></div>
    <div class="sheet-section"><span>主要风险</span><p>${escapeHtml(primaryRisk(item))}</p></div>
    <div class="sheet-section"><span>风险标签</span><div class="risk-tags">${risks.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div>
    <a class="sheet-action" href="./heatmap.html">查看关联板块</a>
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
    const result = await fetchSectorHeatmap({ type: 'industry' });
    const sectors = Array.isArray(result) ? result.map(enrichSector).filter((item) => item.name) : [];
    if (!sectors.length) {
      els.dataNotice.classList.remove('is-hidden');
      els.noticeText.textContent = getApiBase() ? '接口未返回板块数据，请稍后重试。' : '尚未配置真实数据接口。';
      setDataState('数据异常', 'error');
      if (!state.items.length) render();
      return;
    }

    state.sectors = sectors;
    const labels = collectEtfLabelsFromSectors(sectors);
    const quotes = await fetchEtfQuotes(labels);
    const quoteMap = buildEtfQuoteMap(quotes);
    state.items = buildEtfWatchlist(sectors, quoteMap, { limit: 100 });
    els.updatedAt.textContent = `数据 ${formatDateTime(state.sourceUpdatedAt || Date.now())}`;

    if (!quotes.length) {
      els.dataNotice.classList.remove('is-hidden');
      els.noticeText.textContent = '板块数据可用，但ETF实时行情暂未返回，成交额与溢折价显示为待更新。';
      setDataState('部分数据', 'error');
    } else if (state.stale) {
      els.dataNotice.classList.remove('is-hidden');
      els.noticeText.textContent = '上游行情暂不可用，当前显示最近一次成功快照。';
      setDataState('缓存数据', 'error');
    } else {
      els.dataNotice.classList.add('is-hidden');
      setDataState('最新快照', 'live');
    }
    render();
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
    state[group.dataset.filter] = filterButton.dataset.value;
    render();
    return;
  }

  const target = event.target.closest('[data-etf-code]');
  if (target) openSheet(state.items.find((item) => item.code === target.dataset.etfCode));
});

els.searchInput.addEventListener('input', () => {
  state.query = els.searchInput.value;
  render();
});
els.sortButton.addEventListener('click', () => {
  const order = ['score', 'amount', 'change'];
  state.sort = order[(order.indexOf(state.sort) + 1) % order.length];
  els.sortButton.textContent = state.sort === 'amount' ? '按成交额 ↓' : state.sort === 'change' ? '按涨幅 ↓' : '按评分 ↓';
  render();
});
els.refreshBtn.addEventListener('click', loadData);
els.sheetClose.addEventListener('click', closeSheet);
els.sheetBackdrop.addEventListener('click', closeSheet);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeSheet();
  if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches('.priority-card')) {
    event.preventDefault();
    document.activeElement.click();
  }
});
window.addEventListener('jijin:api-success', (event) => {
  const payload = event.detail?.payload;
  if (payload?.stale) state.stale = true;
  const timestamp = finite(payload?.snapshotCollectedAt || payload?.updatedAt);
  if (timestamp) {
    const value = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    state.sourceUpdatedAt = Math.max(state.sourceUpdatedAt || 0, value);
    const snapshot = String(payload?.delivery || '').includes('snapshot');
    if (snapshot && Date.now() - value > 30 * 60 * 1000) state.stale = true;
  }
});

loadData();
