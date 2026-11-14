// ============================================================
// 主控：登录 → 大厅 → 对局 的状态机与消息路由
// ============================================================
import { Net } from '/js/net.js';
import { Game } from '/js/game.js';
import { PlayerController } from '/js/player.js';
import { UI } from '/js/ui.js';
import { InspectController } from '/js/inspect.js';
import { TouchControls } from '/js/touch.js';
import { AvatarPreview } from '/js/avatarPreview.js';
import { sfx } from '/js/audio.js';
import { ITEMS, WEAPONS, SEARCH } from '/shared/constants.js';
import { APPEARANCE } from '/shared/appearance.js';

const $ = (id) => document.getElementById(id);

const app = {
  token: localStorage.getItem('sdc_token') || null,
  user: null,
  net: null,
  game: null,
  player: null,
  ui: null,
  inGame: false,
  lootData: new Map(),
  reloadFx: null,   // {until, dur}
  castFx: null,
  matchInfoPoll: null,
};

// ---------- 启动 ----------
init();

function init() {
  app.ui = new UI(null);
  wireAuth();
  wireLobby();
  wireGameKeys();
  // 已有 token 则直接进大厅
  if (app.token) gotoLobby();
  else app.ui.show('screen-auth');
  requestAnimationFrame(loop);
  // 手动步进驱动器：rAF 被节流时（后台标签/无头环境）可用它推进模拟
  window.__sdcStep = (dt) => {
    if (!app.inGame || !app.game) return;
    app.player.update(dt, app.ui.invState);
    app.ui.frame(dt);
    app.game.frame(dt, app.player.pos);
    if (app.inspect) app.inspect.update(dt);
  };
  // 调试钩子（供自动化测试/排查用，仅客户端状态）
  window.__sdc = app;
}

// ---------- 登录 ----------
let authMode = 'login';

function wireAuth() {
  $('tab-login').addEventListener('click', () => setAuthMode('login'));
  $('tab-register').addEventListener('click', () => setAuthMode('register'));
  $('auth-submit').addEventListener('click', doAuth);
  $('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });
}

function setAuthMode(m) {
  authMode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? '进入游戏' : '注册并进入';
  $('auth-error').textContent = '';
}

async function doAuth() {
  const name = $('auth-name').value.trim();
  const pass = $('auth-pass').value;
  const url = authMode === 'login' ? '/api/login' : '/api/register';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pass }),
    });
    const data = await res.json();
    if (data.err) { $('auth-error').textContent = data.err; return; }
    app.token = data.token;
    localStorage.setItem('sdc_token', data.token);
    sfx.click();
    gotoLobby();
  } catch (e) {
    $('auth-error').textContent = '网络错误，请确认服务器已启动';
  }
}

// ---------- 大厅 ----------
async function gotoLobby() {
  app.inGame = false;
  stopMatchPoll();
  app.ui.show('screen-lobby');
  try {
    const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + app.token } });
    if (res.status === 401) {
      app.token = null;
      localStorage.removeItem('sdc_token');
      app.ui.show('screen-auth');
      return;
    }
    const data = await res.json();
    app.user = data.user;
  } catch (e) {
    $('auth-error').textContent = '无法连接服务器';
    app.ui.show('screen-auth');
    return;
  }
  // 形象预览（懒初始化）+ 捏脸回调
  const saveAppearance = async (a) => {
    const res = await fetch('/api/appearance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + app.token },
      body: JSON.stringify(a),
    });
    const d = await res.json();
    if (d.user) {
      app.user = d.user;
      app.ui.renderAppearance(app.user);
      app.preview.setAppearance(d.user.appearance);
      sfx.click();
    } else if (d.err) app.ui.toast(d.err, 'bad');
  };
  if (!app.preview) {
    app.preview = new AvatarPreview($('apv-canvas'));
    app.ui.onAppearanceChange = async (key, idx) => {
      const a = { ...(app.user.appearance || {}), c1: '#e8e8e8', c2: '#4a5568', c3: '#d8b28f' };
      const idxKey = { head: 'h', face: 'f', upper: 'u', lower: 'l', shoes: 's' }[key];
      a[idxKey] = idx;
      await saveAppearance(a);
    };
    app.ui.onColorChange = async (channel, hex) => {
      const a = { ...(app.user.appearance || {}) };
      a[channel] = hex;
      await saveAppearance(a);
    };
    $('apv-random').addEventListener('click', async () => {
      const { randomAppearance } = await import('/shared/appearance.js');
      await saveAppearance(randomAppearance());
    });
    $('apv-reset').addEventListener('click', async () => {
      const { DEFAULT_APPEARANCE } = await import('/shared/appearance.js');
      await saveAppearance({ ...DEFAULT_APPEARANCE });
    });
  }
  app.preview.running = true;
  app.preview.setAppearance(app.user.appearance || null);
  refreshLobby();
  app.matchInfoPoll = setInterval(refreshLobby, 2000);
  app.ui.renderLeaderboard();
}

