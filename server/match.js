// ============================================================
// 对局核心：跳伞入场 / 缩圈 / 战斗 / 搜刮 / 撤离 / AI 拾荒者
// 服务端权威：伤害、库存、缩圈、撤离结算全部由服务端裁决
// ============================================================
import {
  ZONE_PHASES, ZONE_START_R, STORM_GRACE, MATCH_LEN,
  EXTRACTORS, EXTRACT_STAND_TIME, PLAYER, WEAPONS, ITEMS, AMMO_OF,
  BOTS, SNAPSHOT_HZ, MAX_PLAYERS, PICKUP_R, SEARCH,
} from '../shared/constants.js';
import { randomAppearance, appearanceObj } from '../shared/appearance.js';
import { terrainHeight } from '../shared/terrain.js';
import { getWorld } from './world.js';
import { depositLoot, addStats } from './store.js';

const BOT_NAMES = ['阿灰', '老蛇', '铁蛋', '夜枭', '山猫', '秃鹫', '野猪', '海鳗', '石斑', '蝰蛇', '灰鲸', '旱獭'];

function rnd(a, b) { return a + Math.random() * (b - a); }
function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// ---------- 战利品表 ----------
const TIER_TABLES = {
  // 一档：渔村/矿场/散屋 —— 生活物资为主，偶尔有点好货
  1: [['a9', 10], ['bandage', 12], ['energy', 7], ['p92', 6], ['smg', 4], ['a762', 5],
      ['watch', 5], ['pack1', 4], ['armor1', 4], ['helm1', 4], ['gpu', 2], ['gold', 1],
      ['medkit', 3], ['apple', 9], ['water', 9], ['canned', 6], ['cup', 5], ['cigs', 5],
      ['battery', 5], ['blanket', 3], ['flashlight', 3], ['radio', 2], ['toolbox', 1],
      ['milkfrog', 4], ['pillow', 1]],
  // 二档：度假村/港口/机场/灯塔 —— 装备与值钱货占比高，生活物资点缀
  2: [['a762', 12], ['a9', 8], ['a338', 4], ['bandage', 8], ['medkit', 6], ['energy', 6],
      ['smg', 6], ['ak', 5], ['p92', 3], ['armor1', 5], ['armor2', 4], ['helm1', 4],
      ['helm2', 3], ['pack1', 5], ['pack2', 3], ['watch', 8], ['gpu', 6], ['gold', 4],
      ['lr', 1], ['apple', 4], ['water', 4], ['canned', 4], ['cup', 3], ['cigs', 3],
      ['battery', 3], ['radio', 2], ['toolbox', 2], ['blanket', 2], ['flashlight', 2],
      ['milkfrog', 2], ['pillow', 2]],
  // 三档：军事基地 —— 顶级装备，杂货偶尔压仓
  3: [['a762', 14], ['a338', 8], ['medkit', 8], ['bandage', 6], ['ak', 10], ['smg', 4],
      ['lr', 3], ['armor2', 6], ['armor3', 4], ['helm2', 5], ['helm3', 3], ['pack2', 6],
      ['gold', 7], ['relic', 3], ['gpu', 5], ['watch', 4],
      ['canned', 3], ['water', 2], ['apple', 2], ['toolbox', 2], ['radio', 1]],
};

function rollItem(tier) {
  const table = TIER_TABLES[tier] || TIER_TABLES[1];
  let total = 0;
  for (const [, w] of table) total += w;
  let r = Math.random() * total;
  let pick = table[0][0];
  for (const [id, w] of table) { r -= w; if (r <= 0) { pick = id; break; } }
  return pick;
}

function makeLootAt(spawn) {
  let item = rollItem(spawn.tier);
  // 室外（箱子/地面）只刷医疗与枪弹——值钱货藏在屋内和保险柜
  if (!spawn.indoor && ITEMS[item] && ITEMS[item].kind === 'loot') {
    item = ['a9', 'a762', 'bandage', 'energy', 'medkit', 'canned'][Math.floor(Math.random() * 6)];
  }
  return finalizeLoot(item, spawn.x, spawn.y + 0.35, spawn.z);
}

function finalizeLoot(itemId, x, y, z) {
  const def = ITEMS[itemId] || WEAPONS[itemId];
  let qty = 1;
  if (def.kind === 'ammo') qty = def.qtyPerPack * (1 + (Math.random() < 0.5 ? 1 : 0));
  else if (def.kind === 'med') qty = itemId === 'bandage' ? 2 + Math.floor(Math.random() * 3) : 1;
  else if (def.kind === 'food') qty = 1 + Math.floor(Math.random() * 2);
  const entry = { item: itemId, qty, x, y, z };
  if (WEAPONS[itemId]) entry.mag = WEAPONS[itemId].mag;
  return entry;
}

// ---------- 射线检测 ----------
function rayAABB(ox, oy, oz, dx, dy, dz, box) {
  // slab 法，返回命中距离或 Infinity
  let tmin = 0, tmax = Infinity;
  const p = [ox, oy, oz], d = [dx, dy, dz];
  const bmin = [box.x0, box.y0, box.z0], bmax = [box.x1, box.y1, box.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (p[i] < bmin[i] || p[i] > bmax[i]) return Infinity;
    } else {
      let t1 = (bmin[i] - p[i]) / d[i], t2 = (bmax[i] - p[i]) / d[i];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

function rayTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
  for (let t = 2; t < maxDist; t += 4) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    if (terrainHeight(x, z) > y) return t;
  }
  return Infinity;
}

// 射线 vs 竖直胶囊（近似为沿高度采样球体）
function rayBody(ox, oy, oz, dx, dy, dz, tx, ty, tz) {
  let best = Infinity, head = false;
  const H = PLAYER.HEIGHT;
  for (let i = 0; i <= 8; i++) {
    const sy = ty + (H / 8) * i;
    const cx = tx, cz = tz;
    // 射线到采样点球心最近距离
    const vx = cx - ox, vy = sy - oy, vz = cz - oz;
    const proj = vx * dx + vy * dy + vz * dz;
    if (proj < 0) continue;
    const px = ox + dx * proj, py = oy + dy * proj, pz = oz + dz * proj;
    const d = Math.hypot(cx - px, sy - py, cz - pz);
    const isHead = sy > ty + H - 0.28;
    const r = isHead ? 0.27 : 0.42;
    if (d < r && proj < best) {
      best = proj;
      head = isHead || (sy > ty + H - 0.35 && d < 0.24);
    }
  }
  return best === Infinity ? null : { t: best, head };
}

