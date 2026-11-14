// ============================================================
// 海岛世界生成 v2
// 多层建筑（双层楼+楼梯+楼层地板）、窗户、斜屋顶、主题配色
// 家具/保险柜、集装箱堆、小船/沙袋/油桶等道具，箱子靠墙摆放
// 输出与客户端共用：walls（碰撞+渲染，带颜色）、floors（可站楼层）、
// roofs / props（纯渲染）、lootSpawns（战利品点）、buildings、trees、rocks
// ============================================================
import { MAP, POIS, FOREST_ZONES } from '../shared/constants.js';
import { terrainHeight, terrainSlope } from '../shared/terrain.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL_T = 0.3;
const DOOR_W = 2.6;

let world = null;

export function getWorld() {
  if (!world) world = generate();
  return world;
}

function addBox(ctx, cx, cz, w, d, y0, y1, kind, c) {
  ctx.walls.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y0, y1, kind, c });
}

function addFloor(ctx, cx, cz, w, d, y) {
  ctx.floors.push({ x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2, y });
}

function addRoof(ctx, x, z, w, d, y, c) {
  const ridgeH = Math.min(1.7, Math.min(w, d) * 0.2);
  ctx.roofs.push({ x, z, y, w, d, c, ridgeH });
  // 屋顶碰撞阶梯：双坡各 3 级（跳伞落屋顶不穿入室内，且可站屋顶）
  const stripD = (d / 2 + 0.5) / 3;
  const extX = w / 2 + 0.5;
  for (let i = 0; i < 3; i++) {
    // 北坡（从南缘向脊）
    const nZ0 = z + d / 2 + 0.5 - stripD * (i + 1);
    const nY = y + ridgeH * ((i + 1) / 3);
    addBox(ctx, x, nZ0 + stripD / 2, extX * 2, stripD, nY - 0.34, nY, 'roof', c);
    addFloor(ctx, x, nZ0 + stripD / 2, extX * 2, stripD, nY);
    // 南坡
    const sZ0 = z - d / 2 - 0.5 + stripD * i;
    addBox(ctx, x, sZ0 + stripD / 2, extX * 2, stripD, nY - 0.34, nY, 'roof', c);
    addFloor(ctx, x, sZ0 + stripD / 2, extX * 2, stripD, nY);
  }
}

function addProp(ctx, kind, x, z, y, c, rot = 0, s = 1) {
  ctx.props.push({ kind, x, z, y, c, rot, s });
}

function lootOn(ctx, x, y, z, tier, n = 1) {
  for (let i = 0; i < n; i++) {
    ctx.lootSpawns.push({ x: x + (ctx.rng() - 0.5) * 0.7, y, z: z + (ctx.rng() - 0.5) * 0.7, tier });
  }
}

/**
 * 带门窗的墙体：沿轴一整面，挖门/留窗
 * side: 'n' | 's' | 'w' | 'e'（n = -z）
 */
function wallSide(ctx, bx, bz, len, y0, y1, side, opts) {
  const t = WALL_T;
  const horizontal = side === 'n' || side === 's';
  const c = opts.c;
  const seg = (a0, a1, yy0, yy1) => {
    const len2 = a1 - a0;
    if (len2 <= 0.05 || yy1 - yy0 <= 0.05) return;
    if (horizontal) addBox(ctx, (a0 + a1) / 2, bz, len2, t, yy0, yy1, 'wall', c);
    else addBox(ctx, bx, (a0 + a1) / 2, t, len2, yy0, yy1, 'wall', c);
  };
  const doorW = DOOR_W;
  const winY0 = y0 + 1.05, winY1 = Math.max(winY0 + 0.05, y1 - 0.55);
  if (opts.door) {
    const mid = horizontal ? bx : bz;
    const a0 = mid - len / 2, a1 = mid + len / 2;
    const dA0 = mid - doorW / 2, dA1 = mid + doorW / 2;
    seg(a0, dA0, y0, y1);
    seg(dA1, a1, y0, y1);
    seg(dA0, dA1, y0 + 2.15, y1);           // 门楣
  } else if (opts.win && len > 4.5) {
    const mid = horizontal ? bx : bz;
    const a0 = mid - len / 2, a1 = mid + len / 2;
    seg(a0, a0 + 0.6, y0, y1);
    seg(a1 - 0.6, a1, y0, y1);
    seg(a0 + 0.6, a1 - 0.6, y0, winY0);     // 窗台
    seg(a0 + 0.6, a1 - 0.6, winY1, y1);     // 窗楣
  } else {
    const mid = horizontal ? bx : bz;
    seg(mid - len / 2, mid + len / 2, y0, y1);
  }
}

