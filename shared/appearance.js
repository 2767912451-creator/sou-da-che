// ============================================================
// 人物形象定义 v2：部件预设 + 颜色通道（海岛风捏脸）
// appearance = { h, f, u, l, s, c1, c2, c3 }
//   h/f/u/l/s = 部位下标；c1=上衣主色 c2=下身主色 c3=肤色
// ============================================================

export const APPEARANCE = {
  head: [
    { id: 'round',    name: '普通圆头' },
    { id: 'big',      name: '大头娃娃' },
    { id: 'square',   name: '方块头' },
    { id: 'cone',     name: '外星尖头' },
    { id: 'flat',     name: '压缩饼干头' },
    { id: 'long',     name: '竹竿长头' },
    { id: 'small',    name: '绿豆头' },
    { id: 'egg',      name: '鸡蛋头' },
    { id: 'dino',     name: '恐龙头' },
    { id: 'robot',    name: '机器人头' },
  ],
  face: [
    { id: 'none',     name: '干净脸' },
    { id: 'shades',   name: '黑墨镜' },
    { id: 'mustache', name: '八字胡' },
    { id: 'beard',    name: '络腮大胡' },
    { id: 'goatee',   name: '山羊胡' },
    { id: 'scar',     name: '刀疤' },
    { id: 'blush',    name: '红脸蛋' },
    { id: 'patch',    name: '独眼眼罩' },
    { id: 'smile',    name: '憨笑' },
    { id: 'mask',     name: '蒙面侠' },
  ],
  upper: [
    { id: 'tshirt',   name: '白 T 恤' },
    { id: 'sailor',   name: '水手服' },
    { id: 'school',   name: '校服西装' },
    { id: 'worker',   name: '工装服' },
    { id: 'suit',     name: '黑西装' },
    { id: 'vest',     name: '汗背心' },
    { id: 'army',     name: '军绿作训服' },
    { id: 'hawaii',   name: '花衬衫' },
    { id: 'armor',    name: '防弹背心' },
    { id: 'hoodie',   name: '连帽衫' },
  ],
  lower: [
    { id: 'pants',    name: '普通长裤' },
    { id: 'skirt',    name: '普通裙子' },
    { id: 'pleated',  name: '百褶短裙' },
    { id: 'cargo',    name: '工装裤' },
    { id: 'shorts',   name: '运动短裤' },
    { id: 'camo',     name: '迷彩裤' },
    { id: 'jeans',    name: '牛仔裤' },
    { id: 'track',    name: '白运动裤' },
    { id: 'wide',     name: '阔腿裤' },
    { id: 'armored',  name: '装甲裙甲' },
  ],
  shoes: [
    { id: 'sneakers', name: '白运动鞋' },
    { id: 'leather',  name: '黑皮鞋' },
    { id: 'boots',    name: '高帮靴' },
    { id: 'armyboots', name: '军靴' },
    { id: 'slippers', name: '人字拖' },
    { id: 'heels',    name: '红高跟鞋' },
    { id: 'barefoot', name: '光脚丫' },
    { id: 'clogs',    name: '木头屐' },
    { id: 'skate',    name: '厚底滑板鞋' },
    { id: 'iron',     name: '铁鞋' },
  ],
};

// 默认颜色通道：c1=上衣主色 c2=下身主色 c3=肤色
export const DEFAULT_COLORS = { c1: '#e8e8e8', c2: '#4a5568', c3: '#d8b28f' };
export const DEFAULT_APPEARANCE = { h: 0, f: 0, u: 0, l: 0, s: 0, ...DEFAULT_COLORS };

// 随机色板（海岛风 + 常见肤色）
const PALETTE_C1 = ['#e8e8e8', '#f2c94c', '#ff8855', '#3a4a6e', '#1a1a22', '#4a5a3a', '#c85a8a', '#4dd2ff', '#6a3ab0', '#e05a4a'];
const PALETTE_C2 = ['#4a5568', '#3a5a8a', '#6a5a3a', '#4a5a3a', '#c85a8a', '#2c2c34', '#8a5a3a', '#d8d8d8', '#5a3a6a', '#3c4650'];
const PALETTE_C3 = ['#d8b28f', '#f2d0b0', '#c98f5f', '#8a5a3a', '#f5d5c0', '#b87a4a', '#ffe0c0', '#a06a3a'];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function hexOk(v) { return typeof v === 'string' && HEX_RE.test(v); }

/** 随机一套外观（含随机配色，AI 拾荒者用） */
export function randomAppearance() {
  const pick = (arr) => Math.floor(Math.random() * arr.length);
  const pickColor = (arr) => arr[pick(arr)];
  return {
    h: pick(APPEARANCE.head),
    f: pick(APPEARANCE.face),
    u: pick(APPEARANCE.upper),
    l: pick(APPEARANCE.lower),
    s: pick(APPEARANCE.shoes),
    c1: pickColor(PALETTE_C1),
    c2: pickColor(PALETTE_C2),
    c3: pickColor(PALETTE_C3),
  };
}

export const DEFAULT_APPEARANCE_FULL = { ...DEFAULT_APPEARANCE };

/** 校验并清洗客户端提交的外观 */
export function sanitizeAppearance(a) {
  const out = { ...DEFAULT_APPEARANCE };
  if (!a || typeof a !== 'object') return out;
  for (const k of ['h', 'f', 'u', 'l', 's']) {
    const v = parseInt(a[k], 10);
    const slot = APPEARANCE[k === 'h' ? 'head' : k === 'f' ? 'face' : k === 'u' ? 'upper' : k === 'l' ? 'lower' : 'shoes'];
    if (Number.isInteger(v) && v >= 0 && v < slot.length) out[k] = v;
  }
  for (const k of ['c1', 'c2', 'c3']) {
    if (hexOk(a[k])) out[k] = a[k].toUpperCase();
  }
  return out;
}

/** 快照/建模用的标准对象 {h,f,u,l,s,c1,c2,c3} */
export function appearanceObj(a) {
  const clean = sanitizeAppearance(a);
  return clean;
}
