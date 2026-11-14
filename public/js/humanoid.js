// ============================================================
// 低多边形人形建模器 v3：参数化颜色通道（海岛风捏脸）
// appearance = { h, f, u, l, s, c1, c2, c3 }
//   部位定义形状与细节，c1=上衣主色 c2=下身主色 c3=肤色
// 部位衔接处用肩膀/脖子/裙摆遮挡，避免穿模；右手腕提供握枪锚点
// ============================================================
import * as THREE from 'three';
import { APPEARANCE, DEFAULT_COLORS } from '/shared/appearance.js';

function mat(color, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
  if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
  return m;
}

function mesh(geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.Mesh(geo, m);
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  return g;
}

const box = (w, h, d, m, ...p) => mesh(new THREE.BoxGeometry(w, h, d), m, ...p);
const cyl = (rt, rb, h, m, ...p) => mesh(new THREE.CylinderGeometry(rt, rb, h, 10), m, ...p);
const sph = (r, m, ...p) => mesh(new THREE.SphereGeometry(r, 12, 10), m, ...p);
const cone = (r, h, m, ...p) => mesh(new THREE.ConeGeometry(r, h, 12), m, ...p);

// ---------- 部位配置（颜色由通道注入） ----------
const LOWER = {
  pants:   {},
  skirt:   { skirt: true },
  pleated: { skirt: true },
  cargo:   { thick: 1.25 },
  shorts:  { short: true },
  camo:    {},
  jeans:   {},
  track:   { stripe: true },
  wide:    { thick: 1.4 },
  armored: { skirt: true, knee: true },
};

const SHOES = {
  sneakers:  { c: 0xe8e8e8, h: 0.1 },
  leather:   { c: 0x22222a, h: 0.09 },
  boots:     { c: 0x5a4430, h: 0.22 },
  armyboots: { c: 0x3a4a3a, h: 0.2 },
  slippers:  { c: 0x8a5a3a, h: 0.04 },
  heels:     { c: 0xd0304a, h: 0.1, heel: true },
  barefoot:  { c: null, skin: true, h: 0.06 },
  clogs:     { c: 0xa8763e, h: 0.12 },
  skate:     { c: 0xf2f2f2, h: 0.14, thick: 1.2 },
  iron:      { c: 0x8a929c, h: 0.11 },
};

const UPPER = {
  tshirt: { },
  sailor: { collar: 0x2a4a8a, neck: 0xd0304a },
  school: { tie: 0xd0304a },
  worker: { straps: 0x5a4430 },
  suit:   { dark: true, shirt: 0xf2f2f2, tie: 0x8a1a2a },
  vest:   { skinArms: true },
  army:   { belt: 0x2a2418 },
  hawaii: { flowers: true },
  armor:  { plate: 0x5a7a9a, waist: 0x2a343e },
  hoodie: { hood: true, pocket: true },
};

