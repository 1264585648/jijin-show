import { fetchSectorHeatmap, getApiBase } from './services/sector-api.js';

const REFRESH_INTERVAL_MS = 30_000;
const HISTORY_KEY = 'jijin-market-overview-history-v1';
const MAX_HISTORY_SAMPLES = 40;

const state = {
  data: [],
  history: readHistory(),
  loading: false,
  lastError: null,
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
  totalAmount: document.querySelector('#totalAmount'),
  amountNote: document.querySelector('#amountNote'),
  totalFund: document.querySelector('#totalFund'),
  fundNote: document.querySelector('#fundNote'),
  upCount: document.querySelector('#upCount'),
  downCount: document.querySelector('#downCount'),
  breadthNote: document.querySelector('#breadthNote'),
  strongCount: document.querySelector('#strongCount'),
  strongNote: document.querySelector('#strongNote'),
  sampleCount: document.querySelector('#sampleCount'),
  chartLegend: document.querySelector('#chartLegend'),
  marketChart: document.querySelector('#marketChart'),
  strongRanks: document.querySelector('#strongRanks'),
  weakRanks: document.querySelector('#weakRanks'),
  signalGrid: document.querySelector('#signalGrid'),
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
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
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
      result.up += item.upCount;
      result.down += item.downCount;
      return result;
    },
    { amount: 0, fund: 0, up: 0, down: 0 },
  );

  const stockTotal = totals.up + totals.down;
  totals.breadth = stockTotal ? (totals.up / stockTotal) * 100 : 0;
  totals.strong = data.filter(
    (item) => item.changePct > 1 && item.mainNetIn > 0 && item.riseRatio >= 60,
  );
  return totals;
}