/**
 * 楼梯（实体踏步，每步是一个可站立的楼层块），沿 +x 方向上升
 */
function addStairs(ctx, x0, z, y0, y1, c) {
  const n = Math.max(4, Math.ceil((y1 - y0) / 0.3));
  const rise = (y1 - y0) / n, depth = 0.46;
  for (let i = 0; i < n; i++) {
    const topY = y0 + rise * (i + 1);
    // 薄片踏步：厚 0.34，顶面即可站楼层
    addBox(ctx, x0 + i * depth + depth / 2, z, depth, 1.3, topY - 0.34, topY, 'slab', c);
    addFloor(ctx, x0 + i * depth + depth / 2, z, depth, 1.3, topY);
  }
  return n * depth;
}

function addFurniture(ctx, kind, x, z, tier, fy = null) {
  const dims = {
    table: { w: 1.5, d: 0.85, h: 0.78 },
    cabinet: { w: 1.0, d: 0.55, h: 1.7 },
    shelf: { w: 1.4, d: 0.5, h: 1.85 },
    safe: { w: 0.6, d: 0.6, h: 0.62 },
    bed: { w: 1.1, d: 2.0, h: 0.55 },
    wardrobe: { w: 1.2, d: 0.6, h: 2.1 },
    kitchen: { w: 1.8, d: 0.6, h: 0.9 },
    bookshelf: { w: 1.2, d: 0.4, h: 1.9 },
    lamp: { w: 0.35, d: 0.35, h: 1.4 },
    rug: { w: 2.2, d: 1.6, h: 0.04 },
    tv: { w: 1.2, d: 0.4, h: 0.7 },
    sink: { w: 0.8, d: 0.55, h: 0.85 },
  }[kind];
  if (!dims) return;
  const y = fy !== null ? fy : terrainHeight(x, z);
  const id = 'F' + (ctx.furniture.length + 1);
  addBox(ctx, x, z, dims.w, dims.d, y, y + dims.h, 'furn');
  ctx.furniture.push({ id, kind, x, z, y, ...dims });
  const lootable = kind !== 'rug' && kind !== 'lamp';
  if (lootable) {
    const n = kind === 'shelf' || kind === 'bookshelf' ? 2 : (1 + (ctx.rng() < 0.5 ? 1 : 0));
    lootOn(ctx, x, y + dims.h, z, tier, n);
  }
  return id;
}

/**
 * 建筑生成 v2
 * spec: { x, z, w, d, floorH, floors(1|2), door, win, c, roofC, tier,
 *         furnG: {tables, cabinets, shelves, safes, beds}, furn2: {...}, crates, roof }
 */