// ---------- 头部 ----------
function buildHead(g, id, hy, skin) {
  switch (id) {
    case 'big':
      g.add(sph(0.33, skin, 0, hy, 0));
      return { hy, r: 0.33 };
    case 'square':
      g.add(box(0.46, 0.5, 0.44, skin, 0, hy, 0));
      return { hy, r: 0.23, boxFace: true };
    case 'cone': {
      g.add(cone(0.26, 0.5, skin, 0, hy + 0.02, 0));
      return { hy: hy - 0.04, r: 0.2 };
    }
    case 'flat': {
      const h = sph(0.3, skin, 0, hy, 0);
      h.scale.set(1.25, 0.72, 0.85);
      g.add(h);
      return { hy, r: 0.3, flat: true };
    }
    case 'long': {
      const h = sph(0.24, skin, 0, hy, 0);
      h.scale.set(0.85, 1.35, 0.85);
      g.add(h);
      return { hy, r: 0.24 };
    }
    case 'small':
      g.add(sph(0.17, skin, 0, hy - 0.08, 0));
      return { hy: hy - 0.08, r: 0.17 };
    case 'egg': {
      const h = sph(0.27, skin, 0, hy, 0);
      h.scale.set(0.9, 1.15, 0.9);
      g.add(h);
      return { hy, r: 0.27 };
    }
    case 'dino': {
      g.add(sph(0.26, skin, 0, hy, 0));
      g.add(box(0.22, 0.14, 0.2, skin, 0, hy - 0.06, 0.26));
      g.add(cone(0.05, 0.14, mat(0xf2e2b0), -0.1, hy + 0.2, 0));
      g.add(cone(0.05, 0.14, mat(0xf2e2b0), 0.1, hy + 0.2, 0));
      return { hy, r: 0.26, dino: true };
    }
    case 'robot': {
      g.add(box(0.42, 0.46, 0.4, mat(0x9aa4ae), 0, hy, 0));
      g.add(cyl(0.02, 0.02, 0.16, mat(0x555f68), 0, hy + 0.3, 0));
      g.add(sph(0.045, mat(0xff4040, { emissive: 0x661111 }), 0, hy + 0.4, 0));
      return { hy, r: 0.22, robot: true };
    }
    default:
      g.add(sph(0.27, skin, 0, hy, 0));
      return { hy, r: 0.27 };
  }
}

// ---------- 面部 ----------
function buildFace(g, id, hi) {
  const dark = mat(0x2a2420);
  const r = hi.r;
  const at = (x, y, scaleZ = 1) => {
    const z = hi.boxFace || hi.robot ? r + 0.02 : Math.sqrt(Math.max(0.01, r * r - x * x)) * scaleZ - 0.01;
    return [x, hi.hy + y, z];
  };
  switch (id) {
    case 'shades':
      g.add(box(0.4, 0.09, 0.03, mat(0x111114), 0, hi.hy + 0.07, r + 0.01));
      break;
    case 'mustache':
      g.add(box(0.16, 0.045, 0.03, dark, ...at(0, -0.1)));
      break;
    case 'beard': {
      const beard = sph(r * 0.92, mat(0x3a2e22), 0, hi.hy - r * 0.45, r * 0.32);
      beard.scale.set(0.95, 0.6, 0.9);
      g.add(beard);
      break;
    }
    case 'goatee':
      g.add(cone(0.045, 0.14, mat(0x3a2e22), ...at(0, -r - 0.05), Math.PI));
      break;
    case 'scar':
      g.add(box(0.025, 0.16, 0.02, mat(0xb04030), ...at(0.1, 0.02), 0.3));
      break;
    case 'blush': {
      g.add(sph(0.045, mat(0xe89090), ...at(-0.15, -0.09)));
      g.add(sph(0.045, mat(0xe89090), ...at(0.15, -0.09)));
      break;
    }
    case 'patch':
      g.add(cyl(0.07, 0.07, 0.02, mat(0x181818), 0.09, hi.hy + 0.07, r + 0.02, Math.PI / 2));
      g.add(box(0.42, 0.025, 0.02, mat(0x181818), 0, hi.hy + 0.13, r + 0.01));
      break;
    case 'smile': {
      g.add(box(0.13, 0.022, 0.02, dark, ...at(0, -0.12)));
      g.add(box(0.05, 0.05, 0.02, mat(0xd86868), ...at(0, -0.16)));
      break;
    }
    case 'mask':
      g.add(box(0.4, 0.17, 0.06, mat(0xe8e4da), 0, hi.hy - r * 0.42, r * 0.82));
      break;
    default: break;
  }
  if (!['shades', 'mask', 'patch'].includes(id) && !hi.robot) {
    const eyeZ = hi.boxFace || hi.robot ? r + 0.02 : Math.sqrt(Math.max(0.01, r * r - 0.1 * 0.1)) - 0.01;
    g.add(sph(0.035, dark, -0.1, hi.hy + 0.06, eyeZ));
    g.add(sph(0.035, dark, 0.1, hi.hy + 0.06, eyeZ));
  }
}

