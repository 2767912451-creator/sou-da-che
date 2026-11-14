// ============================================================
// 搜打撤 - 确定性海岛地形（服务端与前端共用同一函数）
// 坐标系：x 向东，z 向南，y 向上，原点在岛屿中心
// ============================================================
import { MAP, POIS } from './constants.js';

function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const u = smooth(fx), v = smooth(fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z, seed, oct) {
  let amp = 1, freq = 1, sum = 0, max = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x * freq, z * freq, seed + i * 131);
    max += amp; amp *= 0.5; freq *= 2;
  }
  return sum / max;
}

// POI 压平混合权重（0 = 完全取 POI 高度）
function poiFlatten(x, z) {
  let best = 0, bestY = 0;
  for (const p of POIS) {
    const dx = x - p.x, dz = z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < p.r) {
      const w = Math.max(0, (d / p.r - 0.62) / 0.38); // 内 62% 完全平
      const f = w * w * (3 - 2 * w);
      if (1 - f > best) { best = 1 - f; bestY = p.y; }
    }
  }
  return best ? [best, bestY] : [0, 0];
}

// 机场跑道区域额外压平（长条形）
function runwayFlatten(x, z) {
  // 跑道中心 (60,-180) 长约 300m 宽 26m
  const dx = Math.max(0, Math.abs(x - 60) - 150);
  const dz = Math.max(0, Math.abs(z + 180) - 13);
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 30) {
    const w = Math.max(0, d / 30);
    const f = w * w * (3 - 2 * w);
    return [1 - f, 5];
  }
  return [0, 0];
}

export const ISLAND = { centerR: 540 };

/**
 * 地形高度函数（米）。0 为海平面。
 */
export function terrainHeight(x, z) {
  const R = MAP.SIZE / 2;
  const d = Math.sqrt(x * x + z * z) / R;
  // 岛屿衰减：0.45R 以内基本平坦，边缘沉入海
  const base = 1 - Math.min(1, Math.max(0, (d - 0.45) / 0.5));
  const bb = base * base * (3 - 2 * base);

  let h = (fbm(x * 0.006, z * 0.006, MAP.SEED, 4) - 0.46) * 96 * bb;
  // 中央山脉
  const md = Math.sqrt((x + 140) * (x + 140) + (z + 60) * (z + 60));
  h += Math.exp(-(md * md) / (2 * 150 * 150)) * 78 * bb;
  // 南侧丘陵
  const hd = Math.sqrt((x - 220) * (x - 220) + (z - 300) * (z - 300));
  h += Math.exp(-(hd * hd) / (2 * 130 * 130)) * 40 * bb;
  // 边缘下沉
  h -= (1 - bb) * 16;

  const [fw, fy] = poiFlatten(x, z);
  if (fw > 0) h = fy * fw + h * (1 - fw);
  const [rw, ry] = runwayFlatten(x, z);
  if (rw > 0) h = ry * rw + h * (1 - rw);

  return h;
}

/** 地面法线（用于角色贴坡、判断陡峭度） */
export function terrainNormal(x, z) {
  const e = 1.2;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const n = { x: -hx, y: 2 * e, z: -hz };
  const len = Math.hypot(n.x, n.y, n.z);
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

/** 地形坡度（0 平地 - 1 垂直），用于禁止在悬崖上生成物体 */
export function terrainSlope(x, z) {
  const n = terrainNormal(x, z);
  return 1 - n.y;
}
