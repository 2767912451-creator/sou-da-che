// ============================================================
// 账号与仓库存储
// 本地：JSON 文件（data/players.json）
// 云端（Render 等临时盘平台）：jsonblob.com 免费云端存储
//   首次启动自动创建 blob 并在日志输出 DATA_BLOB_ID
//   将 DATA_BLOB_ID 设为环境变量后，重启/重新部署数据不丢
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
const BLOB_ID_FILE = path.join(DATA_DIR, 'blob_id');

const JSONBLOB_API = 'https://jsonblob.com/api/jsonBlob';
const CLOUD_ENABLED = process.env.RENDER || process.env.FORCE_CLOUD || false;
const ENV_BLOB_ID = process.env.DATA_BLOB_ID || null;

let db = { players: {} };
let saveTimer = null;
let blobId = null;
let cloudDirty = false;
let cloudTimer = null;

// ---------- 基础工具 ----------
function hashPass(name, pass) {
  return crypto.createHash('sha256').update(`${name}::${pass}::sou-da-che-salt`).digest('hex');
}

// ---------- 本地文件 ----------
function loadFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('[store] 读取本地数据失败', e.message);
    db = { players: {} };
  }
}

function saveFile() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  } catch (e) {
    console.error('[store] 本地写入失败', e.message);
  }
}

// ---------- 云端 (jsonblob.com) ----------
async function cloudLoad() {
  const id = ENV_BLOB_ID || blobId;
  if (!id) return false;
  try {
    const res = await fetch(`${JSONBLOB_API}/${id}`);
    if (!res.ok) { console.error('[store] 云端读取失败 HTTP', res.status); return false; }
    const data = await res.json();
    if (data && data.players) {
      db = data;
      console.log(`[store] 从云端加载数据（${Object.keys(data.players).length} 个账号）`);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[store] 云端读取异常:', e.message);
    return false;
  }
}

async function cloudCreate(data) {
  try {
    const res = await fetch(JSONBLOB_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const loc = res.headers.get('Location');
    if (loc) return loc.split('/').pop();
    return null;
  } catch (e) {
    console.error('[store] 云端创建失败:', e.message);
    return null;
  }
}

async function cloudSave(data) {
  const id = ENV_BLOB_ID || blobId;
  if (!id) return;
  try {
    await fetch(`${JSONBLOB_API}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error('[store] 云端写入失败:', e.message);
  }
}

// 定时回写云端（30 秒内有修改则保存一次）
function scheduleCloudSave() {
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    if (cloudDirty) {
      cloudDirty = false;
      cloudSave(db);
    }
  }, 30000);
}

// ---------- 初始化 ----------
// init 逻辑已内联到模块加载阶段（同步）+ 云端异步加载

function migrate() {
  for (const u of Object.values(db.players)) {
    if (!Array.isArray(u.loadout)) u.loadout = [];
    if (!u.appearance) u.appearance = { h: 0, f: 0, u: 0, l: 0, s: 0 };
    if (!u.stats) u.stats = { matches: 0, extracts: 0, kills: 0, deaths: 0, bestValue: 0 };
  }
}

// ---------- 保存（文件 + 云端） ----------
let blobCreating = false;
function save() {
  saveFile();
  if (CLOUD_ENABLED && !blobId && !blobCreating) {
    blobCreating = true;
    cloudCreate(db).then(id => {
      blobCreating = false;
      if (id) {
        blobId = id;
        console.log('══════════════════════════════════════════');
        console.log(`[store] 云端存储 blob 已创建！`);
        console.log(`[store] 请将此值设为 Render 环境变量 DATA_BLOB_ID=${id}`);
        console.log('══════════════════════════════════════════');
        try { fs.writeFileSync(BLOB_ID_FILE, id); } catch(e) {}
        cloudDirty = true;
        scheduleCloudSave();
      }
    });
    return;   // 首次创建后等下一次 save 才回写
  }
  cloudDirty = true;
  scheduleCloudSave();
}

// ---------- 注册 / 登录 ----------
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

// tokens 放内存（重启后需重新登录，客户端有自动重连逻辑）
const tokens = new Map();

// ---------- 公开用户信息 ----------
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

/** 按昵称取用户 */
export function getUserByName(name) {
  return db.players[name] || null;
}

// ---------- 商店 ----------
export function shopList() {
  const list = [];
  for (const [id, w] of Object.entries(WEAPONS)) {
    list.push({ id, name: w.name, price: Math.round(w.value * 1.2), kind: 'weapon' });
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.kind === 'loot') continue;
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

export function consumeLoadout(name) {
  const u = db.players[name];
  if (!u) return [];
  if (!Array.isArray(u.loadout)) u.loadout = [];
  const items = [];
  for (const l of u.loadout) {
    const entry = u.stash.find(s => s.id === l.id);
    if (!entry) continue;
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

// ---------- 形象 ----------
export function setAppearance(name, appearance) {
  const u = db.players[name];
  if (!u) return { err: '未登录' };
  u.appearance = sanitizeAppearance(appearance);
  save();
  return { ok: true, user: publicUser(u) };
}

// ---------- 带入 ----------
export function setBring(name, weaponId) {
  const u = db.players[name];
  if (!u) return null;
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

export function topPlayers(n = 10) {
  return Object.values(db.players)
    .sort((a, b) => b.cash - a.cash)
    .slice(0, n)
    .map(u => ({ name: u.name, cash: u.cash, extracts: u.stats.extracts, kills: u.stats.kills }));
}

function newUser(name) {
  return {
    name,
    pass: hashPass(name, name),
    cash: 0,
    stash: [],
    loadout: [],
    bring: null,
    appearance: { h: 0, f: 0, u: 0, l: 0, s: 0 },
    stats: { matches: 0, extracts: 0, kills: 0, deaths: 0, bestValue: 0 },
    createdAt: Date.now(),
  };
}

// ---------- 初始化（同步读文件保证启动速度，云端异步后台加载） ----------
loadFile();
migrate();
if (CLOUD_ENABLED && (ENV_BLOB_ID || fs.existsSync(BLOB_ID_FILE))) {
  const id = ENV_BLOB_ID || fs.readFileSync(BLOB_ID_FILE, 'utf8').trim();
  if (id) {
    blobId = id;
    console.log(`[store] 云端存储 ID: ${blobId} → 后台加载中...`);
    cloudLoad().then(ok => {
      if (ok) { migrate(); console.log('[store] 云端数据合并完成'); }
      else console.log('[store] 云端加载失败，使用本地文件');
    });
  }
}
