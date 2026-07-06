const ETF_RULES = [
  {
    keywords: ['软件开发', '软件', '信创', 'AI 应用', '数据要素', '数字经济'],
    etfs: [
      { code: '515230', name: '软件ETF', index: '中证软件服务' },
      { code: '159819', name: '人工智能ETF', index: '中证人工智能主题' },
      { code: '159739', name: '大数据ETF', index: '中证云计算与大数据' },
    ],
  },
  {
    keywords: ['半导体', '芯片', 'CPO', '通信设备', '算力租赁'],
    etfs: [
      { code: '512480', name: '半导体ETF', index: '中华半导体芯片' },
      { code: '159995', name: '芯片ETF', index: '国证芯片' },
      { code: '515880', name: '通信ETF', index: '中证全指通信设备' },
    ],
  },
  {
    keywords: ['证券', '券商'],
    etfs: [
      { code: '512880', name: '证券ETF', index: '证券公司' },
      { code: '159993', name: '龙头券商ETF', index: '证券龙头' },
    ],
  },
  {
    keywords: ['银行', '保险', '高股息', '中特估', '防御资产'],
    etfs: [
      { code: '512800', name: '银行ETF', index: '中证银行' },
      { code: '510880', name: '红利ETF', index: '上证红利' },
      { code: '512960', name: '央企ETF', index: '央企结构调整' },
    ],
  },
  {
    keywords: ['消费电子', '汽车整车', '机器人', '低空经济', '商业航天', '军工装备', '工程机械'],
    etfs: [
      { code: '159732', name: '消费电子ETF', index: '消费电子主题' },
      { code: '515070', name: '人工智能AIETF', index: '人工智能' },
      { code: '512660', name: '军工ETF', index: '中证军工' },
      { code: '516800', name: '智能制造ETF', index: '智能制造主题' },
    ],
  },
  {
    keywords: ['电池', '光伏设备', '风电设备', '新能源'],
    etfs: [
      { code: '515790', name: '光伏ETF', index: '光伏产业' },
      { code: '159755', name: '电池ETF', index: '中证电池主题' },
      { code: '515030', name: '新能源车ETF', index: 'CS新能源汽车' },
    ],
  },
  {
    keywords: ['白酒', '食品饮料', '旅游酒店', '医美概念', '猪肉', '农业消费', '消费复苏'],
    etfs: [
      { code: '512690', name: '酒ETF', index: '中证酒' },
      { code: '159928', name: '消费ETF', index: '中证主要消费' },
      { code: '159825', name: '农业ETF', index: '中证农业主题' },
    ],
  },
  {
    keywords: ['创新药', '医药商业', '医药', '医美概念'],
    etfs: [
      { code: '159992', name: '创新药ETF', index: '中证创新药产业' },
      { code: '512010', name: '医药ETF', index: '沪深300医药卫生' },
      { code: '159837', name: '生物科技ETF', index: '中证生物科技' },
    ],
  },
  {
    keywords: ['有色金属', '煤炭', '稀土永磁', '资源周期', '周期'],
    etfs: [
      { code: '512400', name: '有色金属ETF', index: '中证申万有色金属' },
      { code: '515220', name: '煤炭ETF', index: '中证煤炭' },
      { code: '516780', name: '稀土ETF', index: '中证稀土产业' },
    ],
  },
  {
    keywords: ['房地产', '地产链'],
    etfs: [
      { code: '512200', name: '房地产ETF', index: '中证全指房地产' },
      { code: '159745', name: '建材ETF', index: '中证全指建筑材料' },
    ],
  },
];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function stringifyEtf(etf) {
  return `${etf.code} ${etf.name}`;
}

export function parseEtfCode(label) {
  return String(label || '').match(/\b\d{6}\b/)?.[0] || '';
}

export function normalizeEtfLabel(etf) {
  if (typeof etf === 'string') return etf;
  if (!etf) return '未知 ETF';
  return stringifyEtf(etf);
}

export function matchSectorEtfs(sectorName = '', category = '') {
  const text = `${sectorName} ${category}`.toLowerCase();
  const matched = ETF_RULES.filter((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())))
    .flatMap((rule) => rule.etfs.map(stringifyEtf));

  return [...new Set(matched)].slice(0, 4);
}

export function buildEtfQuoteMap(quotes = []) {
  return new Map(quotes.filter((quote) => quote?.code).map((quote) => [String(quote.code), quote]));
}

function getQuoteForLabel(label, quoteMap) {
  const code = parseEtfCode(label);
  if (!code || !quoteMap) return null;
  if (quoteMap instanceof Map) return quoteMap.get(code) || null;
  return quoteMap[code] || null;
}

export function buildEtfWatchlist(sectors = [], quoteMap = new Map()) {
  const bucket = new Map();

  sectors.forEach((sector) => {
    const etfs = sector.relatedEtfs?.length ? sector.relatedEtfs : matchSectorEtfs(sector.name, sector.category);
    etfs.forEach((etf) => {
      const label = normalizeEtfLabel(etf);
      const quote = getQuoteForLabel(label, quoteMap);
      const prev = bucket.get(label) || {
        label,
        code: parseEtfCode(label),
        quote,
        score: 0,
        hotScore: 0,
        fund: 0,
        sectors: [],
      };

      const quoteBonus = quote ? clamp(quote.changePct * 1.5 + Math.log10((quote.amount || 0) + 1) * 2 - Math.abs(quote.premiumRate || 0) * 1.2, -8, 12) : 0;
      const score = clamp(sector.hotScore + sector.mainNetInRatio * 2 + sector.changePct * 1.8 + sector.riseRatio * 0.08 + quoteBonus, 0, 100);

      prev.score = Math.max(prev.score, score);
      prev.hotScore = Math.max(prev.hotScore, sector.hotScore);
      prev.fund += sector.mainNetIn;
      prev.sectors.push(sector.name);
      prev.quote = prev.quote || quote;
      bucket.set(label, prev);
    });
  });

  return [...bucket.values()]
    .map((item) => ({
      ...item,
      sectors: [...new Set(item.sectors)].slice(0, 3),
      signal: item.score >= 78 ? '高热观察' : item.score >= 62 ? '加入观察' : '低优先级',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function collectEtfLabelsFromSectors(sectors = []) {
  return [...new Set(
    sectors.flatMap((sector) => sector.relatedEtfs?.length ? sector.relatedEtfs : matchSectorEtfs(sector.name, sector.category)).map(normalizeEtfLabel),
  )];
}
