import { SECTOR_DATA } from '../data/mock-sectors.js';

let tick = 0;

const STOCK_POOLS = {
  TMT: ['科大讯飞', '浪潮信息', '中际旭创', '新易盛', '紫光股份', '金山办公', '中科曙光', '寒武纪'],
  金融: ['东方财富', '中信证券', '招商银行', '中国平安', '南京银行', '华泰证券', '中国太保', '同花顺'],
  消费科技: ['立讯精密', '歌尔股份', '蓝思科技', '工业富联', '鹏鼎控股', '环旭电子', '传音控股', '领益智造'],
  先进制造: ['三一重工', '汇川技术', '中航沈飞', '徐工机械', '赛力斯', '比亚迪', '中国卫星', '航天宏图'],
  新能源: ['宁德时代', '亿纬锂能', '隆基绿能', '阳光电源', '通威股份', '金风科技', '明阳智能', '天齐锂业'],
  大消费: ['贵州茅台', '五粮液', '伊利股份', '海天味业', '古井贡酒', '安井食品', '中国中免', '泸州老窖'],
  医药: ['恒瑞医药', '百济神州', '药明康德', '迈瑞医疗', '爱尔眼科', '上海医药', '国药一致', '智飞生物'],
  周期: ['紫金矿业', '中国神华', '陕西煤业', '北方铜业', '中国铝业', '宝钢股份', '洛阳钼业', '兖矿能源'],
  地产链: ['万科A', '保利发展', '滨江集团', '东方雨虹', '北新建材', '伟星新材', '金地集团', '招商蛇口'],
  人工智能: ['昆仑万维', '科大讯飞', '工业富联', '中际旭创', '新易盛', '润泽科技', '寒武纪', '浪潮信息'],
  智能制造: ['汇川技术', '鸣志电器', '万丰奥威', '宗申动力', '航天宏图', '中国卫星', '机器人', '埃斯顿'],
  数字经济: ['中国软件', '浪潮信息', '人民网', '易华录', '云赛智联', '太极股份', '深桑达A', '数据港'],
  估值修复: ['中国移动', '中国中铁', '中国铁建', '中国交建', '中国电建', '中国建筑', '中国联通', '中国核电'],
  防御资产: ['长江电力', '华能水电', '中国神华', '中国移动', '工商银行', '农业银行', '陕西煤业', '中国海油'],
  资源周期: ['北方稀土', '中国稀土', '紫金矿业', '洛阳钼业', '厦门钨业', '盛和资源', '江西铜业', '中金黄金'],
  农业消费: ['牧原股份', '温氏股份', '新希望', '海大集团', '唐人神', '巨星农牧', '天康生物', '立华股份'],
  消费复苏: ['中国中免', '锦江酒店', '首旅酒店', '宋城演艺', '爱美客', '华熙生物', '贝泰妮', '珀莱雅'],
};

const CODE_PREFIX = ['600', '601', '603', '000', '002', '300', '688'];

