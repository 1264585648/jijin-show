import { fetchEtfQuotes, fetchSectorHeatmap, fetchSectorStocks } from './services/sector-api.js';
import {
  ETF_WATCHLIST_DEFAULT_FILTERS,
  buildEtfQuoteMap,
  buildEtfWatchlist,
  collectEtfLabelsFromSectors,
  matchSectorEtfs,
  normalizeEtfLabel,
} from './data/etf-map.js';

const REFRESH_INTERVAL_SECONDS = 15;
const MOBILE_HEATMAP_LIMIT = 12;
const SNAPSHOT_STALE_AFTER_MS = 30 * 60 * 1000;
const mobileViewport = window.matchMedia('(max-width: 640px)');
const pageQuery = new URLSearchParams(window.location.search);
const requestedSectorId = pageQuery.get('sector');
const requestedType = pageQuery.get('type') === 'concept' ? 'concept' : 'industry';

const state = {
  type: requestedType,
  mode: 'change',
  area: 'amount',
  query: '',
  selectedId: null,
  activeTab: 'overview',
  rawData: [],
  etfQuotes: new Map(),
  etfFilters: { ...ETF_WATCHLIST_DEFAULT_FILTERS },
  autoRefresh: true,
  countdown: REFRESH_INTERVAL_SECONDS,
  isLoading: false,
  mobileExpanded: false,
  marketMeta: null,
};

const stocksCache = new Map();
const stocksLoadingIds = new Set();

const els = {
  updatedAt: document.querySelector('#updatedAt'),
  summaryGrid: document.querySelector('#summaryGrid'),
  heatmap: document.querySelector('#heatmap'),
  heatmapTitle: document.querySelector('#heatmapTitle'),
  legend: document.querySelector('#legend'),
  rankLists: document.querySelector('#rankLists'),
  detailPanel: document.querySelector('#detailPanel'),
  searchInput: document.querySelector('#searchInput'),
  tooltip: document.querySelector('#tooltip'),
  refreshBtn: document.querySelector('#refreshBtn'),
  autoRefreshToggle: document.querySelector('#autoRefreshToggle'),
  refreshCountdown: document.querySelector('#refreshCountdown'),
  detailBackdrop: document.querySelector('#detailBackdrop'),
};

const MODE_LABELS = {
  change: '涨跌热力',
  fund: '资金热力',
  hot: '综合热度',
};

const TYPE_LABELS = {
  industry: '行业板块',
  concept: '概念板块',
};

const AREA_LABELS = {
  amount: '成交额',
  mainNetInAbs: '资金规模',
  marketCap: '总市值',
};

const TAB_LABELS = {
  overview: '板块概览',
  stocks: '成份股',
  etf: '相关 ETF',
  flow: '资金结构',
};

const MIN_AMOUNT_OPTIONS = [
  { value: 0, label: '成交额不限' },
  { value: 1, label: '1亿+' },
  { value: 5, label: '5亿+' },
  { value: 20, label: '20亿+' },
];

