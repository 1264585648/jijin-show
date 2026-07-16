import { fetchEtfQuotes, fetchSectorHeatmap, getApiBase } from './services/sector-api.js';
import {
  buildEtfQuoteMap,
  buildEtfWatchlist,
  collectEtfLabelsFromSectors,
} from './data/etf-map.js';

const REFRESH_INTERVAL_MS = 30_000;
const HISTORY_KEY = 'jijin-market-overview-history-v2';
const MAX_HISTORY_SAMPLES = 40;

const state = {
  data: [],
  history: readHistory(),
  loading: false,
  lastError: null,
  etfError: null,
  marketMeta: null,
  etfQuotes: new Map(),
  pulseMetric: 'fund',
  actionTab: 'signals',
  noticeDismissed: false,
  toastTimer: null,
};

const els = {
  marketSession: document.querySelector('#marketSession'),
  marketSessionLabel: document.querySelector('#marketSessionLabel'),
  marketClock: document.querySelector('#marketClock'),
  refreshBtn: document.querySelector('#refreshBtn'),
  dataNotice: document.querySelector('#dataNotice'),
  dataNoticeTitle: document.querySelector('#dataNoticeTitle'),
  dataNoticeText: document.querySelector('#dataNoticeText'),
  dismissNotice: document.querySelector('#dismissNotice'),
  judgmentTitle: document.querySelector('#judgmentTitle'),
  judgmentDescription: document.querySelector('#judgmentDescription'),
  judgmentTags: document.querySelector('#judgmentTags'),
  freshnessStatus: document.querySelector('#freshnessStatus'),
  freshnessMode: document.querySelector('#freshnessMode'),
  freshnessTime: document.querySelector('#freshnessTime'),
  totalAmount: document.querySelector('#totalAmount'),
  amountNote: document.querySelector('#amountNote'),
  totalFund: document.querySelector('#totalFund'),
  fundNote: document.querySelector('#fundNote'),
  upCount: document.querySelector('#upCount'),
  downCount: document.querySelector('#downCount'),
  breadthNote: document.querySelector('#breadthNote'),
  strongCount: document.querySelector('#strongCount'),
  strongNote: document.querySelector('#strongNote'),
  mobileTemperatureLabel: document.querySelector('#mobileTemperatureLabel'),
  mobileUpSummary: document.querySelector('#mobileUpSummary'),
  mobileDownSummary: document.querySelector('#mobileDownSummary'),
  temperatureMeter: document.querySelector('#temperatureMeter'),
  temperatureUpFill: document.querySelector('#temperatureUpFill'),
  sampleCount: document.querySelector('#sampleCount'),
  chartPanel: document.querySelector('.chart-panel'),
  pulseToggle: document.querySelector('#pulseToggle'),
  chartLegend: document.querySelector('#chartLegend'),
  marketChart: document.querySelector('#marketChart'),
  strongRanks: document.querySelector('#strongRanks'),
  weakRanks: document.querySelector('#weakRanks'),
  signalGrid: document.querySelector('#signalGrid'),
  signalsPanel: document.querySelector('.signals-panel'),
  etfActionList: document.querySelector('#etfActionList'),
  actionViewAll: document.querySelector('#actionViewAll'),
  updatedAt: document.querySelector('#updatedAt'),
  toast: document.querySelector('#toast'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatPercent(value, digits = 2) {
  const number = finite(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}%`;
}

function formatMoney(value, digits = 1) {
  const number = finite(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(digits)}亿`;
}

function formatAmount(value) {
  const number = finite(value);
  if (Math.abs(number) >= 10_000) return `${(number / 10_000).toFixed(2)}万亿`;
  return `${number.toFixed(0)}亿`;
}

function valueClass(value) {
  const number = finite(value);
  if (number > 0) return 'positive';
  if (number < 0) return 'negative';
  return '';
}

function getShanghaiDay(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMarketMeta(payload = {}) {
  const snapshot = String(payload.delivery || '').includes('snapshot');
  const payloadStale = payload.stale === true;
  const warningTimes = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => normalizeTimestamp(warning?.staleUpdatedAt)).filter(Boolean)
    : [];
  const warningTimestamp = warningTimes.length ? Math.min(...warningTimes) : 0;
  const timestamp = payloadStale
    ? warningTimestamp
      || normalizeTimestamp(payload.staleUpdatedAt)
      || normalizeTimestamp(payload.snapshotCollectedAt)
      || normalizeTimestamp(payload.updatedAt)
    : normalizeTimestamp(snapshot ? payload.snapshotCollectedAt || payload.updatedAt : payload.updatedAt || payload.snapshotCollectedAt);
  const ageStale = snapshot && timestamp > 0 && Date.now() - timestamp > 30 * 60 * 1000;
  const stale = payloadStale || ageStale;

  return {
    stale,
    snapshot,
    timestamp,
  };
}

function renderFreshness() {
  const meta = state.marketMeta;
  if (!meta) {
    els.freshnessStatus.classList.add('is-hidden');
    return;
  }

  const isCached = meta.stale || meta.snapshot;
  els.freshnessStatus.classList.remove('is-hidden');
  els.freshnessStatus.classList.toggle('is-stale', isCached);
  els.freshnessMode.textContent = isCached ? '缓存快照' : '实时接口';
  els.freshnessTime.textContent = meta.timestamp
    ? `数据时间 ${formatDateTime(meta.timestamp)}`
    : '数据时间未提供';
}

function readHistory() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const today = getShanghaiDay();
    return raw
      .filter((sample) => sample && getShanghaiDay(sample.timestamp) === today)
      .map((sample) => ({
        timestamp: finite(sample.timestamp),
        breadth: finite(sample.breadth),
        fund: finite(sample.fund),
      }))
      .filter((sample) => sample.timestamp > 0)
      .slice(-MAX_HISTORY_SAMPLES);
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch {
    // History persistence is optional; the live page still works without it.
  }
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

function getTotals(data) {
  const totals = data.reduce(
    (result, item) => {
      result.amount += item.amount;
      result.fund += item.mainNetIn;
      if (item.changePct > 0) result.up += 1;
      else if (item.changePct < 0) result.down += 1;
      else result.flat += 1;
      return result;
    },
    { amount: 0, fund: 0, up: 0, down: 0, flat: 0 },
  );

  const directionalTotal = totals.up + totals.down;
  totals.breadth = directionalTotal ? (totals.up / directionalTotal) * 100 : 0;
  totals.strong = data.filter(
    (item) => item.changePct > 1 && item.mainNetIn > 0 && item.riseRatio >= 60,
  );
  return totals;
}

function recordHistorySample(totals) {
  if (state.marketMeta?.stale) return;
  const sourceTimestamp = state.marketMeta?.timestamp || Date.now();
  const sample = {
    timestamp: sourceTimestamp,
    breadth: Number(totals.breadth.toFixed(2)),
    fund: Number(totals.fund.toFixed(2)),
  };
  const existingIndex = state.history.findIndex((item) => item.timestamp === sourceTimestamp);

  if (existingIndex >= 0) state.history[existingIndex] = sample;
  else state.history.push(sample);

  state.history = state.history
    .filter((item) => getShanghaiDay(item.timestamp) === getShanghaiDay(sample.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_HISTORY_SAMPLES);
  writeHistory();
}

function getJudgment(data, totals) {
  const leaders = [...data]
    .sort((a, b) => (b.mainNetIn + b.changePct * 2) - (a.mainNetIn + a.changePct * 2))
    .slice(0, 2);
  const names = leaders.map((item) => item.name);
  const leadText = names.length > 1 ? `${names[0]}与${names[1]}` : names[0] || '领先方向';
  const category = leaders[0]?.category || '强势方向';
  if (totals.breadth >= 60 && totals.fund > 0) {
    return {
      title: `资金回流${category}，${leadText}形成共振`,
      description: `行业板块节点口径资金合计净流入${formatMoney(totals.fund)}，上涨板块占比${totals.breadth.toFixed(0)}%，${totals.strong.length}个板块形成涨幅、资金与扩散共振；合计仅用于方向观察。`,
      tags: [
        { label: '市场偏强', tone: 'positive' },
        { label: '资金回流', tone: 'blue' },
      ],
    };
  }

  if (totals.breadth >= 48 || totals.fund > 0) {
    return {
      title: `市场震荡分化，${leadText}保持相对强势`,
      description: `当前上涨板块占比${totals.breadth.toFixed(0)}%，行业板块节点口径资金合计${totals.fund >= 0 ? '净流入' : '净流出'}${formatMoney(Math.abs(totals.fund)).replace('+', '')}；该合计可能包含层级重复，仅用于方向观察。`,
      tags: [
        { label: '市场分化', tone: 'neutral' },
        { label: totals.fund >= 0 ? '局部流入' : '资金谨慎', tone: totals.fund >= 0 ? 'blue' : 'negative' },
      ],
    };
  }

  return {
    title: `资金整体偏谨慎，${leadText}维持相对韧性`,
    description: `当前上涨板块占比${totals.breadth.toFixed(0)}%，行业板块节点口径资金合计净流出${formatMoney(Math.abs(totals.fund)).replace('+', '')}；该合计可能包含层级重复，市场防守特征更加明显。`,
    tags: [
      { label: '市场偏弱', tone: 'negative' },
      { label: '资金流出', tone: 'negative' },
    ],
  };
}

function renderJudgment(data, totals) {
  const judgment = getJudgment(data, totals);
  els.judgmentTitle.textContent = judgment.title;
  els.judgmentDescription.textContent = judgment.description;
  els.judgmentTags.innerHTML = judgment.tags
    .map((tag) => `<span class="status-tag ${tag.tone === 'positive' ? 'is-positive' : tag.tone === 'negative' ? 'is-negative' : tag.tone === 'neutral' ? 'is-neutral' : ''}">${escapeHtml(tag.label)}</span>`)
    .join('');
}

function setValueClass(element, value, extraClass = '') {
  element.className = `kpi-value ${valueClass(value)} ${extraClass}`.trim();
}

function renderKpis(data, totals) {
  const hasAmount = totals.amount > 0;
  els.totalAmount.textContent = hasAmount ? formatAmount(totals.amount) : '待更新';
  els.totalAmount.className = 'kpi-value';
  els.amountNote.textContent = hasAmount
    ? `板块口径参考 · 覆盖 ${data.length} 个节点`
    : '当前快照暂未提供有效成交额';
  els.amountNote.classList.toggle('is-empty-note', !hasAmount);

  els.totalFund.textContent = formatMoney(totals.fund);
  setValueClass(els.totalFund, totals.fund);
  els.fundNote.textContent = '行业板块节点合计，仅供方向参考';

  els.upCount.textContent = `${Math.round(totals.up)}个`;
  els.downCount.textContent = `${Math.round(totals.down)}个`;
  els.breadthNote.textContent = `上涨板块占比 ${totals.breadth.toFixed(0)}%`;

  els.strongCount.textContent = `${totals.strong.length}条`;
  setValueClass(els.strongCount, 0, 'warning');
  const strongNames = [...totals.strong]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 3)
    .map((item) => item.name);
  els.strongNote.textContent = strongNames.length ? strongNames.join('、') : '暂无明显共振主线';

  const breadth = Math.min(100, Math.max(0, totals.breadth));
  els.mobileTemperatureLabel.textContent = breadth >= 60 ? '偏强' : breadth >= 48 ? '均衡' : '偏弱';
  els.mobileTemperatureLabel.className = valueClass(breadth - 50);
  els.mobileUpSummary.textContent = `上涨 ${Math.round(totals.up)}个`;
  els.mobileDownSummary.textContent = `下跌 ${Math.round(totals.down)}个`;
  els.temperatureMeter.setAttribute('aria-valuenow', breadth.toFixed(0));
  els.temperatureMeter.setAttribute('aria-valuetext', `上涨板块占比 ${breadth.toFixed(0)}%`);
  els.temperatureUpFill.style.width = `${breadth}%`;
}

function renderRankList(element, data, kind) {
  const list = [...data]
    .sort((a, b) => kind === 'strong' ? b.changePct - a.changePct : a.changePct - b.changePct)
    .slice(0, 5);

  element.className = `rank-list is-${kind}`;
  if (!list.length) {
    element.innerHTML = '<li class="rank-empty">等待市场数据</li>';
    return;
  }

  element.innerHTML = list
    .map(
      (item, index) => `
        <li class="rank-item">
          <span class="rank-number">${index + 1}</span>
          <span class="rank-name">${escapeHtml(item.name)}</span>
          <strong class="rank-value ${valueClass(item.changePct)}">${formatPercent(item.changePct)}</strong>
        </li>
      `,
    )
    .join('');
}

const SIGNAL_ICONS = {
  trend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 5-5 4 4 7-8m-5 0h5v5" /></svg>',
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 2v3m6-3v3m-6 14v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3M9 9h6v6H9z" /></svg>',
  risk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3.5 19h17L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg>',
};

function getSignals(data) {
  const positiveFund = [...data].filter((item) => item.mainNetIn > 0).sort((a, b) => b.mainNetIn - a.mainNetIn)[0];
  const resonance = [...data]
    .filter((item) => item.changePct > 1 && item.mainNetIn > 0 && item.riseRatio >= 65)
    .sort((a, b) => b.riseRatio - a.riseRatio)[0];
  const weak = [...data]
    .filter((item) => item.changePct < 0 && item.mainNetIn < 0)
    .sort((a, b) => a.changePct - b.changePct)[0];

  return [
    positiveFund && {
      title: `${positiveFund.name}主力净流入居前`,
      meta: `${formatMoney(positiveFund.mainNetIn)} · 净占比${formatPercent(positiveFund.mainNetInRatio)}`,
      tone: 'positive',
      icon: SIGNAL_ICONS.trend,
    },
    resonance && {
      title: `${resonance.name}形成资金与扩散共振`,
      meta: `${resonance.upCount.toFixed(0)}涨/${resonance.downCount.toFixed(0)}跌 · 扩散度${resonance.riseRatio.toFixed(0)}%`,
      tone: 'blue',
      icon: SIGNAL_ICONS.pulse,
    },
    weak && {
      title: `${weak.name}出现资金与价格同步走弱`,
      meta: `${formatPercent(weak.changePct)} · 主力${formatMoney(weak.mainNetIn)}`,
      tone: 'negative',
      icon: SIGNAL_ICONS.risk,
    },
  ].filter(Boolean);
}

function renderSignals(data) {
  const signals = getSignals(data);
  if (!signals.length) {
    els.signalGrid.innerHTML = '<div class="signal-empty">当前数据未识别到显著异动</div>';
    return;
  }

  els.signalGrid.innerHTML = signals
    .map(
      (signal) => `
        <a class="signal-card" href="./flows.html">
          <span class="signal-icon ${signal.tone === 'negative' ? 'is-negative' : signal.tone === 'blue' ? 'is-blue' : ''}">${signal.icon}</span>
          <span class="signal-copy">
            <strong>${escapeHtml(signal.title)}</strong>
            <span>${escapeHtml(signal.meta)}</span>
          </span>
          <span class="signal-arrow" aria-hidden="true">›</span>
        </a>
      `,
    )
    .join('');
}

function renderEtfActions(data) {
  const watchlist = buildEtfWatchlist(data, state.etfQuotes, { limit: 3 });
  if (!watchlist.length) {
    els.etfActionList.innerHTML = '<div class="signal-empty">当前板块尚未匹配到 ETF，前往 ETF 观察池查看完整列表</div>';
    return;
  }

  els.etfActionList.innerHTML = watchlist
    .map((item) => {
      const quote = item.quote;
      const quoteText = quote
        ? `${formatPercent(quote.changePct)} · 成交 ${formatMoney(quote.amount).replace('+', '')}`
        : '行情待确认';
      const signal = quote ? item.signal : '映射观察';
      const tone = quote ? valueClass(quote.changePct) : '';
      return `
        <a class="etf-action-item" href="./etf.html">
          <span class="etf-action-code">${escapeHtml(item.code || 'ETF')}</span>
          <span class="etf-action-copy">
            <strong>${escapeHtml(item.label.replace(/^\d{6}\s*/, ''))}</strong>
            <small>关联 ${escapeHtml(item.sectors.join('、') || '当前主线')}</small>
          </span>
          <span class="etf-action-meta">
            <strong class="${tone}">${escapeHtml(quoteText)}</strong>
            <small>${escapeHtml(signal)}</small>
          </span>
          <span class="signal-arrow" aria-hidden="true">›</span>
        </a>
      `;
    })
    .join('');
}

function setActionTab(tab) {
  state.actionTab = tab === 'etfs' ? 'etfs' : 'signals';
  els.signalsPanel.dataset.actionTab = state.actionTab;
  els.actionViewAll.href = state.actionTab === 'etfs' ? './etf.html' : './flows.html';
  document.querySelectorAll('.action-tabs [data-action-tab]').forEach((button) => {
    const isActive = button.dataset.actionTab === state.actionTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  els.etfActionList.hidden = state.actionTab !== 'etfs';
}

function setPulseMetric(metric) {
  state.pulseMetric = metric === 'breadth' ? 'breadth' : 'fund';
  els.chartPanel.dataset.pulseMetric = state.pulseMetric;
  document.querySelectorAll('.pulse-toggle [data-pulse-metric]').forEach((button) => {
    const isActive = button.dataset.pulseMetric === state.pulseMetric;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
}

function roundAxisMax(value) {
  const absolute = Math.max(Math.abs(value), 20);
  const magnitude = 10 ** Math.floor(Math.log10(absolute));
  return Math.ceil(absolute / magnitude) * magnitude;
}

function renderCurrentSnapshot() {
  const sectors = [...state.data]
    .sort((a, b) => Math.abs(b.mainNetIn) - Math.abs(a.mainNetIn))
    .slice(0, 7);
  const maxAbs = Math.max(...sectors.map((item) => Math.abs(item.mainNetIn)), 1);

  els.chartLegend.innerHTML = `
    <span><i class="legend-block is-red"></i>当前净流入</span>
    <span><i class="legend-block is-green"></i>当前净流出</span>
  `;
  els.marketChart.innerHTML = `
    <div class="snapshot-chart" role="img" aria-label="当前板块主力资金分布">
      <div class="snapshot-axis"><span>净流出</span><strong>0</strong><span>净流入</span></div>
      <div class="snapshot-rows">
        ${sectors.map((item) => {
          const width = Math.max(3, (Math.abs(item.mainNetIn) / maxAbs) * 48);
          return `
            <div class="snapshot-row">
              <span class="snapshot-name">${escapeHtml(item.name)}</span>
              <span class="snapshot-track">
                <i class="snapshot-bar ${item.mainNetIn >= 0 ? 'is-positive' : 'is-negative'}" style="width:${width}%"></i>
              </span>
              <strong class="${valueClass(item.mainNetIn)}">${formatMoney(item.mainNetIn)}</strong>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderBreadthSnapshot() {
  const totals = getTotals(state.data);
  const breadth = Math.min(100, Math.max(0, totals.breadth));
  els.chartLegend.innerHTML = `
    <span><i class="legend-block is-red"></i>上涨板块 ${totals.up}</span>
    <span><i class="legend-block is-green"></i>下跌板块 ${totals.down}</span>
  `;
  els.marketChart.innerHTML = `
    <div class="snapshot-chart breadth-snapshot" role="img" aria-label="当前上涨板块占比 ${breadth.toFixed(0)}%">
      <div class="breadth-snapshot-value"><strong>${breadth.toFixed(0)}%</strong><span>当前上涨板块占比</span></div>
      <div class="breadth-snapshot-track" aria-hidden="true"><i style="width:${breadth}%"></i></div>
      <div class="breadth-snapshot-labels"><span>下跌 ${totals.down} 个</span><span>平盘 ${totals.flat} 个</span><span>上涨 ${totals.up} 个</span></div>
      <p>按当前板块节点自身涨跌方向计算，避免把多层级行业的成份股家数重复相加。</p>
    </div>
  `;
}

function renderChart() {
  const samples = state.history;
  els.sampleCount.textContent = `${samples.length} 个样本`;
  els.pulseToggle.hidden = !state.data.length;

  if (samples.length < 2 && state.data.length) {
    if (state.pulseMetric === 'breadth') renderBreadthSnapshot();
    else renderCurrentSnapshot();
    return;
  }

  els.chartLegend.innerHTML = `
    <span><i class="legend-line is-red"></i>上涨板块占比（左轴）</span>
    <span><i class="legend-line is-blue"></i>板块资金合计（右轴）</span>
  `;

  const width = 920;
  const height = 286;
  const margin = { top: 14, right: 62, bottom: 30, left: 46 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const fundMax = roundAxisMax(Math.max(...samples.map((item) => Math.abs(item.fund)), 20));
  const xAt = (index) => samples.length <= 1
    ? margin.left + plotWidth
    : margin.left + (index / (samples.length - 1)) * plotWidth;
  const breadthY = (value) => margin.top + ((100 - value) / 100) * plotHeight;
  const fundY = (value) => margin.top + ((fundMax - value) / (fundMax * 2)) * plotHeight;

  const ticks = [0, 25, 50, 75, 100];
  const grid = ticks.map((tick) => {
    const y = breadthY(tick);
    const rightValue = -fundMax + (tick / 100) * fundMax * 2;
    return `
      <line class="chart-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" />
      <text class="chart-axis-label is-left" x="${margin.left - 10}" y="${y + 4}" text-anchor="end">${tick}%</text>
      <text class="chart-axis-label is-right" x="${width - margin.right + 10}" y="${y + 4}" text-anchor="start">${rightValue.toFixed(0)}</text>
    `;
  }).join('');

  const breadthPoints = samples.map((sample, index) => `${xAt(index)},${breadthY(sample.breadth)}`).join(' ');
  const fundPoints = samples.map((sample, index) => `${xAt(index)},${fundY(sample.fund)}`).join(' ');
  const timeLabelIndexes = samples.length
    ? [...new Set([0, Math.floor((samples.length - 1) / 2), samples.length - 1])].filter((index) => index >= 0)
    : [];
  const timeLabels = timeLabelIndexes.map((index) => `
    <text class="chart-axis-label is-time" x="${xAt(index)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === samples.length - 1 ? 'end' : 'middle'}">${formatTime(samples[index].timestamp)}</text>
  `).join('');
  const dots = samples.map((sample, index) => `
    <circle class="chart-dot-breadth" cx="${xAt(index)}" cy="${breadthY(sample.breadth)}" r="3.5"><title>${formatTime(sample.timestamp)} 上涨板块占比 ${sample.breadth.toFixed(1)}%</title></circle>
    <circle class="chart-dot-fund" cx="${xAt(index)}" cy="${fundY(sample.fund)}" r="3.5"><title>${formatTime(sample.timestamp)} 板块资金合计 ${formatMoney(sample.fund)}</title></circle>
  `).join('');
  const last = samples.at(-1);
  const endLabels = last ? `
    <text class="chart-end-label is-breadth" x="${width - margin.right - 8}" y="${Math.max(12, breadthY(last.breadth) - 9)}" text-anchor="end" fill="#f05252">${last.breadth.toFixed(0)}%</text>
    <text class="chart-end-label is-fund" x="${width - margin.right - 8}" y="${Math.min(height - 18, fundY(last.fund) + 17)}" text-anchor="end" fill="#4c8dff">${formatMoney(last.fund)}</text>
  ` : '';

  els.marketChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="上涨板块占比与板块口径资金合计真实刷新趋势">
      ${grid}
      <line class="chart-axis-line" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" />
      <line class="chart-axis-line" x1="${width - margin.right}" y1="${margin.top}" x2="${width - margin.right}" y2="${height - margin.bottom}" />
      <line class="chart-axis-line" x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" />
      ${samples.length > 1 ? `<polyline class="chart-line-breadth" points="${breadthPoints}" /><polyline class="chart-line-fund" points="${fundPoints}" />` : ''}
      ${dots}
      ${timeLabels}
      ${endLabels}
    </svg>
    ${samples.length < 2 ? `<div class="chart-empty">${samples.length ? '已记录首个真实样本，等待下一次刷新形成趋势' : '等待真实数据后开始记录趋势'}</div>` : ''}
  `;
}

function renderDataNotice() {
  if (state.noticeDismissed || (!state.lastError && state.data.length)) {
    els.dataNotice.classList.add('is-hidden');
    return;
  }

  els.dataNotice.classList.remove('is-hidden');
  if (state.lastError) {
    const noBase = state.lastError.status === 'NO_API_BASE' || !getApiBase();
    els.dataNoticeTitle.textContent = noBase ? '尚未连接真实数据接口' : '真实数据接口暂不可用';
    els.dataNoticeText.textContent = noBase
      ? '请在本地配置 JIJIN_API_BASE；页面不会使用模拟数据兜底。'
      : `${state.lastError.endpoint || '行情接口'} · ${state.lastError.message || '请求失败'}`;
  } else {
    els.dataNoticeTitle.textContent = '真实接口暂未返回板块数据';
    els.dataNoticeText.textContent = '当前页面保持空态，不会使用模拟行情替代。';
  }
}

function renderEmptyState() {
  renderRankList(els.strongRanks, [], 'strong');
  renderRankList(els.weakRanks, [], 'weak');
  renderChart();
  renderDataNotice();
}

function render(data) {
  const totals = getTotals(data);
  renderJudgment(data, totals);
  renderKpis(data, totals);
  renderRankList(els.strongRanks, data, 'strong');
  renderRankList(els.weakRanks, data, 'weak');
  renderSignals(data);
  renderEtfActions(data);
  renderChart();
  renderFreshness();
  renderDataNotice();
  els.updatedAt.textContent = state.marketMeta?.timestamp
    ? `${state.marketMeta.stale || state.marketMeta.snapshot ? '快照' : '数据'} ${formatDateTime(state.marketMeta.timestamp)}`
    : `更新于 ${formatDateTime(Date.now())}`;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

function setLoading(loading) {
  state.loading = loading;
  els.refreshBtn.disabled = loading;
  els.refreshBtn.classList.toggle('is-loading', loading);
}

async function loadData({ silent = false } = {}) {
  if (state.loading) return;
  setLoading(true);
  state.noticeDismissed = false;

  try {
    const result = await fetchSectorHeatmap({ type: 'industry' });
    const data = Array.isArray(result) ? result.map(enrichSector).filter((item) => item.name) : [];
    if (data.length) {
      state.data = data;
      state.lastError = null;
      state.etfError = null;
      const totals = getTotals(data);
      recordHistorySample(totals);
      render(data);
      const etfLabels = collectEtfLabelsFromSectors(data);
      const etfQuotes = await fetchEtfQuotes(etfLabels);
      state.etfQuotes = buildEtfQuoteMap(etfQuotes);
      renderEtfActions(data);
      if (!silent) showToast('市场数据已更新');
    } else if (state.data.length) {
      renderDataNotice();
      if (!silent) showToast('刷新失败，继续显示上一次真实数据');
    } else {
      renderEmptyState();
    }
  } finally {
    setLoading(false);
  }
}

function updateClock() {
  const now = new Date();
  els.marketClock.textContent = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);

  const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' })
    .format(now)
    .replace('Sun', '0').replace('Mon', '1').replace('Tue', '2').replace('Wed', '3').replace('Thu', '4').replace('Fri', '5').replace('Sat', '6'));
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const currentMinutes = hour * 60 + minute;
  const isWeekday = weekday >= 1 && weekday <= 5;
  const isOpen = isWeekday && ((currentMinutes >= 570 && currentMinutes <= 690) || (currentMinutes >= 780 && currentMinutes <= 900));
  const isBeforeOpen = isWeekday && currentMinutes < 570;

  els.marketSession.classList.toggle('is-open', isOpen);
  els.marketSessionLabel.textContent = isOpen ? 'A股交易中' : isBeforeOpen ? 'A股待开盘' : 'A股已收盘';
}

window.addEventListener('jijin:api-error', (event) => {
  if (String(event.detail?.endpoint || '').startsWith('/api/etf/') && state.data.length) {
    state.etfError = event.detail;
    return;
  }
  state.lastError = event.detail || { message: '接口不可用' };
  renderDataNotice();
});

window.addEventListener('jijin:api-success', (event) => {
  const endpoint = String(event.detail?.endpoint || '');
  if (endpoint.startsWith('/api/sector/heatmap')) {
    state.marketMeta = getMarketMeta(event.detail?.payload);
    state.lastError = null;
    renderFreshness();
    renderDataNotice();
    return;
  }
  if (endpoint.startsWith('/api/etf/')) state.etfError = null;
});

els.refreshBtn.addEventListener('click', () => loadData());
els.dismissNotice.addEventListener('click', () => {
  state.noticeDismissed = true;
  renderDataNotice();
});

document.querySelectorAll('.action-tabs [data-action-tab]').forEach((button) => {
  button.addEventListener('click', () => setActionTab(button.dataset.actionTab));
});

document.querySelectorAll('.pulse-toggle [data-pulse-metric]').forEach((button) => {
  button.addEventListener('click', () => {
    setPulseMetric(button.dataset.pulseMetric);
    renderChart();
  });
});

updateClock();
setPulseMetric('fund');
setActionTab('signals');
window.setInterval(updateClock, 1000);
window.setInterval(() => {
  if (document.visibilityState === 'visible') loadData({ silent: true });
}, REFRESH_INTERVAL_MS);

renderChart();
loadData({ silent: true });
