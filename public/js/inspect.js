// ============================================================
// 道具 3D 模型工厂 + 检视功能（第一人称拿在手上 + 详情卡）
// buildItemModel(id) 供检视视图与地面战利品共用
// 支持 item.tex：贴图文件放 public/assets/items/<tex>，自动贴上模型主面
// ============================================================
import * as THREE from 'three';
import { ITEMS, WEAPONS } from '/shared/constants.js';

// ---------- 材质缓存 ----------
const matCache = new Map();
const texLoader = new THREE.TextureLoader();

function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity ?? 0.8; }
    if (opts.emissive) m.emissive = new THREE.Color(opts.emissive);
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// 带贴图的材质：先按纯色生成，贴图异步加载完成后贴上
function texMat(color, texFile, opts = {}) {
  if (!texFile) return mat(color, opts);
  const key = 'T' + texFile + color;
  if (!matCache.has(key)) {
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    try {
      texLoader.load('/assets/items/' + texFile, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        m.map = tex;
        m.color.set(0xffffff);
        m.needsUpdate = true;
      });
    } catch (e) { /* 贴图缺失就用纯色 */ }
    matCache.set(key, m);
  }
  return matCache.get(key);
}

function box(w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}
function sph(r, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  return mesh;
}

// ---------- 各类模型 ----------
const BUILDERS = {
  // 武器
  knife(g) {
    g.add(box(0.02, 0.05, 0.34, mat(0xcfd6dd), 0, 0.06, -0.14));
    g.add(box(0.05, 0.07, 0.02, mat(0x33383f), 0, 0.03, 0.04));
    g.add(box(0.035, 0.05, 0.16, mat(0x22262c), 0, 0, 0.13));
  },
  p92(g) {
    g.add(box(0.045, 0.06, 0.26, mat(0x3a4048), 0, 0.08, -0.06));
    g.add(box(0.05, 0.14, 0.07, mat(0x22262c), 0, -0.02, 0.06, 0.25));
    g.add(cyl(0.014, 0.014, 0.06, mat(0x181b20), 0, 0.085, -0.2, Math.PI / 2));
  },
  smg(g) {
    g.add(box(0.06, 0.08, 0.34, mat(0x2e343c), 0, 0.06, -0.04));
    g.add(box(0.04, 0.16, 0.05, mat(0x22262c), 0, -0.08, 0));
    g.add(box(0.04, 0.05, 0.18, mat(0x22262c), 0, 0.05, 0.2));
    g.add(cyl(0.016, 0.016, 0.12, mat(0x181b20), 0, 0.07, -0.26, Math.PI / 2));
  },
  ak(g) {
    g.add(box(0.055, 0.08, 0.4, mat(0x5c4429), 0, 0.06, -0.05));
    g.add(box(0.04, 0.18, 0.06, mat(0x3a2f1d), 0, -0.08, 0.02, 0.3));
    g.add(box(0.04, 0.06, 0.2, mat(0x5c4429), 0, 0.05, 0.26));
    g.add(cyl(0.016, 0.016, 0.18, mat(0x2a2f36), 0, 0.07, -0.32, Math.PI / 2));
  },
  lr(g) {
    g.add(box(0.05, 0.09, 0.44, mat(0x38404a), 0, 0.06, 0));
    g.add(cyl(0.02, 0.02, 0.3, mat(0x20242a), 0, 0.07, -0.36, Math.PI / 2));
    g.add(cyl(0.035, 0.035, 0.16, mat(0x14171b), 0, 0.13, -0.1, Math.PI / 2));
    g.add(box(0.035, 0.1, 0.06, mat(0x22262c), 0, -0.04, 0.14));
  },
  // 弹药
  a9(g) { ammoBox(g, 0x8a7a5c, '9MM'); },
  a762(g) { ammoBox(g, 0x4e6b3c, '7.62'); },
  a338(g) { ammoBox(g, 0x565e68, '.338'); },
  // 医疗
  bandage(g) {
    g.add(cyl(0.07, 0.07, 0.09, mat(0xf2ead8), 0, 0, 0, 0, 0, Math.PI / 2));
    g.add(cyl(0.045, 0.045, 0.092, mat(0xd8ccb0), 0, 0, 0, 0, 0, Math.PI / 2));
    g.add(box(0.075, 0.02, 0.06, mat(0xe0d2b8), 0, 0.05, 0.07, 0.4));
  },
  medkit(g) {
    g.add(box(0.22, 0.14, 0.14, mat(0xd84848), 0, 0, 0));
    g.add(box(0.03, 0.1, 0.145, mat(0xf2f2f2), 0, 0, 0.002));
    g.add(box(0.1, 0.03, 0.145, mat(0xf2f2f2), 0, 0, 0.003));
    g.add(box(0.23, 0.03, 0.1, mat(0xb83838), 0, 0.085, 0));
  },
  energy(g) {
    g.add(cyl(0.05, 0.05, 0.18, mat(0x3fae72), 0, 0, 0));
    g.add(cyl(0.052, 0.052, 0.04, mat(0xe8e8e8), 0, 0.075, 0));
    g.add(cyl(0.02, 0.02, 0.02, mat(0xc0c0c0), 0, 0.1, 0));
  },
  // 食物
  apple(g) {
    g.add(sph(0.09, mat(0xd84838), 0, 0, 0, 1, 0.92, 1));
    g.add(cyl(0.012, 0.014, 0.06, mat(0x6a4a2a), 0, 0.1, 0));
    g.add(sph(0.035, mat(0x4a9e3c), 0.04, 0.12, 0, 1.6, 0.5, 0.8));
  },
  water(g) {
    const bottle = cyl(0.05, 0.05, 0.2, mat(0x8fd0ea, { transparent: true, opacity: 0.7 }), 0, 0.02, 0);
    g.add(bottle);
    g.add(cyl(0.022, 0.022, 0.05, mat(0x3a86b8), 0, 0.14, 0));
    g.add(box(0.102, 0.08, 0.102, mat(0x4aa8d8, { transparent: true, opacity: 0.85 }), 0, 0.0, 0));
  },
  canned(g) {
    g.add(cyl(0.07, 0.07, 0.12, mat(0x9aa2a8), 0, 0, 0));
    g.add(cyl(0.072, 0.072, 0.07, mat(0xd8b878), 0, 0, 0));
    g.add(cyl(0.071, 0.071, 0.122, mat(0xc0c8cc), 0, 0, 0, 0, 0, 0, 14));
  },
  // 生活物资
  cup(g) {
    g.add(cyl(0.07, 0.058, 0.11, mat(0x9ec4d4), 0, 0, 0));
    g.add(cyl(0.062, 0.062, 0.005, mat(0x5a7a8a), 0, 0.056, 0));
    g.add(box(0.145, 0.02, 0.02, mat(0x9ec4d4), 0.09, 0.02, 0));
    g.add(box(0.1, 0.05, 0.01, mat(0xe05a4a), 0, 0, 0.07));
  },
  cigs(g) {
    g.add(box(0.14, 0.05, 0.09, mat(0xe8e2d4), 0, 0, 0));
    g.add(box(0.14, 0.05, 0.09, mat(0xd84848), 0, 0.052, 0));
    g.add(box(0.141, 0.016, 0.03, mat(0xe8d8b0), 0, 0.026, 0));
  },
  battery(g) {
    g.add(cyl(0.035, 0.035, 0.12, mat(0x3c4652), 0, 0, 0));
    g.add(cyl(0.018, 0.018, 0.014, mat(0xc8a040), 0, 0.066, 0));
    g.add(cyl(0.036, 0.036, 0.03, mat(0xc8a040), 0, 0.03, 0));
  },
  blanket(g) {
    g.add(cyl(0.09, 0.09, 0.24, mat(0xa8685a), 0, 0, 0, 0, 0, Math.PI / 2));
    g.add(cyl(0.092, 0.092, 0.04, mat(0x7a5a3a), 0, 0, 0, 0, 0, Math.PI / 2));
    g.add(cyl(0.075, 0.075, 0.245, mat(0x90604e), 0, 0, 0, 0, 0, Math.PI / 2));
  },
  flashlight(g) {
    g.add(cyl(0.04, 0.045, 0.18, mat(0x4a5462), 0, 0, 0, Math.PI / 2));
    g.add(cyl(0.06, 0.05, 0.05, mat(0x3a424e), 0, 0, -0.11, Math.PI / 2));
    g.add(cyl(0.05, 0.05, 0.01, mat(0xfff2c0, { emissive: 0x554411 }), 0, 0, -0.137, Math.PI / 2));
  },
  radio(g) {
    g.add(box(0.26, 0.16, 0.1, mat(0x7a6a58), 0, 0, 0));
    g.add(cyl(0.04, 0.04, 0.02, mat(0x383028), 0.07, 0.02, 0.05, Math.PI / 2));
    g.add(box(0.09, 0.1, 0.012, mat(0x2e2822), -0.06, 0, 0.05));
    g.add(cyl(0.008, 0.008, 0.14, mat(0x2a2a2a), 0.12, 0.14, -0.03));
  },
  toolbox(g) {
    g.add(box(0.3, 0.16, 0.16, mat(0xc96a3a), 0, 0, 0));
    g.add(box(0.32, 0.02, 0.18, mat(0xa8552e), 0, 0.09, 0));
    g.add(box(0.16, 0.03, 0.04, mat(0x383838), 0, 0.12, 0));
  },
  // 奶蛙玩偶：黄色圆胖青蛙（参考用户图片简单建模）
  milkfrog(g) {
    const body = 0xf2cf5a, bellyC = 0xf7ecd2, dark = 0x2a2a24;
    // 圆胖身体（头身一体的水滴形）
    g.add(sph(0.16, mat(body), 0, 0.02, 0, 1, 1.12, 0.92));
    // 奶白色大肚皮
    g.add(sph(0.115, mat(bellyC), 0, -0.045, 0.075, 1, 1.05, 0.62));
    // 眼睛：白眼球 + 黑瞳
    g.add(sph(0.028, mat(0xffffff), -0.055, 0.135, 0.09));
    g.add(sph(0.028, mat(0xffffff), 0.055, 0.135, 0.09));
    g.add(sph(0.016, mat(dark), -0.058, 0.138, 0.108));
    g.add(sph(0.016, mat(dark), 0.058, 0.138, 0.108));
    // 小手（搭在肚皮前）
    g.add(sph(0.032, mat(body), -0.075, -0.03, 0.115, 0.8, 1.2, 0.7));
    g.add(sph(0.032, mat(body), 0.075, -0.03, 0.115, 0.8, 1.2, 0.7));
    // 短腿和小脚丫
    g.add(sph(0.05, mat(body), -0.08, -0.155, 0.03, 0.8, 0.9, 1));
    g.add(sph(0.05, mat(body), 0.08, -0.155, 0.03, 0.8, 0.9, 1));
    g.add(box(0.055, 0.02, 0.09, mat(bellyC), -0.08, -0.185, 0.08));
    g.add(box(0.055, 0.02, 0.09, mat(bellyC), 0.08, -0.185, 0.08));
    // 嘴（一条微笑弧线用细扁盒近似）
    g.add(box(0.05, 0.008, 0.01, mat(dark), 0, 0.06, 0.148));
  },
  // 王兰花抱枕：方块小抱枕，六面贴用户图片
  pillow(g) {
    g.add(box(0.3, 0.3, 0.11, mat(0xdce8f5)));
  },
  // 护甲
  armor1(g) { armorVest(g, 0x4a7a4e); },
  armor2(g) { armorVest(g, 0x35506e); },
  armor3(g) { armorVest(g, 0x2e2e34); },
  // 头盔
  helm1(g) { helmet(g, 0x3e6e42); },
  helm2(g) { helmet(g, 0x2e4864); },
  helm3(g) { helmet(g, 0x26262c); },
  // 背包
  pack1(g) { backpack(g, 0x8a7a58, 0.26); },
  pack2(g) { backpack(g, 0x3e4a3a, 0.34); },
  // 值钱货
  gold(g) {
    const gold = mat(0xf0c040, { emissive: 0x332200 });
    g.add(box(0.16, 0.05, 0.07, gold, 0, 0, 0));
    g.add(box(0.14, 0.045, 0.062, gold, 0, 0.048, 0));
  },
  watch(g) {
    g.add(cyl(0.06, 0.06, 0.025, mat(0xf0d890, { emissive: 0x221100 }), 0, 0, 0, Math.PI / 2));
    g.add(cyl(0.052, 0.052, 0.027, mat(0xf8f4e8), 0, 0, 0, Math.PI / 2));
    g.add(box(0.03, 0.16, 0.012, mat(0x6a3a28), 0, 0, 0.014));
    g.add(box(0.03, 0.16, 0.012, mat(0x6a3a28), 0, 0, -0.014));
  },
  gpu(g) {
    g.add(box(0.3, 0.03, 0.14, mat(0x2a4a2e), 0, 0, 0));
    g.add(cyl(0.05, 0.05, 0.012, mat(0x1a1a1a), -0.06, 0.02, 0, 0, 0, 0));
    g.add(cyl(0.05, 0.05, 0.012, mat(0x1a1a1a), 0.06, 0.02, 0, 0, 0, 0));
    g.add(box(0.28, 0.015, 0.02, mat(0xd8b040), 0, -0.024, 0.05));
  },
  relic(g) {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), mat(0x8844cc, { emissive: 0x441f88, transparent: true, opacity: 0.92 })));
    g.add(sph(0.05, mat(0xd0a0ff, { emissive: 0x6633aa })));
    g.add(box(0.2, 0.02, 0.14, mat(0x3a3044), 0, -0.12, 0));
  },
};