function addBuilding(ctx, spec) {
  const { x, z, w, d, floorH = 2.9, door = 's', c = '#c7c0b0', roofC = '#8a5a3a', tier = 1 } = spec;
  const y = terrainHeight(x, z);
  const floorsN = spec.floors || 1;
  const win = spec.win !== false;
  const hw = w / 2, hd = d / 2;
  ctx.buildings.push({ x, z, w, d, h: floorH * floorsN + 0.8, y, door, kind: 'b2', c });

  const sides = { n: [x, z - hd, w], s: [x, z + hd, w], w: [x - hw, z, d], e: [x + hw, z, d] };

  // ---- 室内地板薄板（盖住地形坡度，室内平整）----
  const floorY = y + 0.08;
  addBox(ctx, x, z, w - 0.35, d - 0.35, y, floorY, 'slab', spec.floorC || '#7a6248');
  addFloor(ctx, x, z, w - 0.35, d - 0.35, floorY);

  // ---- 一层墙 ----
  for (const side of ['n', 's', 'w', 'e']) {
    const [sx, sz, len] = sides[side];
    wallSide(ctx, sx, sz, len, floorY, floorY + floorH, side, { door: side === door, win: win && side !== door, c });
  }

  // ---- 二层 ----
  if (floorsN === 2) {
    const slabY = floorY + floorH + 0.12;
    const stZ = z - hd + 1.15;              // 楼梯带中心（贴北墙内侧）
    const stX0 = x - hw + 0.9;              // 楼梯起点（西端，向下走）
    // 先建楼梯（向东上升），得到进深 used
    const used = addStairs(ctx, stX0, stZ, floorY, slabY, c);
    // 楼板开口：覆盖楼梯顶部一段（保证爬升时头部不撞楼板）
    const openX0 = Math.max(stX0 - 0.2, stX0 + used - 2.5);
    const openX1 = stX0 + used + 0.6;
    // 楼板分块（去掉开口区）
    const pwE = x + hw - openX1;
    if (pwE > 0.3) {
      addBox(ctx, openX1 + pwE / 2, z, pwE, d - 0.4, slabY - 0.12, slabY, 'slab', c);
      addFloor(ctx, openX1 + pwE / 2, z, pwE, d - 0.4, slabY);
    }
    const pwW = openX0 - (x - hw);
    if (pwW > 0.3) {
      addBox(ctx, x - hw + pwW / 2, z, pwW, d - 0.4, slabY - 0.12, slabY, 'slab', c);
      addFloor(ctx, x - hw + pwW / 2, z, pwW, d - 0.4, slabY);
    }
    const pdS = z + hd - (stZ + 0.65);
    if (pdS > 0.3) {
      addBox(ctx, (openX0 + openX1) / 2, stZ + 0.65 + pdS / 2, openX1 - openX0, pdS, slabY - 0.12, slabY, 'slab', c);
      addFloor(ctx, (openX0 + openX1) / 2, stZ + 0.65 + pdS / 2, openX1 - openX0, pdS, slabY);
    }
    const pdN = stZ - 0.65 - (z - hd);
    if (pdN > 0.3) {
      addBox(ctx, (openX0 + openX1) / 2, z - hd + pdN / 2, openX1 - openX0, pdN, slabY - 0.12, slabY, 'slab', c);
      addFloor(ctx, (openX0 + openX1) / 2, z - hd + pdN / 2, openX1 - openX0, pdN, slabY);
    }
    const y2 = slabY + floorH - 0.12;
    for (const side of ['n', 's', 'w', 'e']) {
      const [sx, sz, len] = sides[side];
      wallSide(ctx, sx, sz, len, slabY, y2, side, { door: false, win: len > 4.5, c });
    }
    const f2 = spec.furn2 || {};
    for (let i = 0; i < (f2.tables || 0); i++) addFurniture(ctx, 'table', x + 1.2 + i * 1.8, z + hd - 1.6, tier, slabY);
    if (f2.cabinets) addFurniture(ctx, 'cabinet', x + hw - 1.0, z + hd - 1.0, tier, slabY);
    if (f2.beds) addFurniture(ctx, 'bed', x - hw + 1.4, z + 0.8, tier, slabY);
    if (spec.roof !== false) addRoof(ctx, x, z, w, d, y2, spec.roofC || '#8a5a3a');
    if (spec.sign) ctx.props.push({ kind: 'sign', x, z, y: y2 + 0.9, c: spec.sign, w: 2.4 });
  }

  // ---- 一层家具 ----
  const f1 = spec.furnG || {};
  for (let i = 0; i < (f1.tables || 0); i++) addFurniture(ctx, 'table', x - hw + 1.6 + i * 2.0, z + hd - 1.2, tier, floorY);
  for (let i = 0; i < (f1.cabinets || 0); i++) addFurniture(ctx, 'cabinet', x + hw - 1.0 - i * 1.4, z - hd + 1.2, tier, floorY);
  for (let i = 0; i < (f1.shelves || 0); i++) addFurniture(ctx, 'shelf', x - 2 + i * 2.2, z - hd + 1.0, tier, floorY);
  for (let i = 0; i < (f1.safes || 0); i++) addFurniture(ctx, 'safe', x + hw - 1.0, z + hd - 1.0 - i * 1.2, tier, floorY);
  for (let i = 0; i < (f1.beds || 0); i++) addFurniture(ctx, 'bed', x - hw + 1.4, z - hd + 1.6, tier, floorY);
  for (let i = 0; i < (f1.wardrobes || 0); i++) addFurniture(ctx, 'wardrobe', x + hw - 1.2, z - hd + 1.2 + i * 1.4, tier, floorY);
  for (let i = 0; i < (f1.kitchens || 0); i++) addFurniture(ctx, 'kitchen', x - hw + 1.2, z - hd + 1.0 + i * 0.7, tier, floorY);
  for (let i = 0; i < (f1.bookshelves || 0); i++) addFurniture(ctx, 'bookshelf', x - hw + 2.2 + i * 1.5, z + hd - 0.5, tier, floorY);
  for (let i = 0; i < (f1.lamps || 0); i++) addFurniture(ctx, 'lamp', x + hw - 1.0, z - hd + 1.0, tier, floorY);
  for (let i = 0; i < (f1.tvs || 0); i++) addFurniture(ctx, 'tv', x, z - hd + 0.5, tier, floorY);
  for (let i = 0; i < (f1.sinks || 0); i++) addFurniture(ctx, 'sink', x - hw + 1.0, z + hd - 0.8, tier, floorY);
  if (f1.rug) {
    ctx.props.push({ kind: 'rug', x: x, z: z, y: floorY + 0.02, c: f1.rug, s: 1, w: Math.min(w - 2, 3), d: Math.min(d - 2, 2.2) });
  }

  // ---- 屋顶 ----
  if (floorsN === 1 && spec.roof !== false) {
    addRoof(ctx, x, z, w, d, floorY + floorH, spec.roofC || '#8a5a3a');
    if (spec.sign) ctx.props.push({ kind: 'sign', x, z, y: floorY + floorH + 0.9, c: spec.sign, w: 2.4 });
  }

  // ---- 箱子靠外墙 ----
  for (let i = 0; i < (spec.crates || 0); i++) {
    const sideIdx = Math.floor(ctx.rng() * 4);
    const [sx, sz] = [
      [x - hw - 0.8, z + ctx.rng() * d - d / 2], [x + hw + 0.8, z + ctx.rng() * d - d / 2],
      [x + ctx.rng() * w - w / 2, z - hd - 0.8], [x + ctx.rng() * w - w / 2, z + hd + 0.8],
    ][sideIdx];
    const cy = terrainHeight(sx, sz);
    addBox(ctx, sx, sz, 1.3, 1.3, cy, cy + 1.2, 'crate');
    if (ctx.rng() < 0.5) lootOn(ctx, sx, cy + 1.2, sz, tier, 1);
  }
}