function segBlocked(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return false;
  const nx = dx / len, ny = dy / len, nz = dz / len;
  for (const w of getWorld().walls) {
    if (rayAABB(ax, ay, az, nx, ny, nz, w) < len - 0.1) return true;
  }
  return rayTerrain(ax, ay, az, nx, ny, nz, len) < len - 0.5;
}

// ============================================================
export class Match {
  constructor() {
    this.players = new Map();     // id -> player
    this.bots = [];
    this.loot = new Map();        // id -> entity
    this.lootSeq = 1;
    this.state = 'waiting';       // waiting（房间等待室）| live（对局中）
    this.liveStart = 0;
    this.matchLen = MATCH_LEN;
    this.nextPlayerId = 1;
    this._tickRate = 10;          // 逻辑循环 10Hz
    this._lastZoneAt = Date.now();
    this.onPlayerOut = null;      // 玩家出局（死亡/撤离）回调，由房间注入
    // 等待室阶段占位缩圈（开始游戏时重新初始化）
    this.zone = { cx: 0, cz: 0, r: ZONE_START_R };
    this.target = { ...this.zone };
    this.phaseIdx = -1;
    this.phaseMode = 'wait';
    this.phaseTimer = 0;
    this.shrinkFrom = { ...this.zone };
  }

  now() { return Date.now(); }

  // ---------- 生命周期 ----------
  startMatch() {
    this.state = 'live';
    this.liveStart = this.now();
    this.lootSeq = 1;
    this.loot.clear();
    this.openSafes = new Set();
    const w = getWorld();
    const furnById = new Map(w.furniture.map(f => [f.id, f]));
    for (const sp of w.lootSpawns) {
      const e = makeLootAt(sp);
      e.id = 'L' + this.lootSeq++;
      // 战利品所在容器（table/cabinet/shelf → 需搜刮；safe → 撬开后可见）
      if (sp.on && furnById.get(sp.on)) {
        const kind = furnById.get(sp.on).kind;
        e.container = kind;
        e.furnId = sp.on;
        if (kind === 'safe') { e.hidden = true; e.safeId = sp.on; }
      }
      this.loot.set(e.id, e);
    }
    // 高价值道具优先藏进保险柜
    const safes = w.furniture.filter(f => f.kind === 'safe');
    const safeLoad = new Map();
    for (const e of this.loot.values()) {
      if (e.safeId) safeLoad.set(e.safeId, (safeLoad.get(e.safeId) || 0) + 1);
    }
    const valuable = [...this.loot.values()]
      .filter(e => !e.hidden && ((ITEMS[e.item] || {}).kind === 'loot' || ((ITEMS[e.item] || WEAPONS[e.item] || {}).value || 0) >= SEARCH.SAFE_MIN_VALUE))
      .sort((a, b) => ((ITEMS[b.item] || WEAPONS[b.item] || {}).value || 0) - ((ITEMS[a.item] || WEAPONS[a.item] || {}).value || 0));
    let si = Math.floor(Math.random() * safes.length);
    for (const e of valuable) {
      const safe = safes[si % safes.length];
      const loaded = safeLoad.get(safe.id) || 0;
      if (loaded >= SEARCH.SAFE_ITEM_MAX) { si++; continue; }
      e.hidden = true;
      e.safeId = safe.id;
      e.container = 'safe';
      e.x = safe.x; e.y = safe.y + safe.h; e.z = safe.z;
      safeLoad.set(safe.id, loaded + 1);
      si++;
    }
    this.spawnBots();
    // 缩圈初始化
    this.zone = { cx: rnd(-140, 140), cz: rnd(-140, 140), r: ZONE_START_R };
    this.phaseIdx = -1;
    this.phaseMode = 'wait';
    this.phaseTimer = 6;        // 开局 6 秒后第一个阶段开始倒计时
    this.target = { ...this.zone };
    this.matchT = 0;
    for (const p of this.players.values()) {
      if (p.state === 'wait') this.spawnPlayer(p);
    }
    // 战利品刷新，全员同步（保险柜里的内容不下发）
    for (const p of this.players.values()) {
      this.send(p, { t: 'lootInit', loot: this.visibleLoot(), openSafes: [...this.openSafes] });
    }
    console.log(`[match] 新对局开始，战利品 ${this.loot.size} 个（保险柜藏匿 ${[...this.loot.values()].filter(e => e.hidden).length}），玩家 ${this.players.size}`);
  }

  endMatch(reason = '全员离场') {
    // 本局结束：回到房间等待室，战利品重置（下一局开始时重新生成）
    this.state = 'waiting';
    this.bots = [];
    this.loot.clear();
    this.openSafes = new Set();
    for (const p of this.players.values()) {
      // 理论上此时不应有残留的局内玩家，兜底复位
      if (p.state !== 'wait') { p.state = 'wait'; p.inv = []; p.armor = null; p.helmet = null; p.packSlots = 0; }
    }
    this.broadcastAll({ t: 'matchEnd', reason });
    if (this.onMatchEnd) this.onMatchEnd();
    console.log(`[match] 对局结束（${reason}），房间回到等待室`);
  }

  visibleLoot() {
    return [...this.loot.values()].filter(e => !e.hidden);
  }

  matchTime() { return (this.now() - this.liveStart) / 1000; }

