// ============================================================
// 账号与仓库存储（JSON 文件持久化，无数据库依赖）
// ============================================================
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ITEMS, WEAPONS } from '../shared/constants.js';
import { sanitizeAppearance } from '../shared/appearance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'players.json');

let db = { players: {} };
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[store] 读取数据失败，使用空数据库', e.message);
    db = { players: {} };
  }
  migrate();
}

/** 老账号字段迁移（loadout / appearance 等后来新增的字段） */
function migrate() {
  for (const u of Object.values(db.players)) {
    if (!Array.isArray(u.loadout)) u.loadout = [];
    if (!u.appearance) u.appearance = { h: 0, f: 0, u: 0, l: 0, s: 0 };
    if (!u.stats) u.stats = { matches: 0, extracts: 0, kills: 0, deaths: 0, bestValue: 0 };
  }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[store] 保存失败', e.message);
    }
  }, 300);
}

load();

function hashPass(name, pass) {
  return crypto.createHash('sha256').update(`${name}::${pass}::sou-da-che-salt`).digest('hex');
}

function newUser(name) {
  return {
    name,
    pass: hashPass(name, name),
    cash: 0,
    stash: [],          // [{id, qty}] 仓库物品
    loadout: [],        // [{id, qty}] 携带清单（开局消耗）
    bring: null,        // 兼容旧字段
    appearance: { h: 0, f: 0, u: 0, l: 0, s: 0 },
    stats: { matches: 0, extracts: 0, kills: 0, deaths: 0, bestValue: 0 },
    createdAt: Date.now(),
  };
}

export function register(name, pass) {
  name = String(name || '').trim().slice(0, 16);
  pass = String(pass || '');
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]{2,16}$/.test(name)) return { err: '昵称需 2-16 位（中文/字母/数字）' };
  if (pass.length < 3 || pass.length > 32) return { err: '密码需 3-32 位' };
  if (db.players[name]) return { err: '该昵称已被注册' };
  const u = newUser(name);
  u.pass = hashPass(name, pass);
  db.players[name] = u;
  save();
  return { ok: true };
}

export function login(name, pass) {
  const u = db.players[name];
  if (!u || u.pass !== hashPass(name, pass)) return { err: '昵称或密码错误' };
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, name);
  return { ok: true, token, user: publicUser(u) };
}

export function auth(token) {
  const name = tokens.get(token);
  return name ? db.players[name] : null;
}

export function publicUser(u) {
  return {
    name: u.name,
    cash: u.cash,
    stash: u.stash,
    loadout: u.loadout || [],
    bring: u.bring,
    appearance: u.appearance || { h: 0, f: 0, u: 0, l: 0, s: 0 },
    stats: u.stats,
  };
}

/** 设置人物形象 */
export function setAppearance(name, appearance) {
  const u = db.players[name];
  if (!u) return { err: '未登录' };
  u.appearance = sanitizeAppearance(appearance);
  save();
  return { ok: true, user: publicUser(u) };
}

/** 按昵称取用户（仅测试/内部使用） */
export function getUserByName(name) {
  return db.players[name] || null;
}

// tokens 放内存（重启后需重新登录）
const tokens = new Map();

// ---------- 商店 ----------
// 买价 = 价值 × 1.2（弹药按一组 qtyPerPack 计）
export function shopList() {
  const list = [];
  for (const [id, w] of Object.entries(WEAPONS)) {
    list.push({ id, name: w.name, price: Math.round(w.value * 1.2), kind: 'weapon' });
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.kind === 'loot') continue;   // 值钱货只能岛上搜刮
    const pack = it.kind === 'ammo' ? it.qtyPerPack : 1;
    list.push({ id, name: it.name + (it.kind === 'ammo' ? ` ×${pack}` : ''), price: Math.round(it.value * pack * 1.2), kind: it.kind, pack });
  }
  return list;
}

export function buyItem(name, itemId) {
  const u = db.players[name];
  if (!u) return { err: '未登录' };
  const entry = shopList().find(s => s.id === itemId);
  if (!entry) return { err: '商店没有该商品' };
  if (u.cash < entry.price) return { err: `赏金不足（需要 ¥${entry.price}）` };
  const qty = entry.pack ? entry.pack : 1;
  u.cash -= entry.price;
  const found = u.stash.find(s => s.id === itemId);
  const maxStack = ITEMS[itemId] ? ITEMS[itemId].stack * 20 : 20;
  if (found && ITEMS[itemId] && ITEMS[itemId].stack > 1) found.qty = Math.min(found.qty + qty, maxStack);
  else if (found && !WEAPONS[itemId]) found.qty += qty;
  else u.stash.push({ id: itemId, qty });
  save();
  return { ok: true, user: publicUser(u) };
}