// ---------- 上身（颜色通道 c1） ----------
function buildUpper(g, id, y0, c1, skin) {
  const cfg = UPPER[id] || UPPER.tshirt;
  const cloth = cfg.dark ? mat(0x1a1a22) : mat(c1);   // 黑西装保持黑
  g.add(cyl(0.3, 0.22, 0.58, cloth, 0, y0 + 0.29, 0));
  g.add(sph(0.26, cloth, 0, y0 + 0.55, 0));
  const shoulderY = y0 + 0.5;
  const armC = mat(cfg.skinArms ? c3 : c1);
  for (const sx of [-1, 1]) {
    g.add(sph(0.1, cloth, sx * 0.31, shoulderY, 0));
    g.add(cyl(0.07, 0.065, 0.4, armC, sx * 0.33, shoulderY - 0.22, 0));
    g.add(sph(0.075, mat(skin), sx * 0.33, shoulderY - 0.44, 0));
  }
  if (cfg.collar) {
    g.add(cone(0.29, 0.12, mat(cfg.collar), 0, y0 + 0.5, 0));
    g.add(cone(0.055, 0.13, mat(cfg.neck), 0, y0 + 0.42, 0.16, 0.6));
  }
  if (cfg.tie) {
    g.add(box(0.07, 0.05, 0.02, mat(cfg.tie), 0, y0 + 0.44, 0.27));
    g.add(box(0.055, 0.14, 0.02, mat(cfg.tie), 0, y0 + 0.34, 0.27));
  }
  if (cfg.shirt) {
    g.add(box(0.18, 0.46, 0.03, mat(cfg.shirt), 0, y0 + 0.3, 0.22));
    g.add(box(0.06, 0.15, 0.04, mat(cfg.tie || 0x8a1a2a), 0, y0 + 0.42, 0.24));
  }
  if (cfg.straps) {
    g.add(box(0.09, 0.5, 0.03, mat(cfg.straps), -0.15, y0 + 0.3, 0.23, 0, 0, 0.18));
    g.add(box(0.09, 0.5, 0.03, mat(cfg.straps), 0.15, y0 + 0.3, 0.23, 0, 0, -0.18));
    g.add(box(0.36, 0.12, 0.03, mat(cfg.straps), 0, y0 + 0.08, 0.24));
  }
  if (cfg.belt) g.add(cyl(0.24, 0.24, 0.09, mat(cfg.belt), 0, y0 + 0.03, 0));
  if (cfg.flowers) {
    for (let i = 0; i < 7; i++) {
      g.add(sph(0.035, mat(i % 2 ? 0xffe14d : 0x4dd2ff), Math.sin(i * 2.4) * 0.2, y0 + 0.18 + (i % 3) * 0.13, 0.24));
    }
  }
  if (cfg.plate) {
    g.add(box(0.38, 0.32, 0.07, mat(cfg.plate), 0, y0 + 0.3, 0.21));
    g.add(cyl(0.24, 0.24, 0.1, mat(cfg.waist || 0x2a343e), 0, y0 + 0.02, 0));
  }
  if (cfg.hood) {
    const hood = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 8, 14), cloth);
    hood.position.set(0, y0 + 0.56, -0.12);
    hood.rotation.x = 0.35;
    g.add(hood);
    if (cfg.pocket) g.add(box(0.3, 0.12, 0.05, cloth, 0, y0 + 0.14, 0.22));
  }
  return shoulderY;
}