  spawnBots() {
    const w = getWorld();
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5).slice(0, BOTS.COUNT);
    this.bots = names.map((nick, i) => {
      const poi = w.pois[i % w.pois.length];
      const x = poi.x + rnd(-60, 60), z = poi.z + rnd(-60, 60);
      return {
        id: 'B' + (i + 1), name: '拾荒者·' + nick,
        x, z, y: Math.max(terrainHeight(x, z), 1),
        yaw: rnd(0, Math.PI * 2), hp: BOTS.HP,
        state: 'patrol', target: null, wpX: poi.x, wpZ: poi.z,
        nextFire: 0, wpoi: (i % w.pois.length), dead: false,
        a: appearanceObj(randomAppearance()),
      };
    });
  }

  // ---------- 玩家 ----------
  join(ws, name, user) {
    // 只能在房间等待室加入（对局进行中由房间层直接拒绝）
    const id = 'P' + this.nextPlayerId++;
    const p = {
      id, name, ws, user,
      x: 0, y: 400, z: 0, yaw: 0, pitch: 0,
      state: 'wait',            // wait=房间等待室 | sky/ground=对局中 | dead/gone=已出局
      hp: PLAYER.HP, dead: false,
      armor: null, helmet: null, packSlots: 0,
      inv: [], equipped: -1,
      kills: 0, joinedAt: this.now(),
      lastShotAt: 0, reloadUntil: 0, castUntil: 0, castItem: null,
      energyUntil: 0, extractProg: 0, extractId: null,
      lastX: 0, lastZ: 0, lastPosAt: this.now(),
      crouch: false, sprint: false,
      loadoutItems: [],         // 开局注入的携带清单物资
      action: null,
    };
    this.players.set(id, p);
    this.send(p, { t: 'welcome', selfId: id, live: false });
    console.log(`[match] ${name} 加入房间 (${this.state})`);
    return p;
  }

  spawnPlayer(p) {
    p.state = 'sky';
    p.hp = PLAYER.HP;
    p.x = -620 + 1240 * rnd(0.25, 0.75); p.z = -320; p.y = 330;
    p.extractProg = 0; p.extractId = null;
    p.dead = false;
    p.action = null;
    p.armor = null; p.helmet = null; p.packSlots = 0;
    this.buildLoadout(p);
    this.send(p, { t: 'matchStart' });
    this.sendInventory(p);
  }

  buildLoadout(p) {
    // 初始装备（免费）+ 携带清单物资（房主开局时已从仓库扣除并注入）
    p.inv = [{ id: 'p92', qty: 1, mag: 12 }, { id: 'a9', qty: 24 }, { id: 'bandage', qty: 2 }];
    for (const it of (p.loadoutItems || [])) {
      p.inv.push({ ...it });
    }
    p.equipped = p.inv.findIndex(e => WEAPONS[e.id]);
    if (p.equipped < 0) p.equipped = 0;
  }

  leave(p) {
    if (p.state === 'ground' || p.state === 'sky') {
      // 断线视为撤损失败：掉落物资
      this.dropAllInv(p);
    }
    this.broadcastAll({ t: 'msg', text: `${p.name} 离开了战场` });
    this.players.delete(p.id);
  }

  // ---------- 库存 ----------
  capacity(p) { return PLAYER.SLOTS + p.packSlots; }

  sendInventory(p) {
    this.send(p, {
      t: 'inv', items: p.inv, equipped: p.equipped,
      armor: p.armor ? { id: p.armor.id, dur: p.armor.dur } : null,
      helmet: p.helmet, packSlots: p.packSlots, cap: this.capacity(p),
    });
  }

  addToInv(p, itemId, qty, mag) {
    const def = ITEMS[itemId] || WEAPONS[itemId];
    if (!def) return false;
    if (WEAPONS[itemId]) {
      if (p.inv.length >= this.capacity(p)) return false;
      p.inv.push({ id: itemId, qty: 1, mag: mag !== undefined ? mag : WEAPONS[itemId].mag });
      return true;
    }
    // 可堆叠
    if (def.stack > 1) {
      for (const e of p.inv) {
        if (e.id === itemId && e.qty < def.stack) {
          const add = Math.min(qty, def.stack - e.qty);
          e.qty += add; qty -= add;
          if (qty <= 0) return true;
        }
      }
    }
    while (qty > 0) {
      if (p.inv.length >= this.capacity(p)) return false;
      const add = def.stack > 1 ? Math.min(qty, def.stack) : 1;
      p.inv.push({ id: itemId, qty: add });
      qty -= add;
    }
    return true;
  }

  equipPack(p, itemId) {
    const def = ITEMS[itemId];
    if (def.kind === 'pack' && def.slots > p.packSlots) {
      p.packSlots = def.slots;
      return true;   // 背包直接消耗
    }
    return false;
  }

  dropAllInv(p) {
    const items = [];
    for (const e of p.inv) items.push(e);
    p.inv = [];
    p.equipped = -1;
    let i = 0;
    for (const e of items) {
      const fx = (Math.random() - 0.5) * 2.4, fz = (Math.random() - 0.5) * 2.4;
      const entity = finalizeLoot(e.id, p.x + fx, Math.max(terrainHeight(p.x, p.z), 0.4) + 0.35, p.z + fz);
      entity.qty = e.qty;
      if (e.mag !== undefined) entity.mag = e.mag;
      entity.id = 'L' + this.lootSeq++;
      this.loot.set(entity.id, entity);
      this.broadcastAll({ t: 'lootAdd', loot: [entity] });
      i++;
    }
    return items;
  }

  // ---------- 伤害 ----------
  damage(p, dmg, headshot, attacker, weaponName) {
    if (p.hp <= 0) return;
    let d = dmg;
    if (headshot && p.helmet) {
      d *= 1 - ITEMS[p.helmet].headReduce;
    }
    if (!headshot && p.armor && p.armor.dur > 0) {
      const absorb = ITEMS[p.armor.id].absorb;
      const blocked = d * absorb;
      d -= blocked;
      p.armor.dur -= blocked * 0.9;
      if (p.armor.dur <= 0) this.send(p, { t: 'msg', text: '防弹衣已被打穿！' });
    }
    p.hp -= d;
    if (attacker) {
      console.log(`[match] ${p.name} 受到 ${Math.round(d)} 伤害 ← ${attacker.name}（剩余 ${Math.max(0, Math.round(p.hp))}）`);
    }
    this.send(p, { t: 'hurt', dmg: Math.round(d), hp: Math.max(0, Math.round(p.hp)), from: attacker ? { x: attacker.x, z: attacker.z } : null });
    if (p.hp <= 0) this.killPlayer(p, { by: attacker, weapon: weaponName });
  }

  killPlayer(p, { by = null, weapon = '未知', storm = false } = {}) {
    if (p.hp > 0 && !storm) return;
    if (p.dead) return;   // 防止风暴重复击杀打印
    p.hp = 0; p.dead = true; p.state = 'dead';
    p.action = null;
    console.log(`[match] ${p.name} 阵亡 (${by ? by.name : '未知'} / ${weapon})`);
    const items = this.dropAllInv(p);
    const lostValue = items.reduce((s, e) => s + (ITEMS[e.id] || WEAPONS[e.id] || {}).value * e.qty, 0);
    if (by && by.id && by.id.startsWith('P')) {
      by.kills++;
      addStats(by.name, 'kills', 1);
      this.broadcastAll({ t: 'kill', killer: by.name, victim: p.name, weapon });
    } else if (storm) {
      this.broadcastAll({ t: 'kill', killer: '风暴', victim: p.name, weapon: 'storm' });
    } else if (by && by.name) {
      this.broadcastAll({ t: 'kill', killer: by.name, victim: p.name, weapon });
    }
    addStats(p.name, 'deaths', 1);
    addStats(p.name, 'matches', 1);
    this.send(p, { t: 'died', by: by ? by.name : (storm ? '风暴' : '未知'), lostValue });
    p.extractProg = 0;
    // 出局：从对局名单移除（房间保持成员身份，回到等待室）
    if (this.onPlayerOut) this.onPlayerOut(p);
  }

  // ---------- 射击 ----------
  handleShoot(p, msg) {
    if (p.state !== 'ground' || p.hp <= 0) return;
    const now = this.now();
    if (now < p.reloadUntil || now < p.castUntil) return;
    const wEntry = p.inv[p.equipped];
    if (!wEntry || !WEAPONS[wEntry.id]) return;
    const w = WEAPONS[wEntry.id];
    const interval = 1000 / w.rate;
    if (now - p.lastShotAt < interval - 20) return;
    if (w.type === 'gun' && wEntry.mag <= 0) { this.send(p, { t: 'msg', text: '弹匣已空' }); return; }

    p.lastShotAt = now;
    if (w.type === 'gun') wEntry.mag--;

    const ox = p.x, oy = p.y + (p.crouch ? PLAYER.EYE_CROUCH : PLAYER.EYE), oz = p.z;
    let dx = msg.dir.x, dy = msg.dir.y, dz = msg.dir.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const range = w.range;

    // 找最近命中
    let bestT = Math.min(range, 400), bestTarget = null, bestHead = false;
    const wallT = this.raycastWalls(ox, oy, oz, dx, dy, dz, bestT);
    if (wallT < bestT) bestT = wallT;
    const terrT = rayTerrain(ox, oy, oz, dx, dy, dz, bestT);
    if (terrT < bestT) bestT = terrT;

    for (const q of this.players.values()) {
      if (q === p || q.hp <= 0 || q.state !== 'ground') continue;
      if (dist2d(ox, oz, q.x, q.z) > bestT + 2) continue;
      const hit = rayBody(ox, oy, oz, dx, dy, dz, q.x, q.y, q.z);
      if (hit && hit.t < bestT) { bestT = hit.t; bestTarget = q; bestHead = hit.head; }
    }
    for (const b of this.bots) {
      if (b.dead) continue;
      if (dist2d(ox, oz, b.x, b.z) > bestT + 2) continue;
      const hit = rayBody(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z);
      if (hit && hit.t < bestT) { bestT = hit.t; bestTarget = b; bestHead = hit.head; }
    }

    // 弹道特效（其他玩家可见）
    const end = { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT };
    this.broadcastExcept(p, { t: 'fx', kind: 'shot', from: { x: ox, y: oy, z: oz }, to: end, weapon: wEntry.id });

    if (bestTarget) {
      let dmg = w.dmg * (bestHead ? (w.headMult || 1.8) : 1);
      // 距离衰减
      if (bestT > w.range * 0.7) dmg *= 0.8;
      if (bestTarget.id.startsWith('B')) {
        this.damageBot(bestTarget, dmg, bestHead, p, w.name);
      } else {
        this.damage(bestTarget, dmg, bestHead, p, w.name);
      }
      this.send(p, { t: 'confirm', dmg: Math.round(dmg), killed: bestTarget.hp <= 0, head: bestHead });
    }
    // 命中点特效广播
    if (bestTarget === null || bestTarget.id.startsWith('B')) {
      this.broadcastAll({ t: 'fx', kind: 'impact', at: end });
    }
    this.sendInventoryDirty(p);
  }

  raycastWalls(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    for (const w of getWorld().walls) {
      const t = rayAABB(ox, oy, oz, dx, dy, dz, w);
      if (t < best) best = t;
    }
    return best;
  }

  damageBot(b, dmg, headshot, attacker, weaponName) {
    b.hp -= dmg;
    if (b.hp <= 0 && !b.dead) {
      b.dead = true;
      // 掉落随机物资
      const n = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const item = rollItem(2);
        const entity = finalizeLoot(item, b.x + rnd(-1, 1), Math.max(terrainHeight(b.x, b.z), 0.4) + 0.35, b.z + rnd(-1, 1));
        entity.id = 'L' + this.lootSeq++;
        this.loot.set(entity.id, entity);
        this.broadcastAll({ t: 'lootAdd', loot: [entity] });
      }
      this.broadcastAll({ t: 'kill', killer: attacker.name, victim: b.name, weapon: weaponName });
      addStats(attacker.name, 'kills', 1);
      attacker.kills++;
    }
  }

  sendInventoryDirty(p) {
    // 只在弹药数变化时同步（简化：射击后总是同步一次）
    this.send(p, { t: 'invAmmo', equipped: p.equipped, mag: p.inv[p.equipped] ? p.inv[p.equipped].mag : 0 });
  }

  // ---------- 消息处理 ----------
  onMsg(p, msg) {
    try {
      switch (msg.t) {
        case 'pos': this.onPos(p, msg); break;
        case 'land': this.onLand(p); break;
        case 'shoot': this.handleShoot(p, msg); break;
        case 'reload': this.onReload(p); break;
        case 'equip': {
          const idx = msg.idx | 0;
          if (idx >= 0 && idx < p.inv.length && WEAPONS[p.inv[idx].id]) {
            p.equipped = idx;
            p.reloadUntil = 0;
            this.sendInventory(p);
          }
          break;
        }
        case 'use': this.onUse(p, msg.slot | 0); break;
        case 'drop': this.onDrop(p, msg.slot | 0); break;
        case 'loot': this.onLoot(p, msg.id); break;
        case 'search': this.onSearch(p, msg); break;
        default: break;
      }
    } catch (e) {
      console.error('[match] 消息处理异常', e);
    }
  }

  onPos(p, msg) {
    if (p.state !== 'ground' && p.state !== 'sky') return;
    const now = this.now();
    const dt = Math.max(0.05, (now - p.lastPosAt) / 1000);
    let { x, y, z } = msg;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;

    const dx = x - p.lastX, dz = z - p.lastZ;
    const dist = Math.hypot(dx, dz);
    const maxSpeed = p.state === 'sky' ? 32 : (PLAYER.SPRINT * (p.energyUntil > now ? 1.15 : 1)) + 1.5;
    if (dist / dt > maxSpeed) {
      const scale = (maxSpeed * dt) / dist;
      x = p.lastX + dx * scale;
      z = p.lastZ + dz * scale;
    }
    // 高度约束
    const th = terrainHeight(x, z);
    if (p.state === 'ground') {
      // 深水区玩家在水面（游泳）
      const floor = th < -1.4 ? 0 : th;
      if (y < floor - 2) y = floor - 2;
      if (y > floor + 20) y = floor + 20;
    } else if (p.state === 'sky') {
      if (y > 420) y = 420;
      if (y < th) y = th;
    }
    p.lastX = x; p.lastZ = z; p.lastPosAt = now;
    p.x = x; p.y = y; p.z = z;
    p.yaw = msg.yaw || 0; p.pitch = msg.pitch || 0;
    p.crouch = !!msg.cr; p.sprint = !!msg.sp;
  }

  onLand(p) {
    if (p.state !== 'sky') return;
    const floor = Math.max(terrainHeight(p.x, p.z), 0);   // 水面=游泳
    if (Math.abs(p.y - floor) < 3.5) {
      p.y = floor;
      p.state = 'ground';
      this.send(p, { t: 'landed', y: p.y });
    }
  }

  onReload(p) {
    if (p.state !== 'ground') return;
    const wEntry = p.inv[p.equipped];
    if (!wEntry || !WEAPONS[wEntry.id]) return;
    const w = WEAPONS[wEntry.id];
    if (w.type !== 'gun' || wEntry.mag >= w.mag) return;
    if (this.now() < p.reloadUntil || this.now() < p.castUntil) return;
    const ammoId = w.ammo;
    const reserve = p.inv.find(e => e.id === ammoId);
    if (!reserve || reserve.qty <= 0) { this.send(p, { t: 'msg', text: '没有可用弹药' }); return; }
    p.reloadUntil = this.now() + w.reload * 1000;
    const need = w.mag - wEntry.mag;
    const take = Math.min(need, reserve.qty);
    setTimeout(() => {
      if (p.hp <= 0) return;
      const cur = p.inv.find(e => e.id === ammoId);
      const we = p.inv[p.equipped];
      if (we && we.id === wEntry.id && cur) {
        const take = Math.min(w.mag - we.mag, cur.qty);
        we.mag += take;
        cur.qty -= take;
        if (cur.qty <= 0) p.inv.splice(p.inv.indexOf(cur), 1);
        this.sendInventory(p);
      }
    }, w.reload * 1000);
    this.send(p, { t: 'reloading', dur: w.reload });
  }

  onUse(p, slot) {
    if (p.state !== 'ground' || p.hp <= 0) return;
    const e = p.inv[slot];
    if (!e) return;
    const def = ITEMS[e.id];
    if (!def) return;
    if (def.kind === 'armor') {
      const tier = e.id;
      if (!p.armor || ITEMS[tier].absorb > ITEMS[p.armor.id].absorb) {
        if (p.armor) {
          const old = { id: p.armor.id, qty: 1 };
          p.inv[slot] = old;   // 换下旧的放回格子
          p.armor = { id: tier, dur: ITEMS[tier].dur };
        } else {
          p.armor = { id: tier, dur: ITEMS[tier].dur };
          p.inv.splice(slot, 1);
        }
        this.sendInventory(p);
      }
      return;
    }
    if (def.kind === 'helmet') {
      if (!p.helmet || ITEMS[e.id].headReduce > ITEMS[p.helmet].headReduce) {
        const old = p.helmet;
        p.helmet = e.id;
        p.inv.splice(slot, 1);
        if (old) p.inv.push({ id: old, qty: 1 });
        this.sendInventory(p);
      }
      return;
    }
    if (def.kind === 'pack') {
      if (this.equipPack(p, e.id)) {
        p.inv.splice(slot, 1);
        this.send(p, { t: 'msg', text: `已装备${def.name}（+${def.slots} 格）` });
        this.sendInventory(p);
      }
      return;
    }
    if (def.kind === 'med' || def.kind === 'food') {
      if (this.now() < p.castUntil) return;
      if (p.hp >= PLAYER.HP && !def.buff) return;
      p.castUntil = this.now() + def.cast * 1000;
      p.castItem = { slot, id: e.id };
      this.send(p, { t: 'casting', dur: def.cast, item: e.id });
      setTimeout(() => {
        if (p.hp <= 0 || !p.castItem) return;
        const ce = p.inv[p.castItem.slot];
        if (!ce || ce.id !== p.castItem.id) return;
        const cdef = ITEMS[ce.id];
        p.hp = Math.min(PLAYER.HP, p.hp + (cdef.heal || 0));
        if (cdef.buff) p.energyUntil = this.now() + cdef.buff * 1000;
        ce.qty--;
        if (ce.qty <= 0) p.inv.splice(p.castItem.slot, 1);
        p.castItem = null;
        this.sendInventory(p);
        this.send(p, { t: 'castDone', hp: Math.round(p.hp) });
      }, def.cast * 1000);
    }
  }

  onDrop(p, slot) {
    if (p.state !== 'ground') return;
    const e = p.inv[slot];
    if (!e) return;
    p.inv.splice(slot, 1);
    if (p.equipped >= p.inv.length) p.equipped = p.inv.length - 1;
    const entity = finalizeLoot(e.id, p.x + rnd(-1, 1), Math.max(terrainHeight(p.x, p.z), 0.4) + 0.35, p.z + rnd(-1, 1));
    entity.qty = e.qty;
    if (e.mag !== undefined) entity.mag = e.mag;
    entity.id = 'L' + this.lootSeq++;
    this.loot.set(entity.id, entity);
    this.broadcastAll({ t: 'lootAdd', loot: [entity] });
    this.sendInventory(p);
  }

  onLoot(p, lootId) {
    if (p.state !== 'ground' || p.hp <= 0) { console.log(`[loot] ${p.name} 拾取失败: 状态 ${p.state}`); return; }
    const e = this.loot.get(lootId);
    if (!e) { console.log(`[loot] ${p.name} 拾取失败: 战利品不存在 ${lootId}`); return; }
    const d = dist2d(p.x, p.z, e.x, e.z);
    if (d > PICKUP_R + 1.2) {
      console.log(`[loot] ${p.name} 拾取失败: 距离 ${d.toFixed(1)}m (服务端坐标 ${p.x.toFixed(1)},${p.z.toFixed(1)} vs 战利品 ${e.x.toFixed(1)},${e.z.toFixed(1)})`);
      this.send(p, { t: 'msg', text: '距离太远，走近一点' });
      return;
    }
    this.doPickup(p, e);
  }

  doPickup(p, e) {
    const ok = this.addToInv(p, e.item, e.qty, e.mag);
    if (!ok) { this.send(p, { t: 'msg', text: '背包已满！' }); return; }
    this.loot.delete(e.id);
    this.broadcastAll({ t: 'lootDel', ids: [e.id] });
    const def = ITEMS[e.item] || WEAPONS[e.item];
    this.send(p, { t: 'msg', text: `拾取 ${def.name} ×${e.qty}` });
    this.sendInventory(p);
  }

  // ---------- 搜刮 / 撬保险柜 ----------
  onSearch(p, msg) {
    if (p.state !== 'ground' || p.hp <= 0) return;
    if (p.action) return;   // 已在进行中
    const now = this.now();
    if (msg.safe) {
      // 撬保险柜
      const w = getWorld();
      const safe = w.furniture.find(f => f.id === msg.id && f.kind === 'safe');
      if (!safe) return;
      if (this.openSafes.has(safe.id)) { this.send(p, { t: 'msg', text: '保险柜已经开了' }); return; }
      if (dist2d(p.x, p.z, safe.x, safe.z) > 3.0) { this.send(p, { t: 'msg', text: '离保险柜太远' }); return; }
      p.action = { type: 'safe', id: safe.id, x: p.x, z: p.z, endsAt: now + SEARCH.safe.dur * 1000, dur: SEARCH.safe.dur };
    } else {
      // 搜刮家具上的战利品
      const e = this.loot.get(msg.id);
      if (!e || e.hidden) return;
      if (dist2d(p.x, p.z, e.x, e.z) > PICKUP_R + 1.2) { this.send(p, { t: 'msg', text: '距离太远' }); return; }
      const dur = e.container && SEARCH[e.container] ? SEARCH[e.container].dur : 0;
      if (dur <= 0) { this.doPickup(p, e); return; }   // 地面物资秒捡兜底
      p.action = { type: 'loot', id: e.id, x: p.x, z: p.z, endsAt: now + dur * 1000, dur };
    }
  }

  tickActions() {
    const now = this.now();
    for (const p of this.players.values()) {
      const a = p.action;
      if (!a) continue;
      if (p.state !== 'ground' || p.hp <= 0) { p.action = null; continue; }
      if (dist2d(p.x, p.z, a.x, a.z) > 2.2) {
        p.action = null;
        this.send(p, { t: 'msg', text: '移动打断搜刮' });
        continue;
      }
      if (now >= a.endsAt) {
        p.action = null;
        if (a.type === 'loot') {
          const e = this.loot.get(a.id);
          if (e) this.doPickup(p, e);
        } else if (a.type === 'safe') {
          this.openSafe(p, a.id);
        }
      }
    }
  }

  openSafe(p, safeId) {
    if (this.openSafes.has(safeId)) return;
    this.openSafes.add(safeId);
    this.broadcastAll({ t: 'safeOpen', id: safeId });
    // 释放柜内战利品
    const revealed = [];
    for (const e of this.loot.values()) {
      if (e.safeId === safeId && e.hidden) {
        e.hidden = false;
        revealed.push(e);
      }
    }
    if (revealed.length) this.broadcastAll({ t: 'lootAdd', loot: revealed });
    const def = p && p.name ? `（${p.name}）` : '';
    console.log(`[safe] 保险柜 ${safeId} 被撬开 ${def}`);
  }

  // ---------- 主循环 ----------
  tick() {
    const now = this.now();
    if (this.state === 'live') this.tickLive(now);
    this.tickBots(now);
    this.tickExtract(now);
    this.tickActions();
  }

  tickLive(now) {
    const t = this.matchTime();
    this.matchT = t;
    this._advanceZone(t);
    // 圈外伤害（1 秒一次，用取整节流）
    if (Math.floor(t) !== Math.floor(t - 0.1)) {
      const dps = this.curDps();
      for (const p of this.players.values()) {
        if (p.hp > 0 && p.state === 'ground') {
          const d = dist2d(p.x, p.z, this.zone.cx, this.zone.cz);
          if (d > this.zone.r) {
            this.damage(p, dps, false, { name: '风暴' }, '风暴');
          }
        }
      }
      for (const b of this.bots) {
        if (!b.dead && dist2d(b.x, b.z, this.zone.cx, this.zone.cz) > this.zone.r) {
          b.hp -= this.curDps();
          if (b.hp <= 0) b.dead = true;
        }
      }
    }
    // 终局风暴：时间到，清掉剩余玩家（全员出局后下一拍触发 endMatch）
    if (t >= MATCH_LEN) {
      for (const p of this.players.values()) {
        if (p.state === 'ground' || p.state === 'sky') {
          this.killPlayer(p, { storm: true });
        }
      }
    }
    // 所有玩家都撤离或阵亡 → 本局结束
    const active = [...this.players.values()].filter(p => p.state === 'ground' || p.state === 'sky').length;
    if (active === 0) this.endMatch('全员撤离或阵亡');
  }

  _advanceZone(t) {
    // 用真实 dt
    const dt = Math.min(0.5, (this.now() - (this._lastZoneAt || this.now())) / 1000);
    this._lastZoneAt = this.now();
    if (this.phaseIdx >= ZONE_PHASES.length) return;
    if (this.phaseMode === 'wait') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phaseIdx++;
        if (this.phaseIdx < ZONE_PHASES.length) {
          const ph = ZONE_PHASES[this.phaseIdx];
          // 目标圆在当前圆内
          const maxOff = Math.max(0, this.zone.r - ph.r - 30);
          const ang = rnd(0, Math.PI * 2), off = rnd(0, maxOff);
          this.target = { cx: this.zone.cx + Math.cos(ang) * off, cz: this.zone.cz + Math.sin(ang) * off, r: ph.r, dps: ph.dps };
          this.shrinkFrom = { ...this.zone };
          this.phaseMode = 'shrink';
          this.phaseTimer = ph.shrink;
          this.broadcastAll({ t: 'msg', text: `缩圈开始！向安全区移动（${ph.shrink}s）` });
        }
      }
    } else if (this.phaseMode === 'shrink') {
      this.phaseTimer -= dt;
      const ph = ZONE_PHASES[this.phaseIdx];
      const prog = 1 - Math.max(0, this.phaseTimer) / ph.shrink;
      const from = this.shrinkFrom;
      this.zone.cx = from.cx + (this.target.cx - from.cx) * prog;
      this.zone.cz = from.cz + (this.target.cz - from.cz) * prog;
      this.zone.r = from.r + (this.target.r - from.r) * prog;
      if (this.phaseTimer <= 0) {
        this.zone = { cx: this.target.cx, cz: this.target.cz, r: this.target.r };
        if (this.phaseIdx < ZONE_PHASES.length - 1) {
          this.phaseMode = 'wait';
          this.phaseTimer = ZONE_PHASES[this.phaseIdx + 1].wait;
          this.target = { ...this.zone };
        } else {
          this.phaseMode = 'final';
          this.broadcastAll({ t: 'msg', text: '最终风暴即将清场，快撤离！' });
        }
      }
    }
  }

  curDps() {
    if (this.phaseIdx < 0) return 1;
    if (this.phaseIdx >= ZONE_PHASES.length) return 30;
    if (this.phaseMode === 'shrink') return ZONE_PHASES[this.phaseIdx].dps;
    return this.phaseIdx === 0 ? 1 : ZONE_PHASES[this.phaseIdx - 1].dps;
  }

  zoneState() {
    return {
      cx: this.zone.cx, cz: this.zone.cz, r: this.zone.r,
      tcx: this.target.cx, tcz: this.target.cz, tr: this.target.r,
      mode: this.phaseMode, phase: this.phaseIdx,
      timer: Math.max(0, this.phaseTimer),
      dps: this.curDps(),
    };
  }

  extractorState(now) {
    const t = this.matchTime();
    return EXTRACTORS.map(ex => {
      const tin = ((t - ex.offset) % ex.period + ex.period) % ex.period;
      const open = tin < ex.open;
      const nextIn = open ? ex.open - tin : ex.period - tin;
      return { id: ex.id, open, nextIn: Math.ceil(nextIn) };
    });
  }

  tickExtract(now) {
    if (this.state !== 'live') return;
    const states = this.extractorState(now);
    const openMap = {};
    for (const s of states) openMap[s.id] = s.open;
    const dt = 1 / (this._tickRate || 10);
    for (const p of this.players.values()) {
      if (p.state !== 'ground' || p.hp <= 0) { p.extractProg = 0; continue; }
      let inZone = null;
      for (const ex of EXTRACTORS) {
        if (!openMap[ex.id]) continue;
        if (dist2d(p.x, p.z, ex.x, ex.z) < ex.r) { inZone = ex; break; }
      }
      if (inZone) {
        if (p.extractId !== inZone.id) { p.extractId = inZone.id; p.extractProg = 0; }
        p.extractProg += dt / EXTRACT_STAND_TIME;
        if (p.extractProg >= 1) this.extractPlayer(p);
      } else {
        p.extractId = null; p.extractProg = 0;
      }
    }
  }

  extractPlayer(p) {
    const value = p.inv.reduce((s, e) => s + ((ITEMS[e.id] || WEAPONS[e.id] || {}).value || 0) * e.qty, 0);
    const items = p.inv.map(e => ({ id: e.id, qty: e.qty }));
    const user = depositLoot(p.name, items, value);
    p.state = 'gone';
    p.extractProg = 0;
    addStats(p.name, 'matches', 1);
    this.send(p, { t: 'extracted', cash: Math.round(value), items: items.length, user });
    this.broadcastAll({ t: 'msg', text: `${p.name} 成功撤离！（收获 ¥${Math.round(value)}）` });
    this.broadcastAll({ t: 'kill', killer: '', victim: p.name, weapon: 'extract' });
    console.log(`[match] ${p.name} 撤离成功 +¥${Math.round(value)}`);
    // 出局：从对局名单移除（房间保持成员身份，回到等待室）
    if (this.onPlayerOut) this.onPlayerOut(p);
  }

  // ---------- AI ----------
  tickBots(now) {
    if (this.state !== 'live') return;
    const dt = 1 / (this._tickRate || 10);
    for (const b of this.bots) {
      if (b.dead) continue;
      // 索敌
      let target = null, bestD = BOTS.AGGRO_R;
      for (const p of this.players.values()) {
        if (p.state !== 'ground' || p.hp <= 0) continue;
        const d = dist2d(b.x, b.z, p.x, p.z);
        if (d < bestD && !segBlocked(b.x, b.y + 1.4, b.z, p.x, p.y + 1.4, p.z)) {
          target = p; bestD = d;
        }
      }
      if (target) {
        b.state = 'attack';
        b.target = target.id;
        // 面向目标
        b.yaw = Math.atan2(target.x - b.x, target.z - b.z);
        // 保持 12-20m 距离
        const d = bestD;
        let mvx = 0, mvz = 0;
        if (d > 18) { mvx = (target.x - b.x) / d; mvz = (target.z - b.z) / d; }
        else if (d < 10) { mvx = -(target.x - b.x) / d; mvz = -(target.z - b.z) / d; }
        this.moveBot(b, mvx, mvz, BOTS.SPRINT, dt);
        // 开火
        if (now >= b.nextFire && d < 45) {
          b.nextFire = now + rnd(BOTS.FIRE_INTERVAL[0] * 1000, BOTS.FIRE_INTERVAL[1] * 1000);
          this.botShoot(b, target, d);
        }
      } else {
        b.state = 'patrol';
        // 走向路点
        const d = dist2d(b.x, b.z, b.wpX, b.wpZ);
        if (d < 6) {
          const w = getWorld();
          const poi = w.pois[b.wpoi];
          b.wpX = poi.x + rnd(-poi.r * 0.8, poi.r * 0.8);
          b.wpZ = poi.z + rnd(-poi.r * 0.8, poi.r * 0.8);
        } else {
          this.moveBot(b, (b.wpX - b.x) / d, (b.wpZ - b.z) / d, BOTS.WALK, dt);
        }
        b.yaw = Math.atan2(b.wpX - b.x, b.wpZ - b.z);
      }
      // 贴地
      const th = terrainHeight(b.x, b.z);
      b.y += (Math.max(th, 0.5) - b.y) * Math.min(1, dt * 8);
    }
  }

  moveBot(b, dx, dz, speed, dt) {
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    dx /= len; dz /= len;
    const step = speed * dt;
    let nx = b.x + dx * step, nz = b.z + dz * step;
    // 碰撞：如果新位置在墙内，尝试单轴滑动
    if (this.posBlocked(nx, nz)) {
      if (!this.posBlocked(nx, b.z)) { nz = b.z; }
      else if (!this.posBlocked(b.x, nz)) { nx = b.x; }
      else { nx = b.x; nz = b.z; }
    }
    // 水域限制
    if (terrainHeight(nx, nz) < -1.2) { nx = b.x; nz = b.z; }
    b.x = nx; b.z = nz;
  }

  posBlocked(x, z) {
    for (const w of getWorld().walls) {
      if (x > w.x0 - 0.4 && x < w.x1 + 0.4 && z > w.z0 - 0.4 && z < w.z1 + 0.4 && w.y1 > 1.5) return true;
    }
    return false;
  }

  botShoot(b, target, d) {
    // 概率命中（已检查视线）
    const acc = Math.max(0.12, BOTS.HIT_BASE * (1 - d / 55));
    const hit = Math.random() < acc;
    const oy = b.y + 1.4;
    const tx = target.x, ty = target.y + 1.2, tz = target.z;
    // 广播枪声特效给目标附近玩家
    const end = hit ? { x: tx, y: ty, z: tz } : { x: tx + rnd(-3, 3), y: ty + rnd(-1, 2), z: tz + rnd(-3, 3) };
    this.broadcastAll({ t: 'fx', kind: 'shot', from: { x: b.x, y: oy, z: b.z }, to: end, weapon: 'p92', bot: true });
    if (hit) {
      const dmg = rnd(BOTS.DMG[0], BOTS.DMG[1]) * Math.max(0.5, 1 - d / 70);
      if (target.id.startsWith('P')) {
        this.damage(target, dmg, false, { name: b.name, x: b.x, z: b.z }, b.name);
      } else {
        this.damageBot(target, dmg, false, { name: b.name, kills: 0 }, b.name);
      }
    }
  }

  // ---------- 广播 ----------
  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify(msg)); } catch (e) { /* 忽略 */ }
    }
  }

  broadcastAll(msg, exceptId) {
    for (const p of this.players.values()) {
      if (exceptId && p.id === exceptId) continue;
      this.send(p, msg);
    }
  }

  broadcastExcept(p, msg) {
    for (const q of this.players.values()) {
      if (q !== p) this.send(q, msg);
    }
  }

  // ---------- 快照 ----------
  snapshot() {
    const now = this.now();
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, name: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        yaw: +p.yaw.toFixed(2), pitch: +(p.pitch || 0).toFixed(2),
        st: p.state, w: (p.inv[p.equipped] || {}).id || '', cr: p.crouch ? 1 : 0,
        a: appearanceObj(p.user.appearance),
      });
    }
    const bots = this.bots.filter(b => !b.dead).map(b => ({
      id: b.id, name: b.name, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), yaw: +b.yaw.toFixed(1), st: b.state,
      a: b.a,
    }));
    const live = this.state === 'live';
    const snap = {
      t: 'snap', now,
      live,
      matchT: live ? Math.round(this.matchT * 10) / 10 : 0,
      nextIn: live ? Math.ceil(MATCH_LEN - this.matchT) : 0,
      zone: this.zoneState(),
      extractors: this.extractorState(now),
      players, bots,
    };
    // 各玩家私有部分
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1) {
        const priv = {
          hp: Math.max(0, Math.round(p.hp)),
          armor: p.armor ? Math.ceil(p.armor.dur) : 0,
          exProg: p.extractProg > 0 ? +p.extractProg.toFixed(2) : 0,
          exId: p.extractId,
          alive: p.state === 'ground' || p.state === 'sky',
        };
        try { p.ws.send(JSON.stringify({ ...snap, self: priv })); } catch (e) { /* 忽略 */ }
      }
    }
  }

  lobbyInfo() {
    const alive = [...this.players.values()].filter(p => p.state === 'ground' || p.state === 'sky').length;
    return {
      live: this.state === 'live',
      matchT: this.state === 'live' ? Math.round(this.matchT) : 0,
      matchLen: MATCH_LEN,
      nextIn: this.state === 'live' ? Math.ceil(MATCH_LEN - this.matchT) : 0,
      players: this.players.size,
      alive,
    };
  }
}