export function sellItem(name, itemId, qty) {
  const u = db.players[name];
  if (!u) return { err: '未登录' };
  const def = ITEMS[itemId] || WEAPONS[itemId];
  if (!def) return { err: '无效物品' };
  const entry = u.stash.find(s => s.id === itemId);
  if (!entry) return { err: '仓库中没有该物品' };
  qty = Math.max(1, Math.min(qty | 0, entry.qty));
  entry.qty -= qty;
  if (entry.qty <= 0) u.stash.splice(u.stash.indexOf(entry), 1);
  // 携带清单里同步扣减
  if (!Array.isArray(u.loadout)) u.loadout = [];
  const lo = u.loadout.find(l => l.id === itemId);
  if (lo && lo.qty > entry.qty) { lo.qty = entry.qty; if (lo.qty <= 0) u.loadout.splice(u.loadout.indexOf(lo), 1); }
  const gain = Math.round(def.value * qty);
  u.cash += gain;
  save();
  return { ok: true, gain, user: publicUser(u) };
}

// ---------- 携带清单 ----------
export function setLoadout(name, loadout) {
  const u = db.players[name];
  if (!u) return { err: '未登录' };
  if (!Array.isArray(loadout)) return { err: '无效清单' };
  if (loadout.length > 8) return { err: '携带清单最多 8 项' };
  const cleaned = [];
  for (const l of loadout) {
    const id = String(l.id || '');
    const def = ITEMS[id] || WEAPONS[id];
    if (!def) return { err: '清单中有无效物品: ' + id };
    const entry = u.stash.find(s => s.id === id);
    if (!entry) return { err: `仓库中没有 ${def.name}` };
    let qty = WEAPONS[id] ? 1 : Math.max(1, Math.min(l.qty | 0, ITEMS[id].stack, entry.qty));
    if (cleaned.some(c => c.id === id)) return { err: '清单中有重复物品' };
    cleaned.push({ id, qty });
  }
  u.loadout = cleaned;
  save();
  return { ok: true, user: publicUser(u) };
}

/** 对局开始时消耗携带清单，返回实际带入的物品（{id, qty, mag}） */
export function consumeLoadout(name) {
  const u = db.players[name];
  if (!u) return [];
  if (!Array.isArray(u.loadout)) u.loadout = [];
  const items = [];
  for (const l of u.loadout) {
    const entry = u.stash.find(s => s.id === l.id);
    if (!entry) continue;   // 仓库被变动过，跳过
    const take = Math.min(l.qty, entry.qty);
    if (take <= 0) continue;
    entry.qty -= take;
    if (entry.qty <= 0) u.stash.splice(u.stash.indexOf(entry), 1);
    const it = { id: l.id, qty: take };
    if (WEAPONS[l.id]) it.mag = WEAPONS[l.id].mag;
    items.push(it);
  }
  u.loadout = [];
  save();
  return items;
}

/** 撤离成功：背包物品入仓库，值钱货折现 */
export function depositLoot(name, items, matchValue) {
  const u = db.players[name];
  if (!u) return null;
  for (const it of items) {
    const found = u.stash.find(s => s.id === it.id && ITEMS[it.id] && ITEMS[it.id].stack > 1);
    if (found) found.qty = Math.min(found.qty + it.qty, ITEMS[it.id] ? ITEMS[it.id].stack * 10 : 9999);
    else u.stash.push({ id: it.id, qty: it.qty });
  }
  if (u.stash.length > 80) u.stash = u.stash.slice(-80);
  u.cash += Math.round(matchValue);
  u.stats.extracts += 1;
  if (matchValue > u.stats.bestValue) u.stats.bestValue = Math.round(matchValue);
  save();
  return publicUser(u);
}

export function setBring(name, weaponId) {
  const u = db.players[name];
  if (!u) return null;
  // 合法性校验在路由层完成，这里只做布尔清洗
  u.bring = weaponId || null;
  save();
  return publicUser(u);
}

export function addStats(name, key, delta) {
  const u = db.players[name];
  if (!u) return;
  if (u.stats[key] === undefined) u.stats[key] = 0;
  u.stats[key] += delta;
  save();
}

export function removeBringWeapon(name) {
  const u = db.players[name];
  if (!u || !u.bring) return false;
  const idx = u.stash.findIndex(s => s.id === u.bring);
  if (idx >= 0) {
    u.stash.splice(idx, 1);
    u.bring = null;
    save();
    return true;
  }
  u.bring = null;
  save();
  return false;
}

export function topPlayers(n = 10) {
  return Object.values(db.players)
    .sort((a, b) => b.cash - a.cash)
    .slice(0, n)
    .map(u => ({ name: u.name, cash: u.cash, extracts: u.stats.extracts, kills: u.stats.kills }));
}