function ammoBox(g, color, label) {
  const m = texMat(color, null);
  g.add(box(0.14, 0.09, 0.09, m, 0, 0, 0));
  g.add(box(0.142, 0.03, 0.092, mat(0xd8cfa8), 0, 0, 0));
  g.add(box(0.1, 0.02, 0.005, mat(0xf2ead0), 0, 0.02, 0.047));
}

function armorVest(g, color) {
  g.add(box(0.3, 0.3, 0.12, mat(color), 0, 0, 0));
  g.add(box(0.3, 0.1, 0.13, mat(0x22262c), 0, 0.12, 0));
  g.add(box(0.08, 0.22, 0.05, mat(0x22262c), -0.12, -0.02, 0.06, 0, 0, 0.15));
  g.add(box(0.08, 0.22, 0.05, mat(0x22262c), 0.12, -0.02, 0.06, 0, 0, -0.15));
}

function helmet(g, color) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
  g.add(dome);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.03, 14), mat(color));
  brim.position.y = 0.002;
  g.add(brim);
}

function backpack(g, color, size) {
  g.add(box(size, size * 1.15, size * 0.55, mat(color), 0, 0, 0));
  g.add(box(size * 0.9, size * 0.4, size * 0.56, mat(0x22262c), 0, size * 0.42, 0));
  g.add(box(0.04, size, 0.05, mat(0x2e343c), -size * 0.28, 0, size * 0.3));
  g.add(box(0.04, size, 0.05, mat(0x2e343c), size * 0.28, 0, size * 0.3));
}