function addTower(ctx, x, z, tier, c = '#5d6a5a') {
  const y = terrainHeight(x, z);
  addBox(ctx, x, z, 2.8, 2.8, y, y + 6.5, 'tower', c);
  addBox(ctx, x, z, 3.6, 3.6, y + 6.5, y + 7.0, 'slab', c);
  addFloor(ctx, x, z, 3.6, 3.6, y + 7.0);
  ctx.buildings.push({ x, z, w: 3.6, d: 3.6, h: 7, y, door: 'n', kind: 'tower', c });
  lootOn(ctx, x + 0.6, y + 7.0, z - 0.6, tier, 1);
}

function addPoi(ctx, poi) {
  const { x, z, r, y, tier } = poi;
  const rng = ctx.rng;
  const jitter = (a) => (rng() - 0.5) * a;

  switch (poi.key) {
    case 'fish': {
      const spots = [[-60, -40, 'n'], [10, -55, 'e'], [55, -25, 's'], [-35, 15, 'w'], [25, 25, 'n'], [-70, 35, 'e']];
      for (const [dx, dz, door] of spots) {
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 12 + jitter(2), d: 10 + jitter(2), floorH: 2.8, floors: 2,
          door, win: true, c: '#9a7a52', roofC: '#7a4a3a', tier: 1,
          furnG: { tables: 1, cabinets: 1 }, furn2: { beds: 1 }, crates: 1,
        });
      }
      for (const [bx, bz, rot] of [[x - 90, z + 150, 0.4], [x - 60, z + 170, -0.2], [x + 40, z + 155, 0.1]]) {
        addProp(ctx, 'boat', bx, bz, 0, '#c9d8e2', rot);
      }
      break;
    }
    case 'resort': {
      addBuilding(ctx, {
        x: x - 55, z: z - 35, w: 24, d: 15, floorH: 3.0, floors: 2, door: 's', win: true,
        c: '#f2e8da', roofC: '#c96a5a', tier: 2,
        furnG: { tables: 2, cabinets: 1, safes: 1, lamps: 1, rugs: '#4a6a8a' }, furn2: { beds: 2, tables: 1, wardrobes: 1, sinks: 1 }, crates: 2,
      });
      addBuilding(ctx, {
        x: x + 52, z: z - 48, w: 18, d: 12, floorH: 2.9, floors: 2, door: 'w', win: true,
        c: '#f2e8da', roofC: '#c96a5a', tier: 2,
        furnG: { tables: 1, cabinets: 1, safes: 1, lamps: 1, bookshelves: 1 }, furn2: { beds: 1, wardrobes: 1 }, crates: 1,
      });
      addBuilding(ctx, {
        x: x, z: z + 55, w: 22, d: 13, floorH: 2.9, floors: 1, door: 'n', win: true,
        c: '#f2e8da', roofC: '#c96a5a', tier: 2,
        furnG: { tables: 2, cabinets: 1, shelves: 1 }, crates: 1,
      });
      ctx.buildings.push({ x: x + 10, z: z + 5, w: 12, d: 8, h: 0.6, y: y - 0.4, door: null, kind: 'pool', c: '#3aa8c9' });
      for (const [ux, uz] of [[x - 20, z + 2], [x + 40, z + 6], [x - 2, z + 50]]) {
        addProp(ctx, 'umbrella', ux, uz, y, '#ff8855');
      }
      break;
    }
    case 'base': {
      const hw = r - 10;
      const t = 0.5;
      for (const [side, seg] of [['n', [x - hw, z - hw, x + hw, z - hw]], ['s', [x - hw, z + hw, x + hw, z + hw]], ['w', [x - hw, z - hw, x - hw, z + hw]], ['e', [x + hw, z - hw, x + hw, z + hw]]]) {
        const [ax0, az0, ax1, az1] = seg;
        const mid = side === 'n' || side === 's' ? x : z;
        if (side === 'n' || side === 's') {
          addBox(ctx, (ax0 + mid - 4) / 2, az0, (mid - 4) - ax0, t, y, y + 3.2, 'wall', '#7a7a72');
          addBox(ctx, (mid + 4 + ax1) / 2, az0, ax1 - (mid + 4), t, y, y + 3.2, 'wall', '#7a7a72');
        } else {
          addBox(ctx, ax0, (az0 + mid - 4) / 2, t, (mid - 4) - az0, y, y + 3.2, 'wall', '#7a7a72');
          addBox(ctx, ax0, (mid + 4 + az1) / 2, t, az1 - (mid + 4), y, y + 3.2, 'wall', '#7a7a72');
        }
      }
      const wh = [[-110, -110], [95, -100], [-95, 105], [105, 95], [-10, -150], [-150, 10]];
      wh.forEach(([dx, dz], i) => {
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 26, d: 16, floorH: 3.4, floors: i < 2 ? 2 : 1, door: dz < 0 ? 's' : 'n',
          win: true, c: '#8a8a80', roofC: '#55605a', tier: 3,
          furnG: { tables: 3, cabinets: 2, shelves: 2, safes: i % 2 === 0 ? 1 : 0, rugs: '#3a4a3a' },
          furn2: i < 2 ? { beds: 3, cabinets: 1, wardrobes: 1 } : undefined, crates: 3,
        });
      });
      // 军火库（特色建筑：深色、重货架、枪械高货）
      addBuilding(ctx, {
        x: x - 5, z: z - 5, w: 20, d: 14, floorH: 3.6, floors: 1, door: 's', win: true,
        c: '#4a4a52', roofC: '#2a2a30', tier: 3,
        furnG: { shelves: 4, tables: 2, safes: 1, rugs: '#2a2a32' }, crates: 3,
      });
      for (const [bx, bz] of [[x - 40, z - 30], [x + 45, z + 15], [x - 15, z + 55], [x + 60, z - 60], [x - 70, z + 70], [x + 110, z + 40], [x - 120, z - 90]]) {
        addProp(ctx, 'sandbag', bx, bz, y, '#a89a6a');
      }
      addProp(ctx, 'antenna', x + hw - 12, z - hw + 12, y, '#888888');
      addTower(ctx, x - hw + 12, z - hw + 12, 3, '#5d6a5a');
      addTower(ctx, x + hw - 12, z + hw - 12, 3, '#5d6a5a');
      addTower(ctx, x - hw + 12, z + hw - 12, 3, '#5d6a5a');
      ctx.buildings.push({ x, z: z + 170, w: 20, d: 20, h: 0.3, y, door: null, kind: 'helipad', c: '#3c4650' });
      lootOn(ctx, x + 5, y, z + 170, 3, 1);
      lootOn(ctx, x - 5, y, z + 168, 3, 1);
      for (let i = 0; i < 10; i++) {
        const bx = x + jitter(200), bz = z + jitter(200);
        addProp(ctx, 'sandbag', bx, bz, terrainHeight(bx, bz), '#a89a6a');
      }
      break;
    }
    case 'port': {
      const wh = [[-50, -30], [45, -40], [0, 45]];
      wh.forEach(([dx, dz], i) => {
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 22, d: 13, floorH: 3.2, floors: 1, door: dz > 0 ? 'n' : 's',
          win: true, c: '#a05040', roofC: '#3a6a8a', tier: 2,
          furnG: { tables: 1, cabinets: 1, shelves: 2, safes: i === 0 ? 1 : 0 }, crates: 2,
        });
      });
      const colors = ['#c94a4a', '#3a7ac9', '#4aa85a', '#d0a03a'];
      let ci = 0;
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 4; col++) {
          const cx = x - 70 + col * 14, cz = z + 8 + row * 12;
          const cc = colors[ci++ % colors.length];
          const cy = terrainHeight(cx, cz);
          addBox(ctx, cx, cz, 6, 2.6, cy, cy + 2.6, 'container', cc);
          addProp(ctx, 'container', cx, cz, cy + 2.6, colors[(ci + 2) % colors.length]);
          lootOn(ctx, cx, cy + 2.6, cz, 2, 1);
        }
      }
      break;
    }
    case 'mine': {
      for (const [dx, dz] of [[-35, -20], [10, -35], [35, 10], [-10, 30]]) {
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 6, d: 5, floorH: 2.3, floors: 1, door: 's',
          win: false, c: '#6a5a4a', roofC: '#4a3a2a', tier: 1,
          furnG: { tables: 1 }, crates: 1,
        });
      }
      addBuilding(ctx, {
        x: x - 5, z: z - 5, w: 10, d: 7, floorH: 3.0, floors: 1, door: 'e', win: true,
        c: '#6a5a4a', roofC: '#4a3a2a', tier: 1,
        furnG: { tables: 1, cabinets: 1, shelves: 1 }, crates: 2,
      });
      for (const [bx, bz] of [[x + 30, z - 10], [x - 25, z + 15]]) {
        addProp(ctx, 'cart', bx, bz, terrainHeight(bx, bz), '#5a4a3a');
      }
      break;
    }
    case 'airfield': {
      addBuilding(ctx, {
        x: x - 110, z: z - 40, w: 34, d: 24, floorH: 6.5, floors: 1, door: 's', win: true,
        c: '#7a8288', roofC: '#4a5258', tier: 2,
        furnG: { tables: 2, cabinets: 2, shelves: 2, rugs: '#3a4a52' }, crates: 3,
      });
      addBuilding(ctx, {
        x: x + 110, z: z - 40, w: 34, d: 24, floorH: 6.5, floors: 1, door: 's', win: true,
        c: '#7a8288', roofC: '#4a5258', tier: 2,
        furnG: { tables: 2, cabinets: 2, shelves: 2, rugs: '#3a4a52' }, crates: 3,
      });
      addTower(ctx, x, z - 60, 2, '#7a8288');
      break;
    }
    case 'lighthouse': {
      const ty = terrainHeight(x, z);
      addBox(ctx, x, z, 4.4, 4.4, ty, ty + 16, 'lighthouse', '#e8e4da');
      addBox(ctx, x, z, 5.2, 5.2, ty + 16, ty + 16.6, 'slab', '#e8e4da');
      ctx.buildings.push({ x, z, w: 4.4, d: 4.4, h: 16, y: ty, door: null, kind: 'lighthouse', c: '#e8e4da' });
      ctx.buildings.push({ x, z, w: 5.2, d: 5.2, h: 0.6, y: ty + 16, door: null, kind: 'lamp' });
      lootOn(ctx, x + 3.4, ty, z + 3.4, 2, 1);
      addBuilding(ctx, {
        x: x - 24, z: z + 14, w: 11, d: 8, floorH: 2.8, floors: 2, door: 'e', win: true,
        c: '#e8e4da', roofC: '#b83a2a', tier: 2,
        furnG: { tables: 1, cabinets: 1, safes: 1 }, furn2: { beds: 1 }, crates: 1,
      });
      break;
    }
    case 'shack': {
      addBuilding(ctx, {
        x, z, w: 11, d: 9, floorH: 2.8, floors: 2, door: 's', win: true,
        c: '#9a7a52', roofC: '#5a4a3a', tier: 1,
        furnG: { tables: 1, cabinets: 1 }, furn2: { beds: 1 }, crates: 1,
      });
      break;
    }
    case 'town': {
      // 滨海小镇：两排成片民居 + 医院 + 商铺（房屋区，物资在屋内）
      const palette = [
        { c: '#e8d8b8', roof: '#c96a5a' }, { c: '#d8c8e8', roof: '#5a6a9a' },
        { c: '#c8e0d0', roof: '#4a8a6a' }, { c: '#e8c8c8', roof: '#b86a4a' },
        { c: '#d0d8c0', roof: '#6a8a5a' }, { c: '#e0d0b0', roof: '#9a6a4a' },
      ];
      // 医院（特色大建筑：红十字 + 病床 + 医疗高货 + 保险柜）
      addBuilding(ctx, {
        x: x - 5, z: z - 45, w: 24, d: 15, floorH: 3.2, floors: 2, door: 's', win: true,
        c: '#f2ede4', roofC: '#c9c2b4', tier: 3, sign: '#e04040',
        furnG: { beds: 3, cabinets: 2, safes: 1, sinks: 2, rugs: '#c8d8e0' }, furn2: { beds: 3, cabinets: 1, sinks: 1 }, crates: 1,
      });
      // 诊所/商铺（一层，平顶感觉）
      addBuilding(ctx, {
        x: x + 55, z: z - 30, w: 16, d: 11, floorH: 3.0, floors: 1, door: 'w', win: true,
        c: '#d8c49a', roofC: '#5a8a4a', tier: 2,
        furnG: { tables: 2, shelves: 3, cabinets: 1, bookshelves: 2 }, crates: 2,
      });
      // 两排成片民居（颜色/屋顶各不相同，紧密相连）
      const row1 = [[-62, -8, 's'], [-38, -8, 's'], [-14, -8, 's'], [10, -8, 's']];
      const row2 = [[-50, 30, 'n'], [-26, 30, 'n'], [-2, 30, 'n'], [22, 30, 'n']];
      row1.forEach(([dx, dz, door], i) => {
        const p = palette[i % palette.length];
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 11, d: 9, floorH: 2.8, floors: 2, door, win: true,
          c: p.c, roofC: p.roof, tier: 1,
          furnG: { tables: 1, cabinets: 1, kitchens: 1, lamps: 1, rugs: ['#8a6a4a', '#4a6a8a', '#6a4a6a', '#4a7a4a'][i % 4] }, furn2: { beds: 1, wardrobes: 1, tvs: 1, sinks: 1 }, crates: 1,
        });
      });
      row2.forEach(([dx, dz, door], i) => {
        const p = palette[(i + 2) % palette.length];
        addBuilding(ctx, {
          x: x + dx, z: z + dz, w: 11, d: 9, floorH: 2.8, floors: 2, door, win: true,
          c: p.c, roofC: p.roof, tier: 1,
          furnG: { tables: 1, cabinets: 1, bookshelves: 1, lamps: 1, rugs: ['#6a8a5a', '#8a6a4a', '#4a6a8a', '#7a4a6a'][i % 4] }, furn2: { beds: 1, wardrobes: 1, sinks: 1 }, crates: 1,
        });
      });
      // 街道杂物（油桶/箱子靠墙）
      for (const [bx, bz] of [[x - 30, z + 12], [x + 5, z + 12], [x + 40, z + 12], [x - 20, z - 28]]) {
        addProp(ctx, 'barrel', bx, bz, y, rng() < 0.5 ? '#4a8a5a' : '#b86a4a');
      }
      break;
    }
  }
}

