import { fetchSectorHeatmap, fetchSectorStocks } from './services/sector-api.js';

const REFRESH_INTERVAL_SECONDS = 15;

const state = {
  type: 'industry',
  mode: 'change',
  area: 'amount',
  query: '',
  selectedId: null,
  activeTab: 'overview',
  rawData: [],
  autoRefresh: true,
  countdown: REFRESH_INTERVAL_SECONDS,
  isLoading: false,
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

const formatPercent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
const formatMoney = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}亿`;
const classByValue = (value) => (value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function enrichSector(sector) {
  const total = sector.upCount + sector.downCount;
  const riseRatio = total ? (sector.upCount / total) * 100 : 0;
  const hotScore = clamp(
    50 + sector.changePct * 6 + sector.mainNetInRatio * 4 + riseRatio * 0.18 + sector.turnoverRate * 1.6 + sector.leadingStockChangePct * 0.5,
    0,
    100,
  );
  const tags = getSectorTags({ ...sector, riseRatio, hotScore });

  return {
    ...sector,
    riseRatio,
    hotScore,
    mainNetInAbs: Math.abs(sector.mainNetIn),
    tags,
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
        ...(item.relatedEtfs || []),
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
  els.refreshBtn.textContent = state.isLoading ? '刷新中...' : '手动刷新';
}

function renderSummary(data) {
  const totalAmount = data.reduce((sum, item) => sum + item.amount, 0);
  const totalFund = data.reduce((sum, item) => sum + item.mainNetIn, 0);
  const avgChange = data.reduce((sum, item) => sum + item.changePct, 0) / Math.max(data.length, 1);
  const strongest = [...data].sort((a, b) => b.hotScore - a.hotScore)[0];
  const resonanceCount = data.filter((item) => item.tags.includes('强势共振')).length;

  const cards = [
    {
      label: '覆盖板块',
      value: data.length,
      suffix: '个',
      note: `${TYPE_LABELS[state.type]} · ${MODE_LABELS[state.mode]}`,
    },
    {
      label: '样本成交额',
      value: totalAmount.toFixed(0),
      suffix: '亿',
      note: `面积口径：${AREA_LABELS[state.area]}`,
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
          <div class="summary-label">${card.label}</div>
          <div class="summary-value ${card.valueClass || ''}">${card.value}<small>${card.suffix}</small></div>
          <div class="summary-note">${card.note}</div>
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

  els.heatmapTitle.textContent = `${TYPE_LABELS[state.type]} · ${MODE_LABELS[state.mode]}`;

  if (!sorted.length) {
    els.heatmap.innerHTML = '<div class="empty-detail"><span>没有匹配的板块</span><p>换个关键词试试。</p></div>';
    return;
  }

  els.heatmap.innerHTML = sorted
    .map((item) => {
      const span = getTileSpan(item, sorted);
      const value = state.mode === 'fund' ? formatPercent(item.mainNetInRatio) : state.mode === 'hot' ? item.hotScore.toFixed(1) : formatPercent(item.changePct);
      const fundBorder = item.mainNetIn >= 0 ? 'rgba(248, 113, 113, 0.72)' : 'rgba(74, 222, 128, 0.72)';
      const selectedClass = item.id === state.selectedId ? ' is-selected' : '';
      const smallClass = span.col <= 4 ? ' tile-small' : '';

      return `
        <button
          class="tile${selectedClass}${smallClass}"
          data-id="${item.id}"
          style="grid-column: span ${span.col}; grid-row: span ${span.row}; background:${getTileColor(item)}; border-color:${fundBorder};"
          aria-label="${item.name} ${value}"
        >
          <div>
            <div class="tile-top">
              <span class="tile-name">${item.name}</span>
              <span class="tile-badge">${item.tags[0]}</span>
            </div>
            <div class="tile-change">${value}${state.mode === 'hot' ? '<small> 分</small>' : ''}</div>
          </div>
          <div class="tile-meta">
            <span>主力 ${formatMoney(item.mainNetIn)}</span>
            <span>${item.upCount}涨 / ${item.downCount}跌 · 扩散 ${item.riseRatio.toFixed(0)}%</span>
            <span>领涨 ${item.leadingStock} ${formatPercent(item.leadingStockChangePct)}</span>
          </div>
        </button>
      `;
    })
    .join('');
}

function renderRanks(data) {
  const blocks = [
    {
      title: '涨幅榜',
      field: 'changePct',
      formatter: formatPercent,
      list: [...data].sort((a, b) => b.changePct - a.changePct).slice(0, 5),
    },
    {
      title: '主力流入榜',
      field: 'mainNetIn',
      formatter: formatMoney,
      list: [...data].sort((a, b) => b.mainNetIn - a.mainNetIn).slice(0, 5),
    },
    {
      title: '综合热度榜',
      field: 'hotScore',
      formatter: (v) => v.toFixed(1),
      list: [...data].sort((a, b) => b.hotScore - a.hotScore).slice(0, 5),
    },
  ];

  els.rankLists.innerHTML = blocks
    .map(
      (block) => `
      <section class="rank-block">
        <div class="rank-title"><strong>${block.title}</strong><span>Top 5</span></div>
        ${block.list
          .map(
            (item, index) => `
            <div class="rank-item" data-id="${item.id}">
              <span class="rank-no">${index + 1}</span>
              <div>
                <div class="rank-name">${item.name}</div>
                <div class="rank-meta">${item.category} · ${item.tags[0]}</div>
              </div>
              <strong class="rank-value ${classByValue(item[block.field] - (block.field === 'hotScore' ? 50 : 0))}">${block.formatter(item[block.field])}</strong>
            </div>
          `,
          )
          .join('')}
      </section>
    `,
    )
    .join('');
}

function renderDetail(item) {
  if (!item) {
    els.detailPanel.innerHTML = `
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
    <div class="detail-hero">
      <span class="eyebrow">${item.category} · ${item.id}</span>
      <h2>${item.name}</h2>
      <div class="detail-change ${classByValue(item.changePct)}">${formatPercent(item.changePct)}</div>
      <div class="tag-row">${item.tags.map((tag) => `<span class="tag">${tag}</span>`).join('')}</div>
    </div>
    <div class="detail-tabs">
      ${Object.entries(TAB_LABELS)
        .map(
          ([key, label]) => `<button class="detail-tab ${state.activeTab === key ? 'is-active' : ''}" data-tab="${key}" type="button">${label}</button>`,
        )
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
  return `
    <div class="metric-list">
      <div class="metric"><span>主力净流入</span><strong class="${classByValue(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong></div>
      <div class="metric"><span>主力净占比</span><strong class="${classByValue(item.mainNetInRatio)}">${formatPercent(item.mainNetInRatio)}</strong></div>
      <div class="metric"><span>成交额</span><strong>${item.amount.toFixed(0)} 亿</strong></div>
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
        <div class="metric"><span>领涨股</span><strong>${item.leadingStock} ${formatPercent(item.leadingStockChangePct)}</strong></div>
        <div class="metric"><span>主力净流入最大股</span><strong>${item.topFundFlowStock}</strong></div>
      </div>
    </section>
  `;
}