// ---------- 对外接口 ----------
/**
 * 构建道具模型。返回 THREE.Group（原尺寸比例）。
 * 若道具配置了 tex 字段，会异步把 /assets/items/<tex> 贴到主体材质上。
 */
export function buildItemModel(itemId) {
  const g = new THREE.Group();
  const def = ITEMS[itemId] || WEAPONS[itemId];
  const builder = BUILDERS[itemId];
  if (builder) {
    builder(g);
  } else {
    // 兜底：通用彩色方块
    const color = (def && def.color) || '#999999';
    g.add(box(0.2, 0.2, 0.2, mat(color)));
  }
  // 图片贴图：贴到组的所有子网格主面（用户传图后配置 tex 即生效）
  if (def && def.tex) {
    try {
      texLoader.load('/assets/items/' + def.tex, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        texMatProxy(g, tex, def.color);
      });
    } catch (e) { /* 忽略 */ }
  }
  return g;
}

// 把贴图套到组内所有材质上（克隆材质，避免污染缓存）
function texMatProxy(g, tex, fallbackColor) {
  g.traverse((node) => {
    if (node.isMesh) {
      const m = node.material.clone();
      m.map = tex;
      m.color.set(0xffffff);
      m.emissive = new THREE.Color(0x000000);
      m.needsUpdate = true;
      node.material = m;
    }
  });
}