function stopMatchPoll() {
  if (app.matchInfoPoll) { clearInterval(app.matchInfoPoll); app.matchInfoPoll = null; }
}

async function refreshLobby() {
  try {
    const [meRes, roomsRes, shopRes] = await Promise.all([
      fetch('/api/me', { headers: { Authorization: 'Bearer ' + app.token } }),
      fetch('/api/rooms'),
      fetch('/api/shop'),
    ]);
    if (meRes.ok) {
      const d = await meRes.json();
      app.user = d.user;
    }
    const roomsData = await roomsRes.json();
    const shopData = await shopRes.json();
    app.ui._shopList = shopData.shop || [];
    app.ui.renderLobby(app.user);
    app.ui.renderRooms(roomsData.rooms || []);
    app.ui.renderShop(app.ui._shopList, app.user);
    app.ui.renderBackpack(app.user);
    app.ui.renderAppearance(app.user);
  } catch (e) { /* 忽略 */ }
}

function wireLobby() {
  $('btn-logout').addEventListener('click', () => {
    app.token = null;
    localStorage.removeItem('sdc_token');
    app.ui.show('screen-auth');
  });
  // ---------- 商店 / 背包 ----------
  const postUser = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + app.token },
      body: JSON.stringify(body || {}),
    });
    const d = await res.json();
    if (d.err) { app.ui.toast(d.err, 'bad'); return null; }
    app.user = d.user;
    app.ui.renderShop(app.ui._shopList || [], app.user);
    app.ui.renderBackpack(app.user);
    sfx.pickup();
    return d;
  };
  app.ui.onBuyItem = (itemId) => postUser('/api/shop/buy', { itemId });
  app.ui.onSellItem = (itemId, qty) => postUser('/api/shop/sell', { itemId, qty });
  app.ui.onLoadoutAdd = async (itemId) => {
    const def = ITEMS[itemId] || WEAPONS[itemId];
    const qty = WEAPONS[itemId] ? 1 : (ITEMS[itemId].kind === 'ammo' ? ITEMS[itemId].qtyPerPack : 1);
    const items = [...(app.user.loadout || []), { id: itemId, qty }];
    const d = await postUser('/api/loadout', { items });
    if (d) app.ui.renderBackpack(app.user);
    else void def;
  };
  app.ui.onLoadoutRemove = async (itemId) => {
    const items = (app.user.loadout || []).filter(l => l.id !== itemId);
    await postUser('/api/loadout', { items });
  };
  app.ui.onLoadoutQty = async (itemId, delta) => {
    const def = ITEMS[itemId];
    const step = def && def.kind === 'ammo' ? def.qtyPerPack : 1;
    const items = (app.user.loadout || []).map(l => l.id === itemId
      ? { ...l, qty: Math.max(step, l.qty + delta * step) } : l);
    await postUser('/api/loadout', { items });
  };
  // 创建房间弹窗
  $('btn-create-room').addEventListener('click', () => {
    $('cr-name').value = '';
    $('cr-pass').value = '';
    $('cr-err').textContent = '';
    $('modal-create').classList.remove('hidden');
  });
  $('cr-cancel').addEventListener('click', () => $('modal-create').classList.add('hidden'));
  $('cr-ok').addEventListener('click', async () => {
    const name = $('cr-name').value.trim();
    const pass = $('cr-pass').value;
    try {
      const res = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + app.token },
        body: JSON.stringify({ name, pass }),
      });
      const d = await res.json();
      if (d.err) { $('cr-err').textContent = d.err; return; }
      $('modal-create').classList.add('hidden');
      sfx.click();
      joinMatch(d.room.id, pass);   // 房主自动进房
    } catch (e) {
      $('cr-err').textContent = '网络错误';
    }
  });
  // 房间密码弹窗
  let pendingRoom = null;
  $('mp-cancel').addEventListener('click', () => $('modal-pass').classList.add('hidden'));
  $('mp-ok').addEventListener('click', () => {
    if (!pendingRoom) return;
    const pass = $('mp-pass').value;
    $('modal-pass').classList.add('hidden');
    joinMatch(pendingRoom.id, pass);
  });
  app.ui.onJoinRoom = (room) => {
    sfx.click();
    if (room.hasPass) {
      pendingRoom = room;
      $('mp-title').textContent = `加入「${room.name}」`;
      $('mp-pass').value = '';
      $('mp-err').textContent = '';
      $('modal-pass').classList.remove('hidden');
      $('mp-pass').focus();
    } else {
      joinMatch(room.id, null);
    }
  };
}

