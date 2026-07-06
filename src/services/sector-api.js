import { SECTOR_DATA } from '../data/mock-sectors.js';

/**
 * 当前是前端 Mock 适配层。
 * 后续接入真实后端时，只需要把这里改成 fetch API。
 */
export function getSectorData(type) {
  return SECTOR_DATA[type] || [];
}

export async function fetchSectorHeatmap({ type = 'industry' } = {}) {
  // 真实接口示例：
  // const response = await fetch(`/api/sector/heatmap?type=${type}&period=today`);
  // if (!response.ok) throw new Error('获取板块热力图失败');
  // return response.json();
  return getSectorData(type);
}

export const SECTOR_API_CONTRACT = {
  heatmap: '/api/sector/heatmap?type=industry&period=today&metric=change',
  detail: '/api/sector/:code/detail',
  stocks: '/api/sector/:code/stocks',
};