// ---------- 下身+鞋（颜色通道 c2） ----------
function buildLowerShoes(g, lowerId, shoesId, y0, c2, skin) {
  const L = LOWER[lowerId] || LOWER.pants;
  const S = SHOES[shoesId] || SHOES.sneakers;
  const skirtTop = y0 + 0.05;
  const legTop = L.skirt ? skirtTop - 0.34 : (L.short ? y0 - 0.28 : y0);
  const legLen = legTop - 0.1;
  const legR = 0.125 * (L.thick || 1);
  const legMat = mat(c2);
  const shoeMat = S.skin ? skin : mat(S.c);
  for (const sx of [-1, 1]) {
    if (legLen > 0.02) {
      g.add(cyl(legR * 0.92, legR, legLen, legMat, sx * 0.14, legTop - legLen / 2, 0));
      if (L.stripe) g.add(box(0.045, legLen, 0.012, mat(0xd0304a), sx * 0.14, legTop - legLen / 2, legR + 0.004));
    }
    if (L.short) {
      g.add(cyl(legR * 0.95, legR, y0 - legTop, skin, sx * 0.14, (y0 + legTop) / 2, 0));
    }
    g.add(box(0.18 * (S.thick || 1), S.h, 0.3, shoeMat, sx * 0.14, S.h / 2, 0.04));
    if (S.heel) g.add(box(0.05, S.h + 0.08, 0.05, shoeMat, sx * 0.14, (S.h + 0.08) / 2, -0.1));
    if (S.h > 0.18 && legLen > 0.02) {
      g.add(cyl(legR + 0.035, legR + 0.035, S.h, shoeMat, sx * 0.14, S.h / 2 + 0.03, 0));
    }
    if (shoesId === 'heels' || shoesId === 'slippers') {
      g.add(box(0.14, 0.02, 0.06, shoeMat, sx * 0.14, S.h - 0.01, 0.1));
    }
  }
  if (L.skirt) {
    g.add(cone(0.44, 0.42, legMat, 0, skirtTop - 0.16, 0));
    g.add(sph(0.28, legMat, 0, skirtTop - 0.02, 0));
  }
  if (lowerId === 'armored') {
    g.add(cone(0.36, 0.26, mat(0x5a6a78), 0, skirtTop - 0.14, 0));
    for (const sx of [-1, 1]) g.add(box(0.12, 0.12, 0.1, mat(0x5a6a78), sx * 0.14, 0.26, legR + 0.03));
  }
}

/**
 * 构建人形角色模型（总高约 1.8m，原点在脚底）
 * appearance: { h, f, u, l, s, c1, c2, c3 } 或旧版数组 [h,f,u,l,s]
 * group.userData.handR = 右手锚点（挂枪）
 */
export function buildHumanoid(a) {
  let o;
  if (Array.isArray(a)) {
    o = { h: a[0], f: a[1], u: a[2], l: a[3], s: a[4], ...DEFAULT_COLORS };
  } else {
    o = { ...DEFAULT_COLORS, ...(a || {}) };
  }
  const headId = (APPEARANCE.head[o.h] || APPEARANCE.head[0]).id;
  const faceId = (APPEARANCE.face[o.f] || APPEARANCE.face[0]).id;
  const upperId = (APPEARANCE.upper[o.u] || APPEARANCE.upper[0]).id;
  const lowerId = (APPEARANCE.lower[o.l] || APPEARANCE.lower[0]).id;
  const shoesId = (APPEARANCE.shoes[o.s] || APPEARANCE.shoes[0]).id;

  const skinMat = mat(o.c3 || DEFAULT_COLORS.c3);
  const g = new THREE.Group();
  const y0 = 0.62;
  buildLowerShoes(g, lowerId, shoesId, y0, o.c2 || DEFAULT_COLORS.c2, skinMat);
  const shoulderY = buildUpper(g, upperId, y0, o.c1 || DEFAULT_COLORS.c1, skinMat);
  g.add(cyl(0.11, 0.11, 0.12, skinMat, 0, y0 + 0.6, 0));
  const hi = buildHead(g, headId, y0 + 0.72, skinMat);
  buildFace(g, faceId, hi);
  g.userData.handR = { x: 0.33, y: shoulderY - 0.44, z: 0 };
  return g;
}