// ---------- 进入对局 ----------
function joinMatch(roomId, roomPass) {
  if (app.preview) app.preview.running = false;
  if (app.net) app.net.close();
  app.net = new Net();
  app.net.onClose = () => {
    if (app.inGame) {
      app.ui.toast('与服务器断开连接', 'bad');
      gotoLobby();
    }
  };
  wireNetHandlers();
  app.net.connect(app.token, app.user && app.user.bring, roomId, roomPass);
  app.ui.toast('正在连接战场…');
}

async function ensureGame() {
  if (!app.game) {
    app.ui.toast('正在加载海岛世界…');
    const game = new Game($('gl'));
    await game.init();
    app.game = game;
    app.ui.game = game;
  }
  if (!app.player) {
    app.player = new PlayerController(app.net, app.game, {
      onStateChange: (s) => {
        app.ui.setFlightUI(s);
        if (s === 'dead' || s === 'idle') {
          document.exitPointerLock && document.exitPointerLock();
        }
        if (app.inspect) app.inspect.exit();   // 换状态时放下手里的道具
      },
      onToast: (t, c) => app.ui.toast(t, c),
      onFire: (wId) => { app.game.setGunSize(wId); app.ui.setSelfYaw && null; },
      onAim: (info) => {
        app.game.handleAim(info);
        app.ui.updateAimUi(info);
      },
      onUnlock: () => {
        // 指针锁解除 = 按了 Esc → 弹设置菜单（对局中任何时候都可以）
        if (app.inGame && !app.ui.mapOpen
            && $('inv-panel').classList.contains('hidden')
            && !(app.inspect && app.inspect.active)
            && !(app.player.state === 'dead' || app.player.state === 'idle')) {
          app.ui.onShowSettings && app.ui.onShowSettings();
          app.ui.showResume(true);
        }
      },
    });
    // 检视控制器
    app.inspect = new InspectController(app.game);
    app.inspect.onExit = () => { app.player.inspecting = false; };
    // 触屏操控（触屏设备自动启用；?touch=1 强制预览）
    app.touch = new TouchControls(app.player);
    // 背包使用/丢弃按钮
    app.ui.onUseSlot = (slot) => {
      if (slot < 0 || !app.net || !app.ui.invState) return;
      const item = app.ui.invState.items[slot];
      if (!item) return;
      if (WEAPONS[item.id]) {
        app.net.send({ t: 'equip', idx: slot });   // 武器 → 切换装备
      } else {
        app.net.send({ t: 'use', slot });           // 其他 → 使用
      }
    };
    app.ui.onDropSlot = (slot) => {
      if (slot < 0 || !app.net) return;
      app.net.send({ t: 'drop', slot });
      app.ui.selectedSlot = -1;
      if (app.ui.invState) setTimeout(() => app.ui.renderInventory(app.ui.invState), 300);
    };
    // 背包检视按钮（仅地面状态可检视）
    app.ui.onInspect = (slot) => {
      if (app.player.state !== 'ground') return;
      const inv = app.ui.invState;
      if (!inv || !inv.items[slot]) return;
      const e = inv.items[slot];
      // 关背包 → 拿在手上（不锁鼠标，可点 ✕ 关闭）
      $('inv-panel').classList.add('hidden');
      app.inspect.enter(e.id, e.qty);
      app.player.inspecting = true;
      app.player.aiming = false;
    };
  } else {
    app.player.net = app.net;
  }
}