function renderStocksTab(item, stocks, isStocksLoading) {
  if (isStocksLoading && !stocks) {
    return `<div class="loading-box">正在加载 ${item.name} 成份股...</div>`;
  }

  if (!stocks?.length) {
    return `<div class="loading-box">暂无成份股数据</div>`;
  }

  return `
    <section class="detail-section full-section">
      <div class="table-headline">
        <h3>成份股强弱</h3>
        <span>模拟字段 · 后续接真实接口</span>
      </div>
      <div class="stock-table">
        <div class="stock-row stock-row-head">
          <span>代码</span>
          <span>名称</span>
          <span>涨跌幅</span>
          <span>主力</span>
          <span>角色</span>
        </div>
        ${stocks
          .map(
            (stock) => `
            <div class="stock-row">
              <span>${stock.code}</span>
              <strong>${stock.name}</strong>
              <span class="${classByValue(stock.changePct)}">${formatPercent(stock.changePct)}</span>
              <span class="${classByValue(stock.fundNetIn)}">${formatMoney(stock.fundNetIn)}</span>
              <span>${stock.role}</span>
            </div>
          `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderEtfTab(item) {
  return `
    <section class="detail-section full-section">
      <div class="table-headline">
        <h3>相关 ETF / 基金观察</h3>
        <span>用于把板块热度转成可观察基金入口</span>
      </div>
      <div class="etf-card-list">
        ${item.relatedEtfs
          .map((etf, index) => {
            const score = clamp(item.hotScore - index * 7 + item.mainNetInRatio * 1.5, 0, 100);
            const signal = score >= 75 ? '高热度' : score >= 58 ? '可观察' : '低优先级';
            return `
              <article class="etf-card">
                <div>
                  <strong>${etf}</strong>
                  <span>${signal}</span>
                </div>
                <div class="etf-score ${score >= 70 ? 'positive' : 'neutral'}">${score.toFixed(0)}</div>
              </article>
            `;
          })
          .join('')}
      </div>
      <p class="summary-note">真实版本建议维护「板块代码 -> 指数 -> ETF / 指数基金」映射表，并合并 ETF 成交额、涨跌幅、溢折价和主力资金。</p>
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
      <div class="table-headline">
        <h3>资金结构</h3>
        <span>看资金是共振流入还是局部分歧</span>
      </div>
      <div class="flow-list">
        ${flows
          .map(
            ([label, value]) => `
            <div class="flow-item">
              <div>
                <span>${label}</span>
                <strong class="${classByValue(value)}">${label === '净占比' ? formatPercent(value) : formatMoney(value)}</strong>
              </div>
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
    <h4>${item.name} <span class="${classByValue(item.changePct)}">${formatPercent(item.changePct)}</span></h4>
    <div class="tooltip-grid">
      <div><span>成交额</span><strong>${item.amount.toFixed(0)} 亿</strong></div>
      <div><span>主力净流入</span><strong class="${classByValue(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong></div>
      <div><span>主力净占比</span><strong class="${classByValue(item.mainNetInRatio)}">${formatPercent(item.mainNetInRatio)}</strong></div>
      <div><span>上涨/下跌</span><strong>${item.upCount} / ${item.downCount}</strong></div>
      <div><span>领涨股</span><strong>${item.leadingStock}</strong></div>
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

function selectSector(id) {
  state.selectedId = id;
  const data = getCurrentData();
  const item = data.find((sector) => sector.id === id);
  renderHeatmap(data);
  renderDetail(item);
  ensureStocksForSelected();
}

function render() {
  const data = getCurrentData();
  if (!state.selectedId || !data.some((item) => item.id === state.selectedId)) {
    state.selectedId = data[0]?.id || null;
  }

  const selected = data.find((item) => item.id === state.selectedId);
  els.updatedAt.textContent = new Date().toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  renderSummary(data);
  renderLegend();
  renderRanks(data);
  renderHeatmap(data);
  renderDetail(selected);
  updateRefreshUI();
  ensureStocksForSelected();
}

async function loadData({ preserveSelected = true, realtime = true } = {}) {
  state.isLoading = true;
  updateRefreshUI();
  const selectedBeforeLoad = state.selectedId;
  state.rawData = await fetchSectorHeatmap({ type: state.type, realtime });
  state.isLoading = false;
  state.countdown = REFRESH_INTERVAL_SECONDS;

  if (!preserveSelected) state.selectedId = null;
  if (preserveSelected && selectedBeforeLoad) state.selectedId = selectedBeforeLoad;
  render();
}

function bindEvents() {
  document.querySelectorAll('.segmented').forEach((group) => {
    group.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const control = group.dataset.control;
      state[control] = button.dataset.value;
      group.querySelectorAll('button').forEach((item) => item.classList.toggle('is-active', item === button));
      state.selectedId = null;
      state.activeTab = 'overview';

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
    render();
  });

  els.refreshBtn.addEventListener('click', () => loadData({ preserveSelected: true }));

  els.autoRefreshToggle.addEventListener('change', (event) => {
    state.autoRefresh = event.target.checked;
    state.countdown = REFRESH_INTERVAL_SECONDS;
    updateRefreshUI();
  });

  document.addEventListener('click', (event) => {
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
startAutoRefreshTimer();
loadData({ preserveSelected: false });