function getApiBase() {
  try {
    return window.localStorage.getItem('JIJIN_API_BASE')?.replace(/\/$/, '') || '';
  } catch {
    return '';
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 2) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function jitter(seed, range) {
  const wave = Math.sin((tick + 1) * (seed + 3) * 1.731) * range;
  const random = (Math.random() - 0.5) * range * 0.55;
  return wave + random;
}

function parseEtfCode(label) {
  return String(label || '').match(/\b\d{6}\b/)?.[0] || '';
}

function getEtfName(label) {
  return String(label || '').replace(/^\d{6}\s*/, '').trim() || 'ETF';
}

function withRealtimePulse(item, index) {
  const changeDelta = jitter(index, 0.16);
  const fundDelta = jitter(index + 9, 0.48);
  const amountDelta = Math.max(0.88, 1 + jitter(index + 17, 0.035));
  const upDownDelta = Math.round(jitter(index + 23, 2.4));
  const total = item.upCount + item.downCount;
  const nextUp = Math.min(Math.max(0, item.upCount + upDownDelta), total);

  return {
    ...item,
    changePct: round(item.changePct + changeDelta, 2),
    amount: round(item.amount * amountDelta, 1),
    mainNetIn: round(item.mainNetIn + fundDelta, 1),
    mainNetInRatio: round(item.mainNetInRatio + fundDelta * 0.08, 2),
    superLargeNetIn: round(item.superLargeNetIn + fundDelta * 0.36, 1),
    bigNetIn: round(item.bigNetIn + fundDelta * 0.64, 1),
    upCount: nextUp,
    downCount: total - nextUp,
    leadingStockChangePct: round(Math.max(-9.9, item.leadingStockChangePct + jitter(index + 31, 0.22)), 2),
  };
}

function getMockHeatmap(type, realtime) {
  const data = clone(getSectorData(type));
  if (!realtime) return data;
  tick += 1;
  return data.map(withRealtimePulse);
}

function getMockStocks(sector) {
  const pool = STOCK_POOLS[sector.category] || STOCK_POOLS.TMT;
  const spreadBias = sector.changePct / 3;

  return pool.slice(0, 8).map((name, index) => {
    const changePct = round(sector.changePct + jitter(index + sector.id.length, 1.4) - index * 0.18, 2);
    const fundNetIn = round(sector.mainNetIn / 12 + jitter(index + 19, 0.9) - index * 0.08, 2);
    const amount = round(Math.max(4, sector.amount / 22 + jitter(index + 41, 8) - index * 1.3), 1);
    const turnoverRate = round(Math.max(0.2, sector.turnoverRate + spreadBias + jitter(index + 29, 1.2)), 2);
    const code = `${CODE_PREFIX[index % CODE_PREFIX.length]}${String((sector.id.charCodeAt(2) * 991 + index * 137) % 1000).padStart(3, '0')}`;

    return {
      code,
      name,
      changePct,
      amount,
      turnoverRate,
      fundNetIn,
      role: index === 0 ? '核心龙头' : index < 3 ? '资金前排' : index < 6 ? '弹性跟随' : '观察标的',
    };
  });
}

function getMockEtfQuotes(labels = []) {
  return labels.map((label, index) => {
    const code = parseEtfCode(label);
    const changePct = round(jitter(index + 71, 2.2), 2);
    return {
      code,
      name: getEtfName(label),
      price: round(0.8 + Math.abs(jitter(index + 81, 0.42)), 4),
      changePct,
      amount: round(Math.max(0.8, 8 + jitter(index + 91, 7.2)), 1),
      premiumRate: round(jitter(index + 101, 0.32), 2),
      updatedAt: Date.now(),
    };
  });
}

/**
 * 当前默认使用前端 Mock 数据。
 * 设置 localStorage.JIJIN_API_BASE 后会切换到真实后端，例如：http://localhost:8000
 */
export function getSectorData(type) {
  return SECTOR_DATA[type] || [];
}

export async function fetchSectorHeatmap({ type = 'industry', realtime = true } = {}) {
  const apiBase = getApiBase();

  if (apiBase) {
    try {
      const response = await fetch(`${apiBase}/api/sector/heatmap?type=${type}&period=today`);
      if (!response.ok) throw new Error('获取真实板块热力图失败');
      const payload = await response.json();
      return payload.nodes || [];
    } catch (error) {
      console.warn('真实后端不可用，已回退到 Mock 数据：', error);
    }
  }

  return getMockHeatmap(type, realtime);
}

export async function fetchSectorStocks(sector) {
  const apiBase = getApiBase();

  if (apiBase) {
    try {
      const response = await fetch(`${apiBase}/api/sector/${encodeURIComponent(sector.id)}/stocks?type=${sector.type || 'industry'}`);
      if (!response.ok) throw new Error('获取真实板块成份股失败');
      const payload = await response.json();
      return payload.stocks || [];
    } catch (error) {
      console.warn('真实成份股接口不可用，已回退到 Mock 数据：', error);
    }
  }

  return getMockStocks(sector);
}

export async function fetchEtfQuotes(labels = []) {
  const uniqueLabels = [...new Set(labels.filter(Boolean))];
  const codes = uniqueLabels.map(parseEtfCode).filter(Boolean);
  const apiBase = getApiBase();

  if (apiBase && codes.length) {
    try {
      const response = await fetch(`${apiBase}/api/etf/quotes?codes=${codes.join(',')}`);
      if (!response.ok) throw new Error('获取真实 ETF 行情失败');
      const payload = await response.json();
      return payload.quotes || [];
    } catch (error) {
      console.warn('真实 ETF 行情不可用，已回退到 Mock 数据：', error);
    }
  }

  return getMockEtfQuotes(uniqueLabels);
}

export function getDataModeLabel() {
  return getApiBase() ? '真实接口' : 'Mock 模拟';
}

export const SECTOR_API_CONTRACT = {
  heatmap: '/api/sector/heatmap?type=industry&period=today&metric=change',
  detail: '/api/sector/:code/detail',
  stocks: '/api/sector/:code/stocks',
  etfQuotes: '/api/etf/quotes?codes=512480,159995',
};