function recordHistorySample(totals) {
  const sample = {
    timestamp: Date.now(),
    breadth: Number(totals.breadth.toFixed(2)),
    fund: Number(totals.fund.toFixed(2)),
  };
  const last = state.history.at(-1);

  if (last && sample.timestamp - last.timestamp < 10_000) state.history[state.history.length - 1] = sample;
  else state.history.push(sample);

  state.history = state.history
    .filter((item) => getShanghaiDay(item.timestamp) === getShanghaiDay(sample.timestamp))
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
  const marketCount = totals.up + totals.down;

  if (totals.breadth >= 60 && totals.fund > 0) {
    return {
      title: `资金回流${category}，${leadText}形成共振`,
      description: `主力资金净流入${formatMoney(totals.fund)}，上涨家数占比${totals.breadth.toFixed(0)}%，${totals.strong.length}个板块形成涨幅、资金与扩散共振。`,
      tags: [
        { label: '市场偏强', tone: 'positive' },
        { label: '资金回流', tone: 'blue' },
      ],
    };
  }

  if (totals.breadth >= 48 || totals.fund > 0) {
    return {
      title: `市场震荡分化，${leadText}保持相对强势`,
      description: `当前上涨家数占比${totals.breadth.toFixed(0)}%，主力资金${totals.fund >= 0 ? '净流入' : '净流出'}${formatMoney(Math.abs(totals.fund)).replace('+', '')}，需要继续观察资金扩散。`,
      tags: [
        { label: '市场分化', tone: 'neutral' },
        { label: totals.fund >= 0 ? '局部流入' : '资金谨慎', tone: totals.fund >= 0 ? 'blue' : 'negative' },
      ],
    };
  }

  return {
    title: `资金整体偏谨慎，${leadText}维持相对韧性`,
    description: `当前上涨家数占比${totals.breadth.toFixed(0)}%，主力净流出${formatMoney(Math.abs(totals.fund)).replace('+', '')}，市场防守特征更加明显。`,
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
  els.totalAmount.textContent = formatAmount(totals.amount);
  els.amountNote.textContent = `覆盖 ${data.length} 个行业板块`;

  els.totalFund.textContent = formatMoney(totals.fund);
  setValueClass(els.totalFund, totals.fund);
  els.fundNote.textContent = totals.fund >= 0 ? '整体资金偏净流入' : '整体资金偏净流出';

  els.upCount.textContent = `${Math.round(totals.up)}家`;
  els.downCount.textContent = `${Math.round(totals.down)}家`;
  els.breadthNote.textContent = `上涨家数占比 ${totals.breadth.toFixed(0)}%`;

  els.strongCount.textContent = `${totals.strong.length}条`;
  setValueClass(els.strongCount, 0, 'warning');
  const strongNames = [...totals.strong]
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, 3)
    .map((item) => item.name);
  els.strongNote.textContent = strongNames.length ? strongNames.join('、') : '暂无明显共振主线';
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
        <a class="signal-card" href="./heatmap.html">
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

function renderChart() {
  const samples = state.history;
  els.sampleCount.textContent = `${samples.length} 个样本`;

  if (samples.length < 2 && state.data.length) {
    renderCurrentSnapshot();
    return;
  }

  els.chartLegend.innerHTML = `
    <span><i class="legend-line is-red"></i>上涨家数占比（左轴）</span>
    <span><i class="legend-line is-blue"></i>主力净流入（右轴）</span>
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
      <text class="chart-axis-label" x="${margin.left - 10}" y="${y + 4}" text-anchor="end">${tick}%</text>
      <text class="chart-axis-label" x="${width - margin.right + 10}" y="${y + 4}" text-anchor="start">${rightValue.toFixed(0)}</text>
    `;
  }).join('');

  const breadthPoints = samples.map((sample, index) => `${xAt(index)},${breadthY(sample.breadth)}`).join(' ');
  const fundPoints = samples.map((sample, index) => `${xAt(index)},${fundY(sample.fund)}`).join(' ');
  const timeLabelIndexes = samples.length
    ? [...new Set([0, Math.floor((samples.length - 1) / 2), samples.length - 1])].filter((index) => index >= 0)
    : [];
  const timeLabels = timeLabelIndexes.map((index) => `
    <text class="chart-axis-label" x="${xAt(index)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === samples.length - 1 ? 'end' : 'middle'}">${formatTime(samples[index].timestamp)}</text>
  `).join('');
  const dots = samples.map((sample, index) => `
    <circle class="chart-dot-breadth" cx="${xAt(index)}" cy="${breadthY(sample.breadth)}" r="3.5"><title>${formatTime(sample.timestamp)} 上涨占比 ${sample.breadth.toFixed(1)}%</title></circle>
    <circle class="chart-dot-fund" cx="${xAt(index)}" cy="${fundY(sample.fund)}" r="3.5"><title>${formatTime(sample.timestamp)} 主力净流入 ${formatMoney(sample.fund)}</title></circle>
  `).join('');
  const last = samples.at(-1);
  const endLabels = last ? `
    <text class="chart-end-label" x="${width - margin.right - 8}" y="${Math.max(12, breadthY(last.breadth) - 9)}" text-anchor="end" fill="#f05252">${last.breadth.toFixed(0)}%</text>
    <text class="chart-end-label" x="${width - margin.right - 8}" y="${Math.min(height - 18, fundY(last.fund) + 17)}" text-anchor="end" fill="#4c8dff">${formatMoney(last.fund)}</text>
  ` : '';

  els.marketChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="上涨家数占比与主力资金真实刷新趋势">
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
  renderChart();
  renderDataNotice();
  els.updatedAt.textContent = `更新于 ${formatDateTime(Date.now())}`;
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
      const totals = getTotals(data);
      recordHistorySample(totals);
      render(data);
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
  state.lastError = event.detail || { message: '接口不可用' };
  renderDataNotice();
});

window.addEventListener('jijin:api-success', () => {
  state.lastError = null;
  renderDataNotice();
});

els.refreshBtn.addEventListener('click', () => loadData());
els.dismissNotice.addEventListener('click', () => {
  state.noticeDismissed = true;
  renderDataNotice();
});

document.querySelectorAll('[data-coming-soon]').forEach((button) => {
  button.addEventListener('click', () => showToast(`${button.dataset.comingSoon}页面将在下一阶段接入`));
});

updateClock();
window.setInterval(updateClock, 1000);
window.setInterval(() => {
  if (document.visibilityState === 'visible') loadData({ silent: true });
}, REFRESH_INTERVAL_MS);

renderChart();
loadData({ silent: true });
