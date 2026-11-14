// ============================================================
// 本地玩家控制器：跳伞 / 地面移动 / 碰撞 / 射击输入 / 交互
// ============================================================
import * as THREE from 'three';
import { terrainHeight } from '/shared/terrain.js';
import { PLAYER, PICKUP_R, WEAPONS, ITEMS, SEARCH } from '/shared/constants.js';
import { sfx } from '/js/audio.js';

const GRAVITY = PLAYER.GRAVITY;

export class PlayerController {
  constructor(net, game, hooks) {
    this.net = net;
    this.game = game;
    this.hooks = hooks;         // {onLootPrompt, onFire, onStateChange, inventory}
    this.state = 'idle';        // idle | plane | sky | ground | dead
    this.pos = { x: 0, y: 0, z: 0 };
    this.vy = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.crouch = false;
    this.keys = {};
    this.firing = false;
    this.lastShotAt = 0;
    this.reloadUntil = 0;
    this.sendTimer = 0;
    this.planeSpeed = 28;
    this.landedSent = false;
    this.jumpAsked = false;
    this.grounded = false;

    this.bindInput();
  }

  setState(s) {
    this.state = s;
    if (s !== 'ground') { this.aiming = false; this.updateAim(); }
    if (this.hooks.onStateChange) this.hooks.onStateChange(s);
  }