function wireNetHandlers() {
  const net = app.net;
  net.on('welcome', (msg) => {
    app.inGame = true;
    stopMatchPoll();
    app.ui.show('game-root');
    app.ui.setSelfId(msg.selfId);
    ensureGame().then(() => {
      app.game.clearMatch();
      // 世界就绪后重建战利品（lootInit 可能早于游戏对象创建到达）
      for (const e of app.lootData.values()) app.game.addLootMesh(e, ITEMS, WEAPONS);
      if (app.player) app.player.setLootIndex(app.lootData);
      // 进入房间等待室（开始游戏后由 matchStart 切换到跳伞）
      app.ui.showRoomWait(app.lastRoomState || { state: 'waiting', roomName: '房间', members: [] });
    });
  });

  net.on('roomState', (msg) => {
    if (!app.inGame) return;
    app.lastRoomState = msg;
    app.ui.renderRoomWait(msg, app.user && app.user.name);
  });

  net.on('matchEnd', (msg) => {
    app.ui.hideDeath();
    app.ui.hideExtract();
    app.ui.showResume(false);
    if (app.lastRoomState) app.ui.renderRoomWait(app.lastRoomState, app.user && app.user.name);
    app.ui.toast(`本局结束（${msg.reason}）`, 'good');
  });

  net.on('matchStart', () => {
    // 世界可能还没加载完（房间快速开局），加载完成后补跳伞
    app.pendingMatchStart = true;
    ensureGame().then(() => {
      if (!app.pendingMatchStart || !app.inGame) return;
      app.pendingMatchStart = false;
      app.game.clearMatch();
      app.ui.hideDeath();
      app.ui.hideExtract();
      app.ui.showRoomWait(null);
      app.ui.showResume(false);
      app.player.beginPlane();
    });
  });

  net.on('snap', (msg) => {
    if (!app.game || !app.inGame) return;
    const others = msg.players.filter(p => p.id !== app.ui.selfId);
    app.game.updateRemotes(others);
    app.game.updateBots(msg.bots);
    app.game.updateZone(msg.zone);
    app.game.updateExtractors(msg.extractors);
    app.ui.setSelfPos(app.player.pos);
    app.ui.setSelfYaw(app.player.yaw);
    app.ui.updateHUD(msg);
  });

  net.on('inv', (msg) => {
    app.ui.renderInventory(msg);
    if (app.player) app.player.invState = msg;
  });

  net.on('invAmmo', (msg) => {
    const inv = app.ui.invState;
    if (inv && inv.items[msg.equipped]) {
      inv.items[msg.equipped].mag = msg.mag;
      if (!$('inv-panel').classList.contains('hidden')) app.ui.renderInventory(inv);
    }
  });

  net.on('lootInit', (msg) => {
    app.lootData = new Map(msg.loot.map(e => [e.id, e]));
    if (app.game) {
      app.game.clearLoot();
      for (const e of msg.loot) app.game.addLootMesh(e, ITEMS, WEAPONS);
      if (msg.openSafes) for (const id of msg.openSafes) app.game.markSafeOpen(id);
    }
    if (app.player) app.player.setLootIndex(app.lootData);
  });

  net.on('lootAdd', (msg) => {
    for (const e of msg.loot) {
      app.lootData.set(e.id, e);
      if (app.game) app.game.addLootMesh(e, ITEMS, WEAPONS);
    }
  });

  net.on('lootDel', (msg) => {
    for (const id of msg.ids) {
      app.lootData.delete(id);
      if (app.game) app.game.delLootMesh(id);
    }
  });

  net.on('fx', (msg) => {
    if (!app.game) return;
    if (msg.kind === 'shot') {
      app.game.addTracer(msg.from, msg.to);
      // 距离衰减枪声
      const d = app.player ? Math.hypot(msg.from.x - app.player.pos.x, msg.from.z - app.player.pos.z) : 999;
      sfx.shot(msg.weapon, d < 45);
    } else if (msg.kind === 'impact') {
      app.game.impact(msg.at);
    }
  });

  net.on('hurt', (msg) => {
    sfx.hurt();
    app.ui.hurtFlash();
    if (msg.dmg > 0) app.ui.toast(`受到 ${msg.dmg} 点伤害`, 'bad');
  });

  net.on('confirm', (msg) => {
    if (msg.killed) { sfx.kill(); }
    else if (msg.head) { sfx.headshot(); }
    else { sfx.hit(); }
    app.ui.hitConfirm(msg.killed, msg.head);
  });

  net.on('kill', (msg) => app.ui.killfeed(msg.killer, msg.victim, msg.weapon));

  net.on('msg', (msg) => {
    app.ui.toast(msg.text, msg.text.includes('撤离') ? 'good' : '');
    sfx.pickup();
  });

  net.on('reloading', (msg) => {
    app.reloadFx = { until: performance.now() + msg.dur * 1000, dur: msg.dur * 1000 };
    if (app.player) app.player.reloadUntil = performance.now() + msg.dur * 1000;
    sfx.reload();
  });

  net.on('casting', (msg) => {
    app.castFx = { until: performance.now() + msg.dur * 1000, dur: msg.dur * 1000, item: msg.item };
  });

  net.on('castDone', (msg) => {
    app.castFx = null;
    app.ui.castbar(null);
    sfx.heal();
    app.ui.toast(`治疗完成（HP ${msg.hp}）`, 'good');
  });

  net.on('landed', () => { /* 已由本地处理 */ });

  net.on('died', (msg) => {
    app.player.setState('dead');
    sfx.death();
    app.ui.showDeath(msg.by, msg.lostValue);
    app.ui.showResume(false);
    document.exitPointerLock && document.exitPointerLock();
  });

  net.on('extracted', (msg) => {
    sfx.extract();
    app.ui.showExtract(msg.cash, msg.items, msg.user);
    app.player.setState('idle');
    document.exitPointerLock && document.exitPointerLock();
  });

  net.on('safeOpen', (msg) => {
    if (app.game) app.game.markSafeOpen(msg.id);
    sfx.reload();
  });

  net.on('err', (msg) => {
    app.ui.toast(msg.text, 'bad');
    app.net.close();
    gotoLobby();
  });
}