function generate() {
  const rng = mulberry32(MAP.SEED);
  const ctx = {
    rng, buildings: [], walls: [], floors: [], roofs: [], props: [], bushes: [],
    lootSpawns: [], trees: [], rocks: [], pois: POIS, furniture: [],
  };

  for (const poi of POIS) addPoi(ctx, poi);

  // 零散双层小屋
  let placed = 0, tries = 0;
  while (placed < 8 && tries < 300) {
    tries++;
    const x = (rng() - 0.5) * 900, z = (rng() - 0.5) * 900;
    const h = terrainHeight(x, z);
    if (h < 3.5 || terrainSlope(x, z) > 0.18) continue;
    let ok = true;
    for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r + 20) { ok = false; break; }
    if (!ok) continue;
    addBuilding(ctx, {
      x, z, w: 12, d: 10, floorH: 2.8, floors: 2, door: 'n', win: true,
      c: '#9a7a52', roofC: '#5a4a3a', tier: 1,
      furnG: { tables: 1, cabinets: 1, kitchens: 1, lamps: 1, rugs: '#6a6a4a' }, furn2: { beds: 1, wardrobes: 1, sinks: 1 }, crates: 1,
    });
    placed++;
  }

  const inRunway = (x, z) => Math.abs(x - 60) < 165 && Math.abs(z + 180) < 18;
  const clearOfBuildings = (x, z, margin) => {
    for (const b of ctx.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin) return false;
    }
    return true;
  };
  const pushTree = (x, z, big) => {
    const h = terrainHeight(x, z);
    const type = h < 5 ? 'palm' : (rng() < 0.75 ? 'pine' : 'palm');
    const s = (big ? 1.15 : 0.8) + rng() * 0.7;
    ctx.trees.push({ x, y: h, z, s, type });
    // 树干碰撞（挡人挡子弹）
    ctx.walls.push({ x0: x - 0.35, z0: z - 0.35, x1: x + 0.35, z1: z + 0.35, y0: h, y1: h + 3.2 * s, kind: 'tree', c: '#6a4a2a' });
  };

  // 野外散树
  let trees = 0, tTry = 0;
  while (trees < 300 && tTry < 4000) {
    tTry++;
    const x = (rng() - 0.5) * (MAP.SIZE - 40), z = (rng() - 0.5) * (MAP.SIZE - 40);
    const h = terrainHeight(x, z);
    if (h < 2 || h > 42 || terrainSlope(x, z) > 0.42 || inRunway(x, z)) continue;
    let ok = true;
    for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.72) { ok = false; break; }
    if (!ok) continue;
    if (!clearOfBuildings(x, z, 3)) continue;
    pushTree(x, z, false);
    trees++;
  }

  // 森林区：成片密林
  for (const fz of FOREST_ZONES) {
    let ft = 0;
    for (let i = 0; i < fz.density && ft < fz.density; i++) {
      const ang = rng() * Math.PI * 2, dist = Math.sqrt(rng()) * fz.r;
      const x = fz.x + Math.cos(ang) * dist, z = fz.z + Math.sin(ang) * dist;
      const h = terrainHeight(x, z);
      if (h < 2 || h > 40 || terrainSlope(x, z) > 0.42 || inRunway(x, z)) continue;
      let ok = true;
      for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.6) { ok = false; break; }
      if (!ok) continue;
      if (!clearOfBuildings(x, z, 3)) continue;
      pushTree(x, z, true);
      ft++;
    }
    console.log(`[world] 森林区 (${fz.x},${fz.z}) 落树 ${ft} 棵`);
  }

  // 灌木
  let bush = 0, bTry = 0;
  while (bush < 220 && bTry < 2500) {
    bTry++;
    const x = (rng() - 0.5) * (MAP.SIZE - 60), z = (rng() - 0.5) * (MAP.SIZE - 60);
    const h = terrainHeight(x, z);
    if (h < 3 || h > 30 || terrainSlope(x, z) > 0.4 || inRunway(x, z)) continue;
    if (!clearOfBuildings(x, z, 2)) continue;
    ctx.bushes.push({ x, y: h, z, s: 0.5 + rng() * 0.8, c: rng() < 0.5 ? 0x4e7a3c : 0x5e8a3a });
    bush++;
  }

  // 岩石
  let rocks = 0, rTry = 0;
  while (rocks < 180 && rTry < 2600) {
    rTry++;
    const x = (rng() - 0.5) * (MAP.SIZE - 60), z = (rng() - 0.5) * (MAP.SIZE - 60);
    const h = terrainHeight(x, z);
    if (h < 1.5 || terrainSlope(x, z) > 0.5 || inRunway(x, z)) continue;
    let ok = true;
    for (const b of ctx.buildings) if (Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2) { ok = false; break; }
    if (!ok) continue;
    ctx.rocks.push({ x, y: h, z, s: 0.9 + rng() * 1.9 });
    rocks++;
  }

  ctx.lootSpawns.forEach((sp, i) => { sp.id = 'L' + i; });

  const safes = ctx.furniture.filter(f => f.kind === 'safe').length;
  console.log(`[world] 生成完成：建筑 ${ctx.buildings.length}，墙体 ${ctx.walls.length}，家具 ${ctx.furniture.length}（保险柜 ${safes}），楼层 ${ctx.floors.length}，屋顶 ${ctx.roofs.length}，战利品点 ${ctx.lootSpawns.length}，树 ${ctx.trees.length}（含森林），灌木 ${ctx.bushes.length}，石 ${ctx.rocks.length}，道具 ${ctx.props.length}`);
  return ctx;
}