const formatPercent = (value) => `${value > 0 ? '+' : ''}${Number(value || 0).toFixed(2)}%`;
const formatMoney = (value) => `${value > 0 ? '+' : ''}${Number(value || 0).toFixed(1)}亿`;
const classByValue = (value) => (value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function setControlValue(control, value) {
  state[control] = value;
  document.querySelectorAll(`.segmented[data-control="${control}"] button`).forEach((button) => {
    const isActive = button.dataset.value === value;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function enrichSector(sector) {
  const upCount = finite(sector.upCount);
  const downCount = finite(sector.downCount);
  const changePct = finite(sector.changePct);
  const mainNetIn = finite(sector.mainNetIn);
  const mainNetInRatio = finite(sector.mainNetInRatio);
  const turnoverRate = finite(sector.turnoverRate);
  const leadingStockChangePct = finite(sector.leadingStockChangePct);
  const total = upCount + downCount;
  const riseRatio = total ? (upCount / total) * 100 : 0;
  const hotScore = clamp(
    50 + changePct * 6 + mainNetInRatio * 4 + riseRatio * 0.18 + turnoverRate * 1.6 + leadingStockChangePct * 0.5,
    0,
    100,
  );
  const tags = getSectorTags({
    ...sector,
    changePct,
    amount: finite(sector.amount),
    mainNetIn,
    mainNetInRatio,
    turnoverRate,
    leadingStockChangePct,
    riseRatio,
    hotScore,
  });
  const relatedEtfs = sector.relatedEtfs?.length ? sector.relatedEtfs : matchSectorEtfs(sector.name, sector.category);

  return {
    ...sector,
    id: String(sector.id || ''),
    name: String(sector.name || '未命名板块'),
    category: String(sector.category || '市场'),
    changePct,
    amount: finite(sector.amount),
    marketCap: finite(sector.marketCap),
    mainNetIn,
    mainNetInRatio,
    superLargeNetIn: finite(sector.superLargeNetIn),
    bigNetIn: finite(sector.bigNetIn),
    turnoverRate,
    leadingStockChangePct,
    upCount,
    downCount,
    riseRatio,
    hotScore,
    mainNetInAbs: Math.abs(mainNetIn),
    tags,
    relatedEtfs,
  };
}

function getSectorTags(sector) {
  const tags = [];
  if (sector.changePct > 2 && sector.mainNetIn > 0 && sector.riseRatio > 70) tags.push('强势共振');
  if (sector.changePct < 0.8 && sector.mainNetInRatio > 2) tags.push('资金抢筹');
  if (sector.changePct > 1 && sector.mainNetIn < 0) tags.push('高位分歧');
  if (sector.changePct < -1 && sector.mainNetIn < 0 && sector.riseRatio < 45) tags.push('板块退潮');
  if (sector.leadingStockChangePct > 7 && sector.riseRatio < 55) tags.push('龙头独涨');
  if (sector.riseRatio > 80 && sector.amount > 350) tags.push('全面扩散');
  if (sector.turnoverRate > 4.5) tags.push('放量');
  return tags.length ? tags : ['常规波动'];
}

function getCurrentData() {
  const query = state.query.trim().toLowerCase();
  return state.rawData
    .map(enrichSector)
    .filter((item) => {
      if (!query) return true;
      return [
        item.name,
        item.category,
        item.leadingStock,
        item.topFundFlowStock,
        ...(item.relatedEtfs || []).map(normalizeEtfLabel),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
}

function getDisplayValue(item) {
  if (state.mode === 'fund') return item.mainNetInRatio;
  if (state.mode === 'hot') return item.hotScore - 50;
  return item.changePct;
}

function getTileColor(item) {
  const value = getDisplayValue(item);
  const abs = clamp(Math.abs(value), 0, state.mode === 'hot' ? 50 : 6);
  const intensity = state.mode === 'hot' ? abs / 50 : abs / 6;
  const alpha = 0.34 + intensity * 0.56;

  if (state.mode === 'hot') {
    if (item.hotScore >= 75) return `rgba(239, 68, 68, ${alpha})`;
    if (item.hotScore <= 42) return `rgba(34, 197, 94, ${alpha})`;
    return 'rgba(71, 85, 105, 0.72)';
  }

  if (value > 0.12) return `rgba(220, 38, 38, ${alpha})`;
  if (value < -0.12) return `rgba(22, 163, 74, ${alpha})`;
  return 'rgba(71, 85, 105, 0.72)';
}

function getTileSpan(item, data) {
  const values = data.map((d) => d[state.area] || 1);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const raw = item[state.area] || 1;
  const normalized = max === min ? 0.5 : (raw - min) / (max - min);

  if (normalized > 0.86) return { col: 8, row: 4 };
  if (normalized > 0.68) return { col: 7, row: 3 };
  if (normalized > 0.48) return { col: 6, row: 3 };
  if (normalized > 0.28) return { col: 5, row: 2 };
  return { col: 4, row: 2 };
}

function updateRefreshUI() {
  els.refreshCountdown.textContent = state.autoRefresh ? `${state.countdown}s` : '已暂停';
  els.refreshBtn.disabled = state.isLoading;
  els.refreshBtn.classList.toggle('is-loading', state.isLoading);
  const refreshLabel = els.refreshBtn.querySelector('.refresh-button-label');
  if (refreshLabel) refreshLabel.textContent = state.isLoading ? '刷新中...' : '手动刷新';
}

function renderSummary(data) {
  const totalAmount = data.reduce((sum, item) => sum + item.amount, 0);
  const hasAmount = data.some((item) => item.amount > 0);
  const totalFund = data.reduce((sum, item) => sum + item.mainNetIn, 0);
  const avgChange = data.reduce((sum, item) => sum + item.changePct, 0) / Math.max(data.length, 1);
  const strongest = [...data].sort((a, b) => b.hotScore - a.hotScore)[0];
  const resonanceCount = data.filter((item) => item.tags.includes('强势共振')).length;

  const cards = [
    { label: '覆盖板块', value: data.length, suffix: '个', note: `${TYPE_LABELS[state.type]} · ${MODE_LABELS[state.mode]}` },
    {
      label: '样本成交额',
      value: hasAmount ? totalAmount.toFixed(0) : '待更新',
      suffix: hasAmount ? '亿' : '',
      note: hasAmount ? `面积口径：${AREA_LABELS[state.area]}` : '当前快照未提供有效成交额',
    },
    {
      label: '主力净流入',
      value: `${totalFund > 0 ? '+' : ''}${totalFund.toFixed(1)}`,
      suffix: '亿',
      note: totalFund >= 0 ? '整体资金偏流入' : '整体资金偏流出',
      valueClass: classByValue(totalFund),
    },
    {
      label: '主线强度',
      value: resonanceCount,
      suffix: '个',
      note: strongest ? `最热：${strongest.name} · 均涨 ${formatPercent(avgChange)}` : '暂无数据',
      valueClass: resonanceCount > 0 ? 'positive' : 'neutral',
    },
  ];

  els.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <div class="summary-label">${escapeHtml(card.label)}</div>
          <div class="summary-value ${card.valueClass || ''}">${escapeHtml(card.value)}<small>${escapeHtml(card.suffix)}</small></div>
          <div class="summary-note">${escapeHtml(card.note)}</div>
        </article>
      `,
    )
    .join('');
}

function renderLegend() {
  const label = state.mode === 'fund' ? '主力净流入占比' : state.mode === 'hot' ? '综合热度' : '涨跌幅';
  els.legend.innerHTML = `
    <span>弱</span>
    <span class="legend-bar" title="${label}"></span>
    <span>强</span>
  `;
}

function renderHeatmap(data) {
  const sortKey = state.area;
  const sorted = [...data].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const isMobile = mobileViewport.matches;
  const visible = isMobile && !state.mobileExpanded ? sorted.slice(0, MOBILE_HEATMAP_LIMIT) : sorted;
  els.heatmapTitle.textContent = `${TYPE_LABELS[state.type]} · ${MODE_LABELS[state.mode]}`;

  if (!sorted.length) {
    els.heatmap.innerHTML = '<div class="empty-detail"><span>没有匹配的板块</span><p>换个关键词试试。</p></div>';
    return;
  }

  const tiles = visible
    .map((item) => {
      const span = getTileSpan(item, sorted);
      const value = state.mode === 'fund' ? formatPercent(item.mainNetInRatio) : state.mode === 'hot' ? item.hotScore.toFixed(1) : formatPercent(item.changePct);
      const fundBorder = item.mainNetIn >= 0 ? 'rgba(248, 113, 113, 0.72)' : 'rgba(74, 222, 128, 0.72)';
      const selectedClass = item.id === state.selectedId ? ' is-selected' : '';
      const smallClass = span.col <= 4 ? ' tile-small' : '';

      return `
        <button
          class="tile${selectedClass}${smallClass}"
          data-id="${escapeHtml(item.id)}"
          style="grid-column: span ${span.col}; grid-row: span ${span.row}; background:${getTileColor(item)}; border-color:${fundBorder};"
          aria-label="${escapeHtml(item.name)} ${escapeHtml(value)}"
        >
          <div>
            <div class="tile-top">
              <span class="tile-name">${escapeHtml(item.name)}</span>
              <span class="tile-badge">${escapeHtml(item.tags[0])}</span>
            </div>
            <div class="tile-change">${value}${state.mode === 'hot' ? '<small> 分</small>' : ''}</div>
          </div>
          <div class="tile-meta">
            <span>主力 ${formatMoney(item.mainNetIn)}</span>
            <span>${item.upCount}涨 / ${item.downCount}跌 · 扩散 ${item.riseRatio.toFixed(0)}%</span>
            <span>领涨 ${escapeHtml(item.leadingStock || '待更新')} ${formatPercent(item.leadingStockChangePct)}</span>
          </div>
        </button>
      `;
    })
    .join('');

  const toggle = isMobile && sorted.length > MOBILE_HEATMAP_LIMIT
    ? `<button class="mobile-heatmap-toggle" type="button" data-heatmap-toggle aria-expanded="${state.mobileExpanded}">
        ${state.mobileExpanded ? '收起至 Top 12' : `展开全部 ${sorted.length} 个板块`}
      </button>`
    : '';

  els.heatmap.innerHTML = `${tiles}${toggle}`;
}

function getAnomalyList(data) {
  return data
    .filter((item) => item.tags.some((tag) => tag !== '常规波动'))
    .sort((a, b) => b.hotScore - a.hotScore)
    .slice(0, 6);
}

function renderRankBlock(block) {
  return `
    <section class="rank-block">
      <div class="rank-title"><strong>${escapeHtml(block.title)}</strong><span>${escapeHtml(block.caption)}</span></div>
      ${block.list
        .map(
          (item, index) => `
          <div class="rank-item" data-id="${escapeHtml(item.id)}">
            <span class="rank-no">${index + 1}</span>
            <div>
              <div class="rank-name">${escapeHtml(item.name)}</div>
              <div class="rank-meta">${escapeHtml(item.category)} · ${escapeHtml(block.meta(item))}</div>
            </div>
            <strong class="rank-value ${block.valueClass(item)}">${block.value(item)}</strong>
          </div>
        `,
        )
        .join('')}
    </section>
  `;
}

function renderEtfFilterControls() {
  return `
    <div class="etf-filter-panel">
      <label class="etf-filter-check">
        <input type="checkbox" data-etf-filter="hideWeakLiquidity" ${state.etfFilters.hideWeakLiquidity ? 'checked' : ''} />
        <span>隐藏低流动性</span>
      </label>
      <label class="etf-filter-check">
        <input type="checkbox" data-etf-filter="onlyHighHeat" ${state.etfFilters.onlyHighHeat ? 'checked' : ''} />
        <span>只看高热</span>
      </label>
      <select class="etf-filter-select" data-etf-filter="minAmount" aria-label="ETF 最低成交额">
        ${MIN_AMOUNT_OPTIONS.map((option) => `<option value="${option.value}" ${Number(state.etfFilters.minAmount) === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
      </select>
    </div>
  `;
}

function getEtfFilterSummary(watchlist) {
  const filters = [];
  if (state.etfFilters.hideWeakLiquidity) filters.push('已隐藏低流动性');
  if (state.etfFilters.onlyHighHeat) filters.push('仅高热');
  if (Number(state.etfFilters.minAmount) > 0) filters.push(`成交额≥${state.etfFilters.minAmount}亿`);
  return filters.length ? filters.join(' · ') : `Top ${watchlist.length}`;
}

function renderEtfWatchlist(data) {
  const watchlist = buildEtfWatchlist(data, state.etfQuotes, state.etfFilters);

  return `
    <section class="rank-block etf-watch-block">
      <div class="rank-title"><strong>ETF 观察池</strong><span>${escapeHtml(getEtfFilterSummary(watchlist))}</span></div>
      ${renderEtfFilterControls()}
      ${watchlist.length
        ? watchlist
          .map((item, index) => {
            const quote = item.quote;
            const quoteInfo = item.quoteInfo;
            const quoteText = quote ? `${formatPercent(quote.changePct)} · ${quote.amount.toFixed(1)}亿 · 溢折 ${formatPercent(quote.premiumRate || 0)}` : '等待 ETF 行情';
            const riskTags = quoteInfo?.riskTags?.length ? quoteInfo.riskTags.slice(0, 3) : ['等待行情'];
            return `
              <div class="etf-watch-item ${quoteInfo?.tradable === false ? 'is-muted' : ''}">
                <span class="rank-no">${index + 1}</span>
                <div>
                  <div class="rank-name">${escapeHtml(quote?.code || item.code)} ${escapeHtml(quote?.name || item.label.replace(/^\d{6}\s*/, ''))}</div>
                  <div class="rank-meta">${escapeHtml(item.signal)} · ${escapeHtml(item.sectors.join(' / '))}</div>
                  <div class="etf-risk-tags">${riskTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                  <div class="etf-quote-line ${quote ? classByValue(quote.changePct) : 'neutral'}">${escapeHtml(quoteText)}</div>
                </div>
                <strong class="rank-value ${classByValue(item.fund)}">${item.score.toFixed(0)}</strong>
              </div>
            `;
          })
          .join('')
        : '<div class="etf-filter-empty">当前筛选条件下暂无 ETF，可降低成交额阈值或关闭筛选。</div>'}
    </section>
  `;
}

function renderRanks(data) {
  const blocks = [
    {
      title: '涨幅榜',
      caption: 'Top 5',
      list: [...data].sort((a, b) => b.changePct - a.changePct).slice(0, 5),
      meta: (item) => item.tags[0],
      value: (item) => formatPercent(item.changePct),
      valueClass: (item) => classByValue(item.changePct),
    },
    {
      title: '主力流入榜',
      caption: 'Top 5',
      list: [...data].sort((a, b) => b.mainNetIn - a.mainNetIn).slice(0, 5),
      meta: (item) => `净占比 ${formatPercent(item.mainNetInRatio)}`,
      value: (item) => formatMoney(item.mainNetIn),
      valueClass: (item) => classByValue(item.mainNetIn),
    },
    {
      title: '异动板块',
      caption: 'Signal',
      list: getAnomalyList(data),
      meta: (item) => item.tags.slice(0, 2).join(' / '),
      value: (item) => item.hotScore.toFixed(0),
      valueClass: (item) => classByValue(item.hotScore - 50),
    },
  ];

  els.rankLists.innerHTML = `${blocks.map(renderRankBlock).join('')}${renderEtfWatchlist(data)}`;
}

function renderDetail(item) {
  if (!item) {
    els.detailPanel.innerHTML = `
      <button class="detail-sheet-close" type="button" data-close-detail aria-label="关闭板块详情">×</button>
      <div class="empty-detail">
        <span>选择一个板块</span>
        <p>查看资金结构、领涨股、内部扩散度、成份股和相关 ETF。</p>
      </div>
    `;
    return;
  }

  const stocks = stocksCache.get(item.id);
  const isStocksLoading = stocksLoadingIds.has(item.id);

  els.detailPanel.innerHTML = `
    <button class="detail-sheet-close" type="button" data-close-detail aria-label="关闭板块详情">×</button>
    <div class="detail-hero">
      <span class="eyebrow">${escapeHtml(item.category)} · ${escapeHtml(item.id)}</span>
      <h2>${escapeHtml(item.name)}</h2>
      <div class="detail-change ${classByValue(item.changePct)}">${formatPercent(item.changePct)}</div>
      <div class="tag-row">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
    </div>
    <div class="detail-tabs">
      ${Object.entries(TAB_LABELS)
        .map(([key, label]) => `<button class="detail-tab ${state.activeTab === key ? 'is-active' : ''}" data-tab="${key}" type="button">${label}</button>`)
        .join('')}
    </div>
    <div class="detail-tab-content">
      ${renderDetailTab(item, stocks, isStocksLoading)}
    </div>
  `;
}

function renderDetailTab(item, stocks, isStocksLoading) {
  if (state.activeTab === 'stocks') return renderStocksTab(item, stocks, isStocksLoading);
  if (state.activeTab === 'etf') return renderEtfTab(item);
  if (state.activeTab === 'flow') return renderFlowTab(item);
  return renderOverviewTab(item);
}

function renderOverviewTab(item) {
  const hasAmount = item.amount > 0;
  return `
    <div class="metric-list">
      <div class="metric"><span>主力净流入</span><strong class="${classByValue(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong></div>
      <div class="metric"><span>主力净占比</span><strong class="${classByValue(item.mainNetInRatio)}">${formatPercent(item.mainNetInRatio)}</strong></div>
      <div class="metric"><span>成交额</span><strong>${hasAmount ? `${item.amount.toFixed(0)} 亿` : '待更新'}</strong></div>
      <div class="metric"><span>换手率</span><strong>${formatPercent(item.turnoverRate)}</strong></div>
      <div class="metric"><span>上涨家数</span><strong>${item.upCount} 家</strong></div>
      <div class="metric"><span>下跌家数</span><strong>${item.downCount} 家</strong></div>
    </div>
    <section class="detail-section">
      <h3>内部扩散度</h3>
      <div class="progress-track"><div class="progress-fill" style="width:${item.riseRatio}%"></div></div>
      <p class="summary-note">${item.upCount}涨 / ${item.downCount}跌，上涨占比 ${item.riseRatio.toFixed(1)}%</p>
    </section>
    <section class="detail-section">
      <h3>领涨与资金核心</h3>
      <div class="metric-list compact-metrics">
        <div class="metric"><span>领涨股</span><strong>${escapeHtml(item.leadingStock || '待更新')} ${formatPercent(item.leadingStockChangePct)}</strong></div>
        <div class="metric"><span>主力净流入最大股</span><strong>${escapeHtml(item.topFundFlowStock || '待更新')}</strong></div>
      </div>
    </section>
  `;
}

function renderStocksTab(item, stocks, isStocksLoading) {
  if (isStocksLoading && !stocks) return `<div class="loading-box">正在加载 ${escapeHtml(item.name)} 成份股...</div>`;
  if (!stocks?.length) return `<div class="loading-box">暂无成份股数据</div>`;

  return `
    <section class="detail-section full-section">
      <div class="table-headline"><h3>成份股强弱</h3><span>板块快照推导 · 缺失字段显示待更新</span></div>
      <div class="stock-table">
        <div class="stock-row stock-row-head"><span>代码</span><span>名称</span><span>涨跌幅</span><span>主力</span><span>角色</span></div>
        ${stocks
          .map(
            (stock) => {
              const isPartial = !stock.code && Number(stock.amount || 0) === 0 && Number(stock.fundNetIn || 0) === 0;
              return `
            <div class="stock-row">
              <span>${escapeHtml(stock.code || '--')}</span>
              <strong>${escapeHtml(stock.name || '待更新')}</strong>
              <span class="${classByValue(stock.changePct)}">${formatPercent(stock.changePct)}</span>
              <span class="${isPartial ? 'neutral' : classByValue(stock.fundNetIn)}">${isPartial ? '待更新' : formatMoney(stock.fundNetIn)}</span>
              <span>${escapeHtml(stock.role || '成份股')}</span>
            </div>
          `;
            },
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderEtfTab(item) {
  const etfs = item.relatedEtfs?.length ? item.relatedEtfs : matchSectorEtfs(item.name, item.category);
  if (!etfs.length) return `<div class="loading-box">暂无 ETF 映射。后续可在 src/data/etf-map.js 中补充规则。</div>`;

  return `
    <section class="detail-section full-section">
      <div class="table-headline"><h3>相关 ETF / 基金观察</h3><span>板块热度 + ETF 行情</span></div>
      <div class="etf-card-list">
        ${etfs
          .map((etf, index) => {
            const label = normalizeEtfLabel(etf);
            const watch = buildEtfWatchlist([{ ...item, relatedEtfs: [label] }], state.etfQuotes, { ...ETF_WATCHLIST_DEFAULT_FILTERS, limit: 1 })[0];
            const quote = watch?.quote;
            const score = watch?.score ?? clamp(item.hotScore - index * 7 + item.mainNetInRatio * 1.5 + (quote?.changePct || 0) * 1.5, 0, 100);
            const signal = watch?.signal || (score >= 75 ? '高热度' : score >= 58 ? '可观察' : '低优先级');
            const riskTags = watch?.quoteInfo?.riskTags?.length ? watch.quoteInfo.riskTags.slice(0, 3) : ['等待行情'];
            return `
              <article class="etf-card">
                <div>
                  <strong>${escapeHtml(quote?.code || label.match(/\d{6}/)?.[0] || '')} ${escapeHtml(quote?.name || label.replace(/^\d{6}\s*/, ''))}</strong>
                  <span>${escapeHtml(signal)} · ${quote ? `${formatPercent(quote.changePct)} · 成交 ${quote.amount.toFixed(1)}亿 · 溢折 ${formatPercent(quote.premiumRate || 0)}` : '等待 ETF 行情'}</span>
                  <div class="etf-risk-tags">${riskTags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                </div>
                <div class="etf-score ${score >= 70 ? 'positive' : 'neutral'}">${score.toFixed(0)}</div>
              </article>
            `;
          })
          .join('')}
      </div>
      <p class="summary-note">ETF 行情不可用时会明确显示“待更新”，不会使用模拟数据替代。</p>
    </section>
  `;
}

function renderFlowTab(item) {
  const flows = [
    ['超大单', item.superLargeNetIn],
    ['大单', item.bigNetIn],
    ['主力合计', item.mainNetIn],
    ['净占比', item.mainNetInRatio],
  ];
  const maxAbs = Math.max(...flows.map(([, value]) => Math.abs(value)), 1);

  return `
    <section class="detail-section full-section">
      <div class="table-headline"><h3>资金结构</h3><span>看资金是共振流入还是局部分歧</span></div>
      <div class="flow-list">
        ${flows
          .map(
            ([label, value]) => `
            <div class="flow-item">
              <div><span>${label}</span><strong class="${classByValue(value)}">${label === '净占比' ? formatPercent(value) : formatMoney(value)}</strong></div>
              <div class="flow-track"><span class="${value >= 0 ? 'flow-positive' : 'flow-negative'}" style="width:${Math.max(8, (Math.abs(value) / maxAbs) * 100)}%"></span></div>
            </div>
          `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTooltip(item, event) {
  els.tooltip.innerHTML = `
    <h4>${escapeHtml(item.name)} <span class="${classByValue(item.changePct)}">${formatPercent(item.changePct)}</span></h4>
    <div class="tooltip-grid">
      <div><span>成交额</span><strong>${item.amount > 0 ? `${item.amount.toFixed(0)} 亿` : '待更新'}</strong></div>
      <div><span>主力净流入</span><strong class="${classByValue(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong></div>
      <div><span>主力净占比</span><strong class="${classByValue(item.mainNetInRatio)}">${formatPercent(item.mainNetInRatio)}</strong></div>
      <div><span>上涨/下跌</span><strong>${item.upCount} / ${item.downCount}</strong></div>
      <div><span>领涨股</span><strong>${escapeHtml(item.leadingStock || '待更新')}</strong></div>
    </div>
  `;
  els.tooltip.style.left = `${event.clientX + 16}px`;
  els.tooltip.style.top = `${event.clientY + 16}px`;
  els.tooltip.classList.add('is-visible');
}

function hideTooltip() {
  els.tooltip.classList.remove('is-visible');
}

async function ensureStocksForSelected() {
  const item = getCurrentData().find((sector) => sector.id === state.selectedId);
  if (!item || stocksCache.has(item.id) || stocksLoadingIds.has(item.id)) return;

  stocksLoadingIds.add(item.id);
  renderDetail(item);
  const stocks = await fetchSectorStocks(item);
  stocksCache.set(item.id, stocks);
  stocksLoadingIds.delete(item.id);

  const current = getCurrentData().find((sector) => sector.id === state.selectedId);
  if (current?.id === item.id) renderDetail(current);
}

async function refreshEtfQuotes(data) {
  const labels = collectEtfLabelsFromSectors(data);
  const quotes = await fetchEtfQuotes(labels);
  state.etfQuotes = buildEtfQuoteMap(quotes);
}

function selectSector(id) {
  state.selectedId = id;
  const data = getCurrentData();
  const item = data.find((sector) => sector.id === id);
  renderHeatmap(data);
  renderDetail(item);
  ensureStocksForSelected();
  if (item) openMobileDetail();
}

function render() {
  const data = getCurrentData();
  if (state.selectedId && !data.some((item) => item.id === state.selectedId)) state.selectedId = null;
  if (!mobileViewport.matches && !state.selectedId) state.selectedId = data[0]?.id || null;

  const selected = data.find((item) => item.id === state.selectedId);
  const displayTimestamp = state.marketMeta?.updatedAt || Date.now();
  const displayDate = new Date(displayTimestamp);
  const timePrefix = state.marketMeta?.stale ? '缓存于' : state.marketMeta?.snapshot ? '快照' : '数据';
  els.updatedAt.textContent = `${timePrefix} ${displayDate.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`;

  renderSummary(data);
  renderLegend();
  renderRanks(data);
  renderHeatmap(data);
  renderDetail(selected);
  if (!mobileViewport.matches) {
    els.detailPanel.setAttribute('aria-hidden', selected ? 'false' : 'true');
    els.detailPanel.inert = false;
  }
  updateRefreshUI();
  ensureStocksForSelected();
}

async function loadData({ preserveSelected = true, realtime = true } = {}) {
  state.isLoading = true;
  updateRefreshUI();
  const selectedBeforeLoad = state.selectedId;
  state.rawData = await fetchSectorHeatmap({ type: state.type, realtime });
  if (state.area === 'amount' && state.rawData.length && state.rawData.every((item) => Number(item.amount || 0) <= 0)) {
    setControlValue('area', 'mainNetInAbs');
  }
  await refreshEtfQuotes(state.rawData.map(enrichSector));
  state.isLoading = false;
  state.countdown = REFRESH_INTERVAL_SECONDS;

  if (!preserveSelected) state.selectedId = null;
  if (preserveSelected && selectedBeforeLoad) state.selectedId = selectedBeforeLoad;
  if (!preserveSelected && requestedSectorId && state.rawData.some((item) => String(item.id) === requestedSectorId)) {
    state.selectedId = requestedSectorId;
  }
  render();
  if (!preserveSelected && state.selectedId && mobileViewport.matches) openMobileDetail();
}

function updateEtfFilter(target) {
  const key = target.dataset.etfFilter;
  if (!key) return;
  if (target.type === 'checkbox') state.etfFilters[key] = target.checked;
  else if (key === 'minAmount') state.etfFilters[key] = Number(target.value);
  renderRanks(getCurrentData());
}

function openMobileDetail() {
  if (!mobileViewport.matches) return;
  window.clearTimeout(openMobileDetail.closeTimer);
  els.detailBackdrop.hidden = false;
  els.detailPanel.setAttribute('aria-hidden', 'false');
  els.detailPanel.setAttribute('aria-modal', 'true');
  els.detailPanel.inert = false;
  document.body.classList.add('mobile-detail-open');
  window.requestAnimationFrame(() => {
    els.detailBackdrop.classList.add('is-visible');
    els.detailPanel.classList.add('is-open');
  });
  window.setTimeout(() => els.detailPanel.querySelector('[data-close-detail]')?.focus(), 230);
}

function closeMobileDetail({ restoreFocus = true } = {}) {
  if (!mobileViewport.matches && !els.detailPanel.classList.contains('is-open')) return;
  els.detailBackdrop.classList.remove('is-visible');
  els.detailPanel.classList.remove('is-open');
  els.detailPanel.setAttribute('aria-hidden', 'true');
  els.detailPanel.setAttribute('aria-modal', String(mobileViewport.matches));
  els.detailPanel.inert = true;
  document.body.classList.remove('mobile-detail-open');
  window.clearTimeout(openMobileDetail.closeTimer);
  openMobileDetail.closeTimer = window.setTimeout(() => {
    if (!els.detailBackdrop.classList.contains('is-visible')) els.detailBackdrop.hidden = true;
  }, 230);

  if (restoreFocus && state.selectedId) {
    window.setTimeout(() => els.heatmap.querySelector(`[data-id="${CSS.escape(state.selectedId)}"]`)?.focus(), 0);
  }
}

function bindEvents() {
  window.addEventListener('jijin:api-success', (event) => {
    if (!String(event.detail?.endpoint || '').includes('/api/sector/heatmap')) return;
    const payload = event.detail?.payload || {};
    const rawTimestamp = Number(payload.updatedAt || 0);
    const updatedAt = rawTimestamp ? (rawTimestamp < 1e12 ? rawTimestamp * 1000 : rawTimestamp) : Date.now();
    const isSnapshot = String(payload.delivery || '').includes('snapshot');
    state.marketMeta = {
      stale: payload.stale === true || (isSnapshot && Date.now() - updatedAt > SNAPSHOT_STALE_AFTER_MS),
      snapshot: isSnapshot,
      updatedAt,
    };
  });

  document.querySelectorAll('.segmented').forEach((group) => {
    group.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const control = group.dataset.control;
      setControlValue(control, button.dataset.value);
      state.selectedId = null;
      state.activeTab = 'overview';
      state.mobileExpanded = false;
      closeMobileDetail({ restoreFocus: false });

      if (control === 'type') {
        await loadData({ preserveSelected: false });
        return;
      }
      render();
    });
  });

  els.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    state.selectedId = null;
    state.mobileExpanded = false;
    closeMobileDetail({ restoreFocus: false });
    render();
  });

  els.refreshBtn.addEventListener('click', () => loadData({ preserveSelected: true }));

  els.autoRefreshToggle.addEventListener('change', (event) => {
    state.autoRefresh = event.target.checked;
    state.countdown = REFRESH_INTERVAL_SECONDS;
    updateRefreshUI();
  });

  document.addEventListener('change', (event) => {
    const filterControl = event.target.closest('[data-etf-filter]');
    if (filterControl) updateEtfFilter(filterControl);
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-detail]')) {
      closeMobileDetail();
      return;
    }

    if (event.target.closest('[data-heatmap-toggle]')) {
      state.mobileExpanded = !state.mobileExpanded;
      renderHeatmap(getCurrentData());
      return;
    }

    const tab = event.target.closest('[data-tab]');
    if (tab) {
      state.activeTab = tab.dataset.tab;
      const selected = getCurrentData().find((item) => item.id === state.selectedId);
      renderDetail(selected);
      ensureStocksForSelected();
      return;
    }

    const target = event.target.closest('[data-id]');
    if (!target) return;
    selectSector(target.dataset.id);
  });

  els.heatmap.addEventListener('mousemove', (event) => {
    const tile = event.target.closest('.tile');
    if (!tile) {
      hideTooltip();
      return;
    }
    const item = getCurrentData().find((sector) => sector.id === tile.dataset.id);
    if (item) renderTooltip(item, event);
  });

  els.heatmap.addEventListener('mouseleave', hideTooltip);
  els.detailBackdrop.addEventListener('click', () => closeMobileDetail());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.detailPanel.classList.contains('is-open')) closeMobileDetail();
  });
  mobileViewport.addEventListener('change', (event) => {
    if (event.matches) {
      state.selectedId = null;
      state.mobileExpanded = false;
      closeMobileDetail({ restoreFocus: false });
    } else {
      els.detailBackdrop.hidden = true;
      els.detailBackdrop.classList.remove('is-visible');
      els.detailPanel.classList.remove('is-open');
      els.detailPanel.inert = false;
      els.detailPanel.setAttribute('aria-modal', 'false');
      document.body.classList.remove('mobile-detail-open');
    }
    render();
  });
}

function startAutoRefreshTimer() {
  window.setInterval(() => {
    if (!state.autoRefresh || state.isLoading) {
      updateRefreshUI();
      return;
    }

    state.countdown -= 1;
    if (state.countdown <= 0) {
      loadData({ preserveSelected: true });
      return;
    }
    updateRefreshUI();
  }, 1000);
}

bindEvents();
setControlValue('type', state.type);
els.detailPanel.setAttribute('aria-modal', String(mobileViewport.matches));
startAutoRefreshTimer();
loadData({ preserveSelected: false });