/** 归一化尺寸：把模型最长边缩放到 target 米，返回缩放后的组 */
export function normalizeModel(g, target = 0.4) {
  const box3 = new THREE.Box3().setFromObject(g);
  const size = new THREE.Vector3();
  box3.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  g.scale.setScalar(target / maxDim);
  return g;
}

// ============================================================
// 检视控制器：第一人称把道具拿在手上 + 侧边详情卡
// ============================================================
export class InspectController {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.itemId = null;
    this.group = null;
    this.panel = document.getElementById('inspect-panel');
    this.elName = document.getElementById('inspect-name');
    this.elDesc = document.getElementById('inspect-desc');
    this.elStats = document.getElementById('inspect-stats');
    this.elValue = document.getElementById('inspect-value');
    this.onExit = null;
    document.addEventListener('contextmenu', (e) => {
      if (this.active) { e.preventDefault(); this.exit(); }
    });
    document.getElementById('inspect-close').addEventListener('click', () => this.exit());
  }

  enter(itemId, qty = 1) {
    const def = ITEMS[itemId] || WEAPONS[itemId];
    if (!def) return;
    this.exit();
    this.active = true;
    this.itemId = itemId;
    this.group = normalizeModel(buildItemModel(itemId), 0.32);
    this.group.position.set(0.3, -0.2, -0.68);
    this.group.rotation.set(0.1, -0.5, 0);
    this.game.camera.add(this.group);
    this.game.viewmodel.visible = false;
    // 详情卡
    this.elName.textContent = def.name;
    this.elDesc.textContent = def.desc || '来自海岛的普通物资。';
    this.elStats.innerHTML = buildStatsHtml(itemId, def);
    this.elValue.textContent = `价值 ¥${def.value}${qty > 1 ? ` · 持有 ×${qty}（合计 ¥${def.value * qty}）` : ''}`;
    this.panel.classList.remove('hidden');
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.itemId = null;
    if (this.group) {
      this.game.camera.remove(this.group);
      this.group = null;
    }
    if (this.game.viewmodel) this.game.viewmodel.visible = true;
    this.panel.classList.add('hidden');
    if (this.onExit) this.onExit();
  }

  update(dt) {
    if (!this.active || !this.group) return;
    // 缓慢自转展示
    this.group.rotation.y += dt * 0.9;
    // 随呼吸轻微浮动
    const t = performance.now() / 1000;
    this.group.position.y = -0.2 + Math.sin(t * 1.6) * 0.01;
  }
}