  bindInput() {
    const cv = this.game.canvas;
    // 指针锁定（地面/飞机/跳伞全程可锁）
    cv.addEventListener('click', () => {
      if ((this.state === 'ground' || this.state === 'plane' || this.state === 'sky')
          && document.pointerLockElement !== cv) {
        cv.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === cv;
      if (!locked && this.state === 'ground' && this.hooks.onUnlock) this.hooks.onUnlock();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== cv) return;
      this.yaw -= e.movementX * 0.0023;
      this.pitch -= e.movementY * 0.0023;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== cv) return;
      if (e.button === 0) {
        this.firing = true;
        if (this.state === 'ground') this.tryShoot(true);   // 半自动立即开一枪
      }
      if (e.button === 2 && this.state === 'ground' && !this.inspecting) {
        this.aiming = true;
        this.updateAim();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) { this.aiming = false; this.updateAim(); }
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.state === 'ground' || document.pointerLockElement === cv) e.preventDefault();
    });
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      this.keys[k] = true;
      if (this.state === 'plane' && (k === 'Space' || k === 'KeyJ')) this.jumpAsked = true;
      if (this.state === 'ground') {
        if (k === 'KeyC') this.crouch = !this.crouch;
        if (k === 'KeyR') this.doReload();
        if (k === 'KeyE') this.tryInteract();
        if (k === 'Digit1') this.equipSlot(0);
        if (k === 'Digit2') this.equipSlot(1);
        if (k === 'Digit3') this.equipSlot(2);
        if (k === 'Digit4') this.quickUse('bandage');
        if (k === 'Digit5') this.quickUse('medkit');
        if (k === 'Digit6') this.quickUse('energy');
      }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    // 跳伞按钮（触屏友好）
    document.getElementById('btn-jump').addEventListener('click', () => { this.jumpAsked = true; });
  }

  // ---------- 跳伞 ----------
  beginPlane() {
    this.setState('plane');
    this.pos = { x: -620, y: 330, z: -320 };
    this.vy = 0;
    this.yaw = -Math.PI / 2;   // 面向东（机头方向 +x）
    this.pitch = -0.35;
    this.landedSent = false;
    this.jumpAsked = false;
    this.chuteOpen = false;
    this.game.showPlane(true);
    this.game.setChute(false);
  }

  beginSky() {
    this.setState('sky');
    this.vy = -6;
    this.game.showPlane(false);
    this.game.setChute(false);
    sfxWind();
  }

  // ---------- 地面 ----------
  land() {
    this.vy = 0;
    this.setState('ground');
    this.game.setChute(false);
    if (!this.landedSent) {
      this.landedSent = true;
      this.net.send({ t: 'land' });
    }
    this.game.canvas.requestPointerLock();
  }

  // ---------- 主更新 ----------
  update(dt, invState) {
    this.invState = invState;
    switch (this.state) {
      case 'plane': this.updatePlane(dt); break;
      case 'sky': this.updateSky(dt); break;
      case 'ground': this.updateGround(dt); break;
      default: break;
    }
    // 射击（全自动）
    if (this.state === 'ground' && this.firing && invState) {
      const wEntry = this.invState.items[this.invState.equipped];
      if (wEntry && WEAPONS[wEntry.id] && WEAPONS[wEntry.id].auto) this.tryShoot();
    }
    // 位置上报 20Hz
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && (this.state === 'ground' || this.state === 'sky' || this.state === 'plane')) {
      this.sendTimer = 0.05;
      this.net.send({
        t: 'pos', x: this.pos.x, y: this.pos.y, z: this.pos.z,
        yaw: this.yaw, pitch: this.pitch, cr: this.crouch ? 1 : 0,
        sp: this.keys['ShiftLeft'] && this.state === 'ground' ? 1 : 0,
      });
    }
    // 相机
    const eye = this.state === 'ground' ? (this.crouch ? PLAYER.EYE_CROUCH : PLAYER.EYE) : 0.6;
    this.game.camera.position.set(this.pos.x, this.pos.y + eye, this.pos.z);
    this.game.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  updatePlane(dt) {
    this.pos.x += this.planeSpeed * dt;
    if (this.pos.x > 640) { this.pos.x = 640; this.jumpAsked = true; }  // 飞出边界自动跳伞
    // 飞机模型在玩家后下方偏移，避免穿模挡住镜头
    this.game.setPlanePos(this.pos.x - 7, this.pos.y - 3.5, this.pos.z + 7);
    if (this.jumpAsked) this.beginSky();
  }

  updateSky(dt) {
    // 前后键控制俯冲/减速
    const th = terrainHeight(this.pos.x, this.pos.z);
    const alt = this.pos.y - Math.max(th, 0);
    const diving = this.keys['KeyW'] || (this.pitch < -0.5);
    const slow = this.keys['KeyS'];
    let targetVy = diving ? -46 : -26;
    if (slow) targetVy = -14;
    if (alt < 130) {
      if (!this.chuteOpen) {
        this.chuteOpen = true;
        this.game.setChute(true);
        this.hooks.onToast && this.hooks.onToast('降落伞已展开', 'good');
      }
      targetVy = -7.5;
    }
    this.vy += (targetVy - this.vy) * Math.min(1, dt * 3);
    this.pos.y += this.vy * dt;

    // 空中方向控制（与地面一致的朝向基向量）
    const speed = this.chuteOpen ? 9.5 : 21;
    let mx = 0, mz = 0;
    if (this.keys['KeyW']) mz -= 1;
    if (this.keys['KeyS']) mz += 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    if (this.touchMove) { mx += this.touchMove.x; mz += this.touchMove.z; }
    if (mx || mz) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const fx = -sin, fz = -cos, rx = cos, rz = -sin;
      let vx = fx * -mz + rx * mx;
      let vz = fz * -mz + rz * mx;
      const l = Math.hypot(vx, vz);
      this.pos.x += (vx / l) * speed * dt;
      this.pos.z += (vz / l) * speed * dt;
    }
    // 边界
    this.pos.x = Math.max(-580, Math.min(580, this.pos.x));
    this.pos.z = Math.max(-580, Math.min(580, this.pos.z));

    if (this.pos.y <= Math.max(th, 0) + 0.2) {
      // 水面或地面着陆（深水=游泳，浮在海面）
      this.pos.y = Math.max(th, 0);
      this.chuteOpen = false;
      this.land();
    }
  }

  updateGround(dt) {
    const deep = terrainHeight(this.pos.x, this.pos.z) < -1.4;   // 深水=游泳
    const wantSprint = this.keys['ShiftLeft'] || this.touchSprint;
    let base = wantSprint && !this.crouch ? PLAYER.SPRINT
      : this.crouch ? PLAYER.CROUCH : PLAYER.WALK;
    if (deep) base *= 0.5;    // 游泳减速
    const sp = base;
    let mx = 0, mz = 0;
    if (this.keys['KeyW']) mz -= 1;
    if (this.keys['KeyS']) mz += 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    // 触屏虚拟摇杆输入（模拟量）
    if (this.touchMove) { mx += this.touchMove.x; mz += this.touchMove.z; }
    let vx = 0, vz = 0;
    if (mx || mz) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // 相机朝向的前方向 (Three.js: yaw=0 面向 -z)
      const fx = -sin, fz = -cos;
      const rx = cos, rz = -sin;
      vx = fx * -mz + rx * mx;
      vz = fz * -mz + rz * mx;
      const l = Math.hypot(vx, vz);
      if (l > 1) { vx = vx / l * sp; vz = vz / l * sp; }
      else { vx = vx * sp; vz = vz * sp; }   // 摇杆半程=走路
    }

    let nx = this.pos.x + vx * dt;
    let nz = this.pos.z + vz * dt;
    // 碰撞：墙
    const res = this.resolveCollision(nx, nz);
    nx = res.x; nz = res.z;

    // 垂直：重力 + 地形（深水浮在水面 = 游泳）
    const th = terrainHeight(nx, nz);
    let floor = th < -1.4 ? 0 : th;
    // 多层建筑：找脚下最高的可站楼层（允许 0.65m 上台阶）
    for (const f of (this.game.floors || [])) {
      if (nx >= f.x0 - 0.25 && nx <= f.x1 + 0.25 && nz >= f.z0 - 0.25 && nz <= f.z1 + 0.25) {
        if (f.y > floor && f.y <= this.pos.y + 0.65) floor = f.y;
      }
    }
    if (this.keys['Space'] && this.grounded && !deep) {
      this.vy = PLAYER.JUMP_V;
      this.grounded = false;
    }
    this.vy -= GRAVITY * dt;
    let ny = this.pos.y + this.vy * dt;
    if (ny <= floor) {
      ny = floor;
      this.vy = 0;
      this.grounded = true;
    } else if (this.grounded && ny > floor + 0.35) {
      // 下坡贴地
      this.grounded = false;
    }
    this.pos.x = nx; this.pos.z = nz; this.pos.y = ny;
  }

  resolveCollision(nx, nz) {
    const r = PLAYER.RADIUS;
    const feet = this.pos.y;
    const head = feet + (this.crouch ? 1.1 : 1.75);
    for (const w of this.game.walls) {
      if (w.y1 < feet + 0.35 || w.y0 > head) continue;   // 可跨过/可从下方通过
      const cx = Math.max(w.x0, Math.min(nx, w.x1));
      const cz = Math.max(w.z0, Math.min(nz, w.z1));
      const dx = nx - cx, dz = nz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = cx + (dx / d) * r;
          nz = cz + (dz / d) * r;
        } else {
          // 在盒子内部：沿最小穿透轴推出
          const pushL = nx - w.x0 + r, pushR = w.x1 - nx + r;
          const pushN = nz - w.z0 + r, pushS = w.z1 - nz + r;
          const m = Math.min(pushL, pushR, pushN, pushS);
          if (m === pushL) nx = w.x0 - r;
          else if (m === pushR) nx = w.x1 + r;
          else if (m === pushN) nz = w.z0 - r;
          else nz = w.z1 + r;
        }
      }
    }
    // 人物间软碰撞：不穿过其他玩家与 AI
    const pushChar = (cx, cz, rr) => {
      const dx = nx - cx, dz = nz - cz;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < rr) {
        nx = cx + (dx / d) * rr;
        nz = cz + (dz / d) * rr;
      }
    };
    for (const rc of this.game.remotes.values()) pushChar(rc.group.position.x, rc.group.position.z, 0.85);
    for (const rc of this.game.botMeshes.values()) pushChar(rc.group.position.x, rc.group.position.z, 0.85);
    // 边界
    nx = Math.max(-590, Math.min(590, nx));
    nz = Math.max(-590, Math.min(590, nz));
    return { x: nx, z: nz };
  }

  // ---------- 射击 ----------
  weaponId() {
    if (!this.invState) return null;
    const e = this.invState.items[this.invState.equipped];
    return e ? e.id : null;
  }

  tryShoot(force = false) {
    if (this.state !== 'ground') return;
    if (this.inspecting) return;   // 检视时不允许开火（左键=放下）
    const wId = this.weaponId();
    if (!wId || !WEAPONS[wId]) return;
    const w = WEAPONS[wId];
    const now = performance.now();
    if (now < this.reloadUntil) return;
    const interval = 1000 / w.rate;
    if (!force && now - this.lastShotAt < interval) return;
    const entry = this.invState.items[this.invState.equipped];
    if (w.type === 'gun' && entry.mag <= 0) {
      this.doReload();
      return;
    }
    this.lastShotAt = now;

    // 方向 + 散布
    const v = this.game.camera.getWorldDirection(new THREE.Vector3());
    const aimMul = this.aiming ? (w.id === 'lr' ? 0.12 : 0.4) : 1;
    const spread = w.spread * (this.keys['ShiftLeft'] ? 1.7 : this.crouch ? 0.7 : 1) * aimMul;
    const up = Math.abs(v.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const t1 = new THREE.Vector3().crossVectors(v, up).normalize();
    const t2 = new THREE.Vector3().crossVectors(v, t1).normalize();
    const a1 = (Math.random() - 0.5) * 2 * spread;
    const a2 = (Math.random() - 0.5) * 2 * spread;
    v.add(t1.multiplyScalar(a1)).add(t2.multiplyScalar(a2)).normalize();
    const dir2 = v;

    this.net.send({ t: 'shoot', dir: { x: dir2.x, y: dir2.y, z: dir2.z } });
    this.game.muzzle();
    sfx.shot(wId, true);
    this.hooks.onFire && this.hooks.onFire(wId);
    // 本地弹道终点（纯视觉）
    const origin = this.game.camera.position;
    const end = this.localRayEnd(origin, dir2, w.range);
    this.game.addTracer({ x: origin.x, y: origin.y - 0.15, z: origin.z }, end);
  }

  localRayEnd(origin, dir, maxDist) {
    // 与服务端一致的快速射线（墙 + 地形）
    let best = maxDist;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    for (const w of this.game.walls) {
      let tmin = 0, tmax = Infinity;
      const p = [ox, oy, oz], d = [dir.x, dir.y, dir.z];
      const bmin = [w.x0, w.y0, w.z0], bmax = [w.x1, w.y1, w.z1];
      let hit = true;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (p[i] < bmin[i] || p[i] > bmax[i]) { hit = false; break; } }
        else {
          let t1 = (bmin[i] - p[i]) / d[i], t2 = (bmax[i] - p[i]) / d[i];
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) { hit = false; break; }
        }
      }
      if (hit && tmin < best) best = tmin;
    }
    for (let t = 2; t < best; t += 4) {
      if (terrainHeight(ox + dir.x * t, oz + dir.z * t) > oy + dir.y * t) { best = t; break; }
    }
    return { x: ox + dir.x * best, y: oy + dir.y * best, z: oz + dir.z * best };
  }

  doReload() {
    if (this.state !== 'ground') return;
    const wId = this.weaponId();
    if (!wId || !WEAPONS[wId] || WEAPONS[wId].type !== 'gun') return;
    const entry = this.invState.items[this.invState.equipped];
    if (entry.mag >= WEAPONS[wId].mag) return;
    const hasAmmo = this.invState.items.some(e => e.id === WEAPONS[wId].ammo && e.qty > 0);
    if (!hasAmmo) { this.hooks.onToast && this.hooks.onToast('没有对应弹药', 'bad'); return; }
    this.net.send({ t: 'reload' });
  }

  equipSlot(n) {
    // 第 n 把武器（按背包顺序）
    if (!this.invState) return;
    const weapons = this.invState.items.map((e, i) => (WEAPONS[e.id] ? i : -1)).filter(i => i >= 0);
    if (weapons[n] !== undefined) this.net.send({ t: 'equip', idx: weapons[n] });
  }

  quickUse(itemId) {
    if (!this.invState) return;
    const idx = this.invState.items.findIndex(e => e.id === itemId);
    if (idx >= 0) this.net.send({ t: 'use', slot: idx });
    else this.hooks.onToast && this.hooks.onToast('没有' + (ITEMS[itemId] || {}).name, 'bad');
  }

  // 瞄准视觉（FOV 变焦 + 枪位上移 + 界面提示），由主循环调用
  updateAim() {
    const wId = this.weaponId();
    const w = wId && WEAPONS[wId];
    this.hooks.onAim && this.hooks.onAim({
      aiming: this.aiming && this.state === 'ground',
      weapon: wId,
      kind: w ? w.id : null,
    });
  }

  // ---------- 拾取 ----------
  setLootIndex(lootData) {
    this.lootData = lootData;   // Map lootId -> entity
  }

  nearestLoot() {
    if (!this.lootData || this.state !== 'ground') return null;
    let best = null, bestD = PICKUP_R + 1.2;
    for (const e of this.lootData.values()) {
      const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z);
      if (d < bestD && Math.abs(e.y - this.pos.y) < 4) { best = e; bestD = d; }
    }
    return best;
  }

  tryLoot() {
    const e = this.nearestLoot();
    if (e) this.net.send({ t: 'loot', id: e.id });
  }

  // ---------- 搜刮交互（E 键分流） ----------
  nearestSafe() {
    if (this.state !== 'ground' || !this.game.world.furniture) return null;
    let best = null, bestD = 3.0;
    for (const f of this.game.world.furniture) {
      if (f.kind !== 'safe' || this.game.openSafes.has(f.id)) continue;
      const d = Math.hypot(f.x - this.pos.x, f.z - this.pos.z);
      if (d < bestD) { best = f; bestD = d; }
    }
    return best;
  }

  tryInteract() {
    if (this.state !== 'ground') return;
    if (this.action) return;   // 已在搜刮
    const e = this.nearestLoot();
    const safe = this.nearestSafe();
    if (e && (!safe || Math.hypot(e.x - this.pos.x, e.z - this.pos.z) <= Math.hypot(safe.x - this.pos.x, safe.z - this.pos.z))) {
      if (e.container && SEARCH[e.container]) {
        // 家具上的道具：搜刮
        const dur = SEARCH[e.container].dur;
        this.action = { until: performance.now() + dur * 1000, dur, label: `搜刮${SEARCH[e.container].name}…`, x: this.pos.x, z: this.pos.z };
        this.net.send({ t: 'search', id: e.id });
        sfx.click();
      } else {
        this.tryLoot();   // 地面物资秒捡
      }
      return;
    }
    if (safe) {
      const dur = SEARCH.safe.dur;
      this.action = { until: performance.now() + dur * 1000, dur, label: '撬开保险柜…', x: this.pos.x, z: this.pos.z };
      this.net.send({ t: 'search', id: safe.id, safe: true });
      sfx.click();
    }
  }

  // 主循环调用：搜刮进度条 + 移动打断
  tickAction() {
    const a = this.action;
    if (!a) return null;
    if (this.state !== 'ground' || Math.hypot(this.pos.x - a.x, this.pos.z - a.z) > 2.2) {
      this.action = null;
      return null;
    }
    const remain = a.until - performance.now();
    if (remain <= 0) { this.action = null; return null; }
    return { label: a.label, prog: 1 - remain / (a.dur * 1000) };
  }
}

function sfxWind() {
  // 高空风声
  try { window.__sfx && window.__sfx.wind(); } catch (e) { /* 忽略 */ }
}