// ---------- 背包按钮 / 大地图 / 暂停 ----------
function wireGameKeys() {
  // 检视时点左键 = 放下道具（并顺带开枪）
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && app.inspect && app.inspect.active) {
      app.inspect.exit();
      app.player.inspecting = false;
    }
  });
  // I 键：检视当前手持武器
  document.addEventListener('keydown', (e) => {
    if (!app.inGame || e.repeat) return;
    if (e.code === 'KeyI' && app.player.state === 'ground'
        && $('inv-panel').classList.contains('hidden')) {      if (app.inspect && app.inspect.active) { app.inspect.exit(); app.player.inspecting = false; return; }
      const inv = app.ui.invState;
      if (inv && inv.items[inv.equipped]) {
        const w = inv.items[inv.equipped];
        app.inspect.enter(w.id, w.qty);
        app.player.inspecting = true;
      }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!app.inGame) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      const panel = $('inv-panel');
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !opening);
      if (opening) {
        document.exitPointerLock && document.exitPointerLock();
        app.ui.showResume(false);
        if (app.ui.invState) app.ui.renderInventory(app.ui.invState);
      } else if (app.player.state === 'ground') {
        $('gl').requestPointerLock();
      }
    }
    if (e.code === 'KeyM') {
      app.ui.toggleMap();
      if (app.ui.mapOpen) document.exitPointerLock && document.exitPointerLock();
    }
    if (e.code === 'KeyX') {
      // X 键：关闭背包 / 检视 / 地图（Esc 由 pointerlockchange 处理弹设置菜单）
      if (!$('inv-panel').classList.contains('hidden')) {
        $('inv-panel').classList.add('hidden');
        if (app.player.state === 'ground') $('gl').requestPointerLock();
      }
      if (app.inspect && app.inspect.active) {
        app.inspect.exit();
        app.player.inspecting = false;
      }
      if (app.ui.mapOpen) app.ui.toggleMap(false);
    }
  });

  // ---- 设置菜单（Esc 弹出）----
  const applySettings = () => {
    const names = localStorage.getItem('sdc_names') !== '0';
    const vol = parseInt(localStorage.getItem('sdc_volume') || '70', 10);
    if (app.game) app.game.setNamesVisible(names);
    sfx.setVolume(vol / 100);
    const cb = $('set-names');
    if (cb) cb.checked = names;
    const sl = $('set-volume');
    if (sl) { sl.value = vol; $('set-volume-num').textContent = vol; }
  };
  $('set-names').addEventListener('change', (e) => {
    localStorage.setItem('sdc_names', e.target.checked ? '1' : '0');
    if (app.game) app.game.setNamesVisible(e.target.checked);
  });
  $('set-volume').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    $('set-volume-num').textContent = v;
    sfx.setVolume(v / 100);
    localStorage.setItem('sdc_volume', String(v));
  });
  app.ui.onShowSettings = applySettings;
  $('btn-resume').addEventListener('click', () => {
    app.ui.showResume(false);
    $('gl').requestPointerLock();
  });

  const backToLobby = () => {
    if (app.net) app.net.close();
    app.inGame = false;
    app.ui.hideDeath();
    app.ui.hideExtract();
    app.ui.showRoomWait(null);
    app.ui.showResume(false);
    app.player && app.player.setState('idle');
    gotoLobby();
  };

  // 死亡/撤离结算 → 回到房间等待室（连接保持，等待下一局）
  const backToRoom = () => {
    app.ui.hideDeath();
    app.ui.hideExtract();
    app.ui.showResume(false);
    app.player.setState('idle');
    if (app.lastRoomState) app.ui.renderRoomWait(app.lastRoomState, app.user && app.user.name);
    else app.ui.showRoomWait({ state: 'waiting', roomName: '房间', members: [] });
  };

  $('btn-quit-match').addEventListener('click', backToLobby);
  $('btn-death-lobby').addEventListener('click', backToLobby);
  $('btn-extract-lobby').addEventListener('click', backToLobby);
  $('btn-death-room').addEventListener('click', backToRoom);
  $('btn-extract-room').addEventListener('click', backToRoom);

  // 房间等待室按钮
  $('rw-ready').addEventListener('click', () => { if (app.net) app.net.send({ t: 'roomReady' }); });
  $('rw-start').addEventListener('click', () => { if (app.net) app.net.send({ t: 'roomStart' }); });
  $('rw-leave').addEventListener('click', () => {
    if (app.net) app.net.send({ t: 'roomLeave' });
    backToLobby();
  });
}

