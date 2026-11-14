// ============================================================
// UI：HUD / 背包 / 小地图 / 大地图 / 大厅 / 结算界面
// ============================================================
import { ITEMS, WEAPONS, EXTRACTORS, MAP, POIS, PLAYER } from '/shared/constants.js';
import { APPEARANCE } from '/shared/appearance.js';

const ICONS = {
  p92: '🔫', smg: '💥', ak: '🔫', lr: '🎯', knife: '🔪',
  a9: '🟡', a762: '🟠', a338: '🔴',
  bandage: '🩹', medkit: '💊', energy: '🥤',
  apple: '🍎', water: '💧', canned: '🥫', cup: '🥛', cigs: '🚬',
  battery: '🔋', blanket: '🧸', flashlight: '🔦', radio: '📻',
  toolbox: '🧰', milkfrog: '🐸', pillow: '🛏️',
  armor1: '🛡️', armor2: '🛡️', armor3: '🛡️',
  helm1: '⛑️', helm2: '⛑️', helm3: '⛑️',
  pack1: '🎒', pack2: '🎒',
  gold: '🪙', watch: '⌚', gpu: '💡', relic: '🔮',
};

function itemIcon(id) {
  return ICONS[id] || '📦';
}

function itemIconColor(id) {
  if (WEAPONS[id]) return '#2b2f36';
  const def = ITEMS[id];
  if (!def) return '#31435c';
  switch (def.kind) {
    case 'ammo': return '#3a3a20';
    case 'med': case 'food': return '#2a3a2a';
    case 'armor': case 'helmet': return '#2a3a4a';
    case 'pack': return '#3a2a4a';
    case 'loot': return '#3a3a20';
    default: return '#31435c';
  }
}

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(game) {
    this.game = game;
    this.selfId = null;
    this.invState = null;
    this.selectedSlot = -1;
    this.toastSeq = 0;
    this.cache = {
      hud: $('hud'), hpFill: $('hp-fill'), armorFill: $('armor-fill'),
      weaponName: $('weapon-name'), ammo: $('ammo'), buffTags: $('buff-tags'),
      zoneBanner: $('zone-banner'), matchClock: $('match-clock'),
      extractList: $('extract-list'), killfeed: $('killfeed'),
      hitmarker: $('hitmarker'), vignette: $('vignette'), stormHint: $('storm-hint'),
      interact: $('interact-prompt'), castWrap: $('cast-wrap'), castLabel: $('cast-label'),
      castFill: $('cast-fill'), extractProg: $('extract-progress'), extractFill: $('extract-fill'),
      toasts: $('toasts'), minimap: $('minimap'), bigmap: $('bigmap'),
      invPanel: $('inv-panel'), invGrid: $('inv-grid'), invCap: $('inv-cap'),
      invEquipRow: $('inv-equip-row'), invUse: $('inv-use'), invDrop: $('inv-drop'),
      resume: $('resume-overlay'), wait: $('wait-overlay'), waitCount: $('wait-count'),
      death: $('screen-death'), deathBy: $('death-by'), deathLost: $('death-lost'),
      extract: $('screen-extract'), extractCash: $('extract-cash'), extractDetail: $('extract-detail'),
      skydiveHint: $('skydive-hint'), btnJump: $('btn-jump'),
      mapOverlay: $('map-overlay'),
    };
    this.hurtT = 0;
    this.hitT = 0;
    this.extractorStates = [];
    this.lastZone = null;
    this.mapOpen = false;

    // 背包操作按钮
    this.cache.invUse.addEventListener('click', () => {
      if (this.onUseSlot) this.onUseSlot(this.selectedSlot);
    });
    this.cache.invDrop.addEventListener('click', () => {
      if (this.onDropSlot) this.onDropSlot(this.selectedSlot);
    });
    this.cache.invInspect = $('inv-inspect');
    this.cache.invInspect.addEventListener('click', () => {
      if (this.onInspect) this.onInspect(this.selectedSlot);
    });
  }

  setSelfId(id) { this.selfId = id; }

  // ---------- 屏幕切换 ----------
  show(screen) {
    for (const s of ['screen-auth', 'screen-lobby', 'game-root']) {
      $(s).classList.toggle('hidden', s !== screen);
    }
  }

  // ---------- 大厅 ----------
  renderLobby(user) {
    this.selfName = user.name;
    $('lobby-name').textContent = user.name;
    $('lobby-cash').textContent = '¥' + user.cash;
    const stats = user.stats || {};
    $('my-stats-line').textContent =
      `战绩：出击 ${stats.matches || 0} 次 · 撤离 ${stats.extracts || 0} 次 · 击杀 ${stats.kills || 0} · 最高单局 ¥${stats.bestValue || 0}`;
  }

  renderAppearance(user) {
    const box = $('apv-slots');
    if (!box) return;
    const a = user.appearance || { h: 0, f: 0, u: 0, l: 0, s: 0, c1: '#e8e8e8', c2: '#4a5568', c3: '#d8b28f' };
    const slots = [['head', '头部', a.h], ['face', '面部', a.f], ['upper', '上身', a.u], ['lower', '下身', a.l], ['shoes', '鞋子', a.s]];
    box.innerHTML = '';
    for (const [key, label, idx] of slots) {
      const options = APPEARANCE[key];
      const slotEl = document.createElement('div');
      slotEl.className = 'apv-slot';
      slotEl.innerHTML = `<div class="apv-label">${label}</div>`;
      const chips = document.createElement('div');
      chips.className = 'apv-chips';
      options.forEach((opt, i) => {
        const chip = document.createElement('button');
        chip.className = 'apv-chip' + (i === idx ? ' active' : '');
        chip.textContent = opt.name;
        chip.addEventListener('click', () => { if (this.onAppearanceChange) this.onAppearanceChange(key, i); });
        chips.appendChild(chip);
      });
      slotEl.appendChild(chips);
      box.appendChild(slotEl);
    }
    // 颜色通道
    for (const [id, key] of [['apv-c1', 'c1'], ['apv-c2', 'c2'], ['apv-c3', 'c3']]) {
      const input = $(id);
      if (!input) continue;
      input.value = a[key] || '#ffffff';
      input.onchange = () => { if (this.onColorChange) this.onColorChange(key, input.value); };
    }
  }

  renderShop(shop, user) {
    const list = $('shop-list');
    if (!list) return;
    list.innerHTML = '';
    for (const item of shop) {
      const row = document.createElement('div');
      row.className = 'item-row';
      const afford = user.cash >= item.price;
      row.innerHTML =
        `<span class="i-name">${item.name}</span>` +
        `<span class="i-price">¥${item.price}</span>`;
      const btn = document.createElement('button');
      btn.className = 'buy';
      btn.textContent = '购买';
      btn.disabled = !afford;
      btn.addEventListener('click', () => { if (this.onBuyItem) this.onBuyItem(item.id); });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  renderBackpack(user) {
    const lo = $('loadout-list');
    const st = $('stash-list');
    if (!lo || !st) return;
    lo.innerHTML = '';
    const loadout = user.loadout || [];
    if (!loadout.length) {
      lo.innerHTML = '<div class="loadout-empty">未携带任何物资（初始装备：手枪+弹药+绷带）</div>';
    }
    for (const l of loadout) {
      const def = ITEMS[l.id] || WEAPONS[l.id];
      if (!def) continue;
      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML =
        `<span class="i-name">${def.name}${WEAPONS[l.id] ? ' 🔫' : ''}</span>` +
        `<span class="i-qty">×${l.qty}</span>`;
      if (!WEAPONS[l.id]) {
        const minus = document.createElement('button');
        minus.className = 'mini';
        minus.textContent = '−';
        minus.addEventListener('click', () => { if (this.onLoadoutQty) this.onLoadoutQty(l.id, -1); });
        row.appendChild(minus);
        const plus = document.createElement('button');
        plus.className = 'mini';
        plus.textContent = '＋';
        plus.addEventListener('click', () => { if (this.onLoadoutQty) this.onLoadoutQty(l.id, +1); });
        row.appendChild(plus);
      }
      const rm = document.createElement('button');
      rm.className = 'mini';
      rm.textContent = '移除';
      rm.addEventListener('click', () => { if (this.onLoadoutRemove) this.onLoadoutRemove(l.id); });
      row.appendChild(rm);
      lo.appendChild(row);
    }
    st.innerHTML = '';
    const stash = user.stash || [];
    if (!stash.length) {
      st.innerHTML = '<div class="stash-empty">仓库空空如也，去岛上搜刮或到商店采购！</div>';
      return;
    }
    for (const s of stash) {
      const def = ITEMS[s.id] || WEAPONS[s.id];
      if (!def) continue;
      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML =
        `<span class="i-name">${def.name}</span>` +
        `<span class="i-qty">×${s.qty}</span>` +
        `<span class="i-price">¥${def.value}</span>`;
      const bring = document.createElement('button');
      bring.textContent = '携带';
      bring.addEventListener('click', () => { if (this.onLoadoutAdd) this.onLoadoutAdd(s.id); });
      row.appendChild(bring);
      const sell = document.createElement('button');
      sell.className = 'sell';
      sell.textContent = '卖1';
      sell.addEventListener('click', () => { if (this.onSellItem) this.onSellItem(s.id, 1); });
      row.appendChild(sell);
      st.appendChild(row);
    }
  }

  renderRooms(rooms) {
    const list = $('room-list');
    if (!list) return;
    list.innerHTML = '';
    if (!rooms.length) {
      list.innerHTML = '<div class="room-empty">暂无房间，点击上方「创建房间」开一把！</div>';
      return;
    }
    for (const room of rooms) {
      const row = document.createElement('div');
      row.className = 'room-row';
      const state = room.live
        ? `交战中 · 剩 ${room.nextIn}s · 岛上 ${room.alive} 人`
        : `等待玩家准备 · ${room.members}/${room.maxPlayers} 人`;
      row.innerHTML =
        `<span class="r-name">${room.name}${room.isDefault ? '<span class="r-badge">公共</span>' : ''}</span>` +
        `<span class="r-lock">${room.hasPass ? '🔒' : ''}</span>` +
        `<span class="r-info">${room.players}/${room.maxPlayers} 人<br>${state}</span>`;
      const btn = document.createElement('button');
      btn.className = 'r-join';
      btn.textContent = room.live ? '已开局' : (room.players >= room.maxPlayers ? '已满' : '加入');
      btn.disabled = room.live || room.players >= room.maxPlayers;
      btn.addEventListener('click', () => { if (this.onJoinRoom) this.onJoinRoom(room); });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  renderIntel() {
    $('intel').innerHTML =
      `撤离点 ×${EXTRACTORS.length}：${EXTRACTORS.map(e => e.name).join('、')}<br>` +
      `每个撤离点周期开启（约 90 秒一轮），站在光圈中 8 秒完成撤离<br>` +
      `军事基地物资最好，保险柜藏有 ≥¥1000 的高级货，AI 拾荒者与玩家的枪口也最多`;
  }

  async renderLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      $('leaderboard').innerHTML = data.top.map((p, i) =>
        `<li><span>${i + 1}. ${p.name}</span><span>¥${p.cash}</span></li>`).join('') ||
        '<li style="border:none;color:#5e7a97">暂无记录</li>';
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 房间等待室 ----------
  showRoomWait(rs) {
    const el = $('room-wait');
    if (!rs) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.renderRoomWait(rs, this.selfName);
  }

  renderRoomWait(rs, selfName) {
    if (!rs) { $('room-wait').classList.add('hidden'); return; }
    const el = $('room-wait');
    const me = rs.members.find(m => m.name === selfName);
    const iAmPlaying = me && (me.st === 'ground' || me.st === 'sky');
    if (iAmPlaying) { el.classList.add('hidden'); return; }   // 对局中不弹等待室
    el.classList.remove('hidden');
    $('rw-name').textContent = `「${rs.roomName}」`;
    if (rs.state === 'waiting') {
      const readyN = rs.members.filter(m => m.ready).length;
      $('rw-state').textContent = `等待室 · ${rs.members.length} 人 · 已准备 ${readyN}/${rs.members.length}`;
    } else {
      $('rw-state').textContent = `对局进行中（已出局的同学在此等待本局结束）`;
    }
    const box = $('rw-members');
    box.innerHTML = '';
    for (const m of rs.members) {
      const row = document.createElement('div');
      row.className = 'rw-member';
      const isMe = m.name === selfName;
      const stTxt = rs.state === 'live'
        ? (m.st === 'ground' || m.st === 'sky' ? '<span class="playing">对局中</span>'
          : '<span class="not-ready">已出局</span>')
        : (m.ready ? '<span class="ready-mark">✓ 已准备</span>' : '<span class="not-ready">未准备</span>');
      row.innerHTML =
        `<span>${m.owner ? '<span class="owner">👑</span>' : ''}${m.name}${isMe ? '（我）' : ''}</span>` +
        `<span>${stTxt}</span>`;
      box.appendChild(row);
    }
    const meM = rs.members.find(m => m.name === selfName);
    const isOwner = meM && rs.creator === selfName;
    const readyBtn = $('rw-ready');
    const startBtn = $('rw-start');
    if (rs.state !== 'waiting') {
      readyBtn.disabled = true;
      startBtn.classList.add('hidden');
      return;
    }
    readyBtn.disabled = !meM;
    readyBtn.textContent = meM && meM.ready ? '取消准备' : '准 备';
    startBtn.classList.toggle('hidden', !isOwner);
    startBtn.disabled = !isOwner || rs.members.some(m => !m.ready);
    startBtn.textContent = '开始游戏';
  }

  // ---------- 瞄准覆盖层 ----------
  updateAimUi(info) {
    const ring = $('aim-ring');
    const scope = $('aim-scope');
    const cross = $('crosshair');
    if (!ring || !scope) return;
    const on = info.aiming && info.kind;
    ring.classList.toggle('hidden', !(on && (info.kind === 'ak' || info.kind === 'smg')));
    scope.classList.toggle('hidden', !(on && info.kind === 'lr'));
    cross.classList.toggle('scope-hidden', !!(on && info.kind === 'lr'));
  }

  // ---------- HUD ----------
  updateHUD(snap) {
    const self = snap.self || {};
    // 血量
    const hp = self.hp ?? 100;
    this.cache.hpFill.style.width = hp + '%';
    this.cache.hpFill.classList.toggle('low', hp <= 30);
    this.cache.armorFill.style.width = Math.min(100, (self.armor || 0) / 1.5) + '%';
    // 武器信息
    if (this.invState) {
      const e = this.invState.items[this.invState.equipped];
      if (e && WEAPONS[e.id]) {
        const w = WEAPONS[e.id];
        this.cache.weaponName.textContent = w.name;
        if (w.type === 'melee') this.cache.ammo.innerHTML = '∞';
        else {
          const reserve = this.invState.items.filter(i => i.id === w.ammo).reduce((s, i) => s + i.qty, 0);
          this.cache.ammo.innerHTML = `${e.mag}<small> / ${reserve}</small>`;
        }
      } else {
        this.cache.weaponName.textContent = '空手';
        this.cache.ammo.innerHTML = '-';
      }
      // 增益
      const tags = [];
      if (this.energyUntil && Date.now() < this.energyUntil) tags.push('<span class="buff-tag">兴奋剂加速</span>');
      this.cache.buffTags.innerHTML = tags.join('');
    }
    // 区域横幅
    const z = snap.zone;
    this.lastZone = z;
    if (!snap.live) {
      this.cache.zoneBanner.textContent = '休整中 · 等待下一局';
    } else if (z.mode === 'wait') {
      const sec = Math.ceil(z.timer);
      this.cache.zoneBanner.textContent = z.phase < 0
        ? `首个缩圈 ${sec}s 后开始` : `缩圈 ${sec}s 后开始`;
    } else if (z.mode === 'shrink') {
      this.cache.zoneBanner.textContent = `⚠ 缩圈进行中 · ${Math.ceil(z.timer)}s`;
    } else {
      this.cache.zoneBanner.textContent = '☠ 最终风暴即将清场';
    }
    const mm = Math.floor(snap.matchT / 60), ss = Math.floor(snap.matchT % 60);
    this.cache.matchClock.textContent = snap.live
      ? `对局 ${mm}:${String(ss).padStart(2, '0')} · 岛上 ${snap.players.filter(p => p.st === 'ground' || p.st === 'sky').length + snap.bots.length} 人`
      : `下一局 ${snap.nextIn}s 后开始`;
    // 撤离点列表
    let html = '';
    for (const ex of snap.extractors) {
      const conf = EXTRACTORS.find(e => e.id === ex.id);
      html += `<div class="extract-item ${ex.open ? 'open' : ''}">${conf.name} <b>${ex.open ? '开启中' : Math.ceil(ex.nextIn) + 's'}</b></div>`;
    }
    this.cache.extractList.innerHTML = html;
    // 撤离进度
    if (self.exProg > 0 && self.exId) {
      this.cache.extractProg.style.display = 'block';
      this.cache.extractFill.style.width = (self.exProg * 100) + '%';
    } else {
      this.cache.extractProg.style.display = 'none';
    }
    // 风暴提示（仅落地后才可能被风暴伤害）
    const outside = snap.live && this.flightState === 'ground' && this.selfPos &&
      (Math.hypot(this.selfPos.x - z.cx, this.selfPos.z - z.cz) > z.r);
    if (outside) {
      this.cache.stormHint.textContent = `⚠ 你在安全区外！正受风暴伤害（-${z.dps}/s）· 距安全区 ${Math.round(Math.hypot(this.selfPos.x - z.cx, this.selfPos.z - z.cz) - z.r)}m`;
      this.cache.vignette.classList.add('storm');
    } else {
      this.cache.stormHint.textContent = '';
      this.cache.vignette.classList.remove('storm');
    }
    this.updateMinimap(snap);
    if (this.mapOpen) this.updateBigmap(snap);
  }

  setSelfPos(p) { this.selfPos = p; }
  setSelfYaw(y) { this.selfYaw = y; }

  setEnergyUntil(t) { this.energyUntil = t; }

  // ---------- 提示 ----------
  toast(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = text;
    this.cache.toasts.appendChild(el);
    setTimeout(() => el.remove(), 2600);
    while (this.cache.toasts.children.length > 4) this.cache.toasts.firstChild.remove();
  }

  killfeed(killer, victim, weapon) {
    const el = document.createElement('div');
    el.className = 'kill-line';
    if (weapon === 'extract') {
      el.innerHTML = `✈ <b class="me">${victim}</b> 已撤离`;
    } else if (weapon === 'storm') {
      el.innerHTML = `🌪 <b>${victim}</b> 被风暴吞噬`;
    } else {
      el.innerHTML = `<b>${killer}</b> 击杀了 <b>${victim}</b>`;
    }
    this.cache.killfeed.appendChild(el);
    setTimeout(() => el.remove(), 6000);
    while (this.cache.killfeed.children.length > 5) this.cache.killfeed.firstChild.remove();
  }

  hitConfirm(killed, head) {
    this.cache.hitmarker.textContent = killed ? '✖' : '✕';
    this.cache.hitmarker.className = killed ? 'kill' : (head ? 'head' : '');
    this.cache.hitmarker.style.opacity = 1;
    this.hitT = 0.18;
  }

  hurtFlash() {
    this.cache.vignette.style.opacity = 0.9;
    this.hurtT = 0.5;
  }

  frame(dt) {
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      if (this.hurtT <= 0) this.cache.vignette.style.opacity = 0;
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.cache.hitmarker.style.opacity = 0;
    }
  }

  interactPrompt(text) {
    if (text) {
      this.cache.interact.textContent = text;
      this.cache.interact.classList.remove('hidden');
    } else {
      this.cache.interact.classList.add('hidden');
    }
  }

  castbar(label, prog) {
    if (label === null) { this.cache.castWrap.style.display = 'none'; return; }
    this.cache.castWrap.style.display = 'block';
    this.cache.castLabel.textContent = label;
    this.cache.castFill.style.width = (prog * 100) + '%';
  }

  // ---------- 背包 ----------
  renderInventory(invState) {
    this.invState = invState;
    const { items, equipped, armor, helmet, packSlots, cap } = invState;
    this.cache.invCap.textContent = `（${items.length}/${cap} 格）`;
    // 装备行
    let equipHtml = '';
    equipHtml += `<span class="equip-chip">护甲：${armor ? `<b>${ITEMS[armor.id].name}</b>（耐久 ${armor.dur}）` : '无'}</span>`;
    equipHtml += `<span class="equip-chip">头盔：${helmet ? `<b>${ITEMS[helmet].name}</b>` : '无'}</span>`;
    equipHtml += `<span class="equip-chip">背包容量：+${packSlots}</span>`;
    this.cache.invEquipRow.innerHTML = equipHtml;
    // 格子
    this.cache.invGrid.innerHTML = '';
    for (let i = 0; i < cap; i++) {
      const e = items[i];
      const cell = document.createElement('div');
      cell.className = 'inv-slot' + (i === this.selectedSlot ? ' selected' : '') + (e && i === equipped ? ' equipped' : '');
      if (e) {
        const def = ITEMS[e.id] || WEAPONS[e.id];
        const isW = !!WEAPONS[e.id];
        cell.innerHTML =
          `<div class="icon" style="background:${itemIconColor(e.id)}; font-size:18px;">${itemIcon(e.id)}</div>` +
          `<div class="name">${def.name}${i === equipped && isW ? ' ⭐' : ''}</div>` +
          (isW && e.mag !== undefined ? `<span class="magtag">弹匣 ${e.mag}</span>` : '') +
          (e.qty > 1 ? `<span class="qty">×${e.qty}</span>` : '');
        cell.addEventListener('click', () => { this.selectedSlot = i; this.renderInventory(invState); });
      }
      this.cache.invGrid.appendChild(cell);
    }
    const sel = items[this.selectedSlot];
    this.cache.invUse.disabled = !sel;
    this.cache.invDrop.disabled = !sel;
    this.cache.invInspect.disabled = !sel;
  }

  // ---------- 地图 ----------
  drawMapBase(ctx, size) {
    if (this.game.islandCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.game.islandCanvas, 0, 0, size, size);
    } else {
      ctx.fillStyle = '#123'; ctx.fillRect(0, 0, size, size);
    }
  }

  updateMinimap(snap) {
    const cv = this.cache.minimap;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.clearRect(0, 0, S, S);
    this.drawMapBase(ctx, S);
    const z = snap.zone;
    if (snap.live && z) {
      // 安全区（白）
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      let [cx, cy] = this.mapXY(z.cx, z.cz, S);
      ctx.beginPath(); ctx.arc(cx, cy, z.r / MAP.SIZE * S, 0, Math.PI * 2); ctx.stroke();
      // 目标圈（橙虚线）
      ctx.strokeStyle = 'rgba(255,170,60,0.9)';
      ctx.setLineDash([4, 3]);
      [cx, cy] = this.mapXY(z.tcx, z.tcz, S);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, z.tr / MAP.SIZE * S), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 撤离点
    for (const ex of EXTRACTORS) {
      const st = (snap.extractors || []).find(e => e.id === ex.id);
      const [x, y] = this.mapXY(ex.x, ex.z, S);
      ctx.fillStyle = st && st.open ? '#44ff88' : '#4466aa';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // 自己
    if (this.selfPos) {
      const [x, y] = this.mapXY(this.selfPos.x, this.selfPos.z, S);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-this.selfYaw || 0);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  mapXY(x, z, size) {
    return [(x / MAP.SIZE + 0.5) * size, (z / MAP.SIZE + 0.5) * size];
  }

  updateBigmap(snap) {
    const cv = this.cache.bigmap;
    const ctx = cv.getContext('2d');
    const S = cv.width;
    ctx.clearRect(0, 0, S, S);
    this.drawMapBase(ctx, S);
    // POI 名称
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = 'rgba(255,233,201,0.95)';
    ctx.textAlign = 'center';
    for (const p of POIS) {
      const [x, y] = this.mapXY(p.x, p.z, S);
      ctx.fillText(p.name, x, y);
    }
    const z = snap.zone;
    if (snap.live && z) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      let [cx, cy] = this.mapXY(z.cx, z.cz, S);
      ctx.beginPath(); ctx.arc(cx, cy, z.r / MAP.SIZE * S, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffaa3c'; ctx.setLineDash([6, 4]);
      [cx, cy] = this.mapXY(z.tcx, z.tcz, S);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, z.tr / MAP.SIZE * S), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const ex of EXTRACTORS) {
      const st = (snap.extractors || []).find(e => e.id === ex.id);
      const [x, y] = this.mapXY(ex.x, ex.z, S);
      ctx.fillStyle = st && st.open ? '#44ff88' : '#4466aa';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.fillText(ex.name + (st && st.open ? '（开启）' : ''), x, y - 10);
    }
    if (this.selfPos) {
      const [x, y] = this.mapXY(this.selfPos.x, this.selfPos.z, S);
      ctx.fillStyle = '#ffe14d';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  toggleMap(force) {
    this.mapOpen = force !== undefined ? force : !this.mapOpen;
    this.cache.mapOverlay.classList.toggle('hidden', !this.mapOpen);
  }

  // ---------- 状态面板 ----------
  setFlightUI(state) {
    this.flightState = state;
    // plane / sky / ground / dead
    this.cache.skydiveHint.classList.toggle('hidden', !(state === 'plane' || state === 'sky'));
    this.cache.btnJump.classList.toggle('hidden', state !== 'plane');
    this.cache.btnJump.classList.toggle('pointer-events', state === 'plane');
  }

  showResume(show) { this.cache.resume.classList.toggle('hidden', !show); }
  showWait(show, count) {
    this.cache.wait.classList.toggle('hidden', !show);
    if (show) this.cache.waitCount.textContent = count + 's';
  }
  showDeath(by, lost) {
    this.cache.death.classList.remove('hidden');
    this.cache.deathBy.innerHTML = `你被 <b>${by}</b> 击倒`;
    this.cache.deathLost.innerHTML = `背包物资全部掉落，损失价值约 <b>¥${lost || 0}</b>`;
  }
  hideDeath() { this.cache.death.classList.add('hidden'); }
  showExtract(cash, items, user) {
    this.cache.extract.classList.remove('hidden');
    this.cache.extractCash.innerHTML = `本次带出 <b>¥${cash}</b> 物资`;
    this.cache.extractDetail.innerHTML = `共 ${items} 件物品已存入仓库 · 总资产 <b>¥${user.cash}</b>`;
  }
  hideExtract() { this.cache.extract.classList.add('hidden'); }
}