function buildStatsHtml(itemId, def) {
  const rows = [];
  if (WEAPONS[itemId]) {
    const w = def;
    if (w.type === 'gun') {
      rows.push(['伤害', w.dmg + (w.headMult ? `（爆头 ×${w.headMult}）` : '')]);
      rows.push(['射速', w.rate + ' 发/秒' + (w.auto ? ' · 全自动' : ' · 半自动')]);
      rows.push(['弹匣', w.mag + ' 发 · 换弹 ' + w.reload + 's']);
      rows.push(['有效射程', w.range + ' 米']);
      rows.push(['弹药', (ITEMS[w.ammo] || {}).name || '—']);
    } else {
      rows.push(['伤害', w.dmg]);
      rows.push(['攻击距离', w.range + ' 米']);
    }
  } else if (def.kind === 'ammo') {
    rows.push(['适用武器', (WEAPONS.ak.ammo === itemId ? 'AK-7' : WEAPONS.lr.ammo === itemId ? 'LR-338' : '手枪 / 冲锋枪')]);
    rows.push(['每组数量', def.qtyPerPack + ' 发']);
  } else if (def.kind === 'med' || def.kind === 'food') {
    rows.push(['回复', def.heal + ' HP']);
    rows.push(['使用时间', def.cast + ' 秒']);
    if (def.buff) rows.push(['额外', '加速 ' + def.buff + ' 秒']);
    rows.push(['叠放上限', '×' + def.stack]);
  } else if (def.kind === 'armor') {
    rows.push(['减伤', Math.round(def.absorb * 100) + '%']);
    rows.push(['耐久', def.dur]);
  } else if (def.kind === 'helmet') {
    rows.push(['爆头减伤', Math.round(def.headReduce * 100) + '%']);
  } else if (def.kind === 'pack') {
    rows.push(['额外格子', '+' + def.slots + ' 格']);
  } else {
    rows.push(['类别', def.kind === 'loot' ? '值钱货（撤离折现）' : '生活物资']);
    if (def.stack > 1) rows.push(['叠放上限', '×' + def.stack]);
  }
  return rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
}