// ---------- 主循环 ----------
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (!app.inGame || !app.game) return;

  app.player.update(dt, app.ui.invState);
  app.ui.frame(dt);
  app.game.frame(dt, app.player.pos);
  if (app.inspect) app.inspect.update(dt);

  // 拾取/搜刮提示
  const near = app.player.nearestLoot();
  const safe = app.player.state === 'ground' ? app.player.nearestSafe() : null;
  let prompt = null;
  const nearD = near ? Math.hypot(near.x - app.player.pos.x, near.z - app.player.pos.z) : 1e9;
  const safeD = safe ? Math.hypot(safe.x - app.player.pos.x, safe.z - app.player.pos.z) : 1e9;
  if (near && nearD <= safeD) {
    const def = ITEMS[near.item] || WEAPONS[near.item];
    if (near.container && SEARCH[near.container]) {
      prompt = `[E] 搜刮${SEARCH[near.container].name} · ${def ? def.name : ''}${near.qty > 1 ? ' ×' + near.qty : ''}`;
    } else {
      prompt = `[E] 拾取 ${def ? def.name : near.item}${near.qty > 1 ? ' ×' + near.qty : ''}`;
    }
  } else if (safe) {
    prompt = `[E] 撬开保险柜（${SEARCH.safe.dur} 秒）`;
  }
  app.ui.interactPrompt(prompt);

  // 换弹/使用/搜刮进度条
  const searchFx = app.player.tickAction();
  if (searchFx) {
    app.ui.castbar(searchFx.label, searchFx.prog);
  } else if (app.reloadFx && now < app.reloadFx.until) {
    app.ui.castbar('换弹中…', 1 - (app.reloadFx.until - now) / app.reloadFx.dur);
  } else if (app.castFx && now < app.castFx.until) {
    const def = ITEMS[app.castFx.item];
    app.ui.castbar(`使用 ${def ? def.name : ''}…`, 1 - (app.castFx.until - now) / app.castFx.dur);
  } else {
    if (app.reloadFx) app.reloadFx = null;
    if (!app.castFx) app.ui.castbar(null);
  }
}
