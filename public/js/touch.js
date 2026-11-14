// ============================================================
// 触屏操控：虚拟摇杆 + 拖动视角 + 功能按钮
// 自动启用：触屏设备 / 竖屏 / URL ?touch=1
// ============================================================
import { WEAPONS } from '/shared/constants.js';

export class TouchControls {
  constructor(player) {
    this.player = player;
    this.enabled = false;
    this.joyId = null;      // 摇杆触点 id
    this.lookId = null;     // 视角触点 id
    this.joyCenter = { x: 0, y: 0 };
    this.buildDom();
    this.detect();
  }

  detect() {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const forced = location.search.includes('touch=1') || window.__sdcForceTouch;
    if (coarse || (hasTouch && innerWidth < 900) || forced) this.enable();
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch-on');
    document.getElementById('touch-layer').classList.remove('hidden');
    this.bind();
  }

  buildDom() {
    if (document.getElementById('joy-base')) return;
    const layer = document.getElementById('touch-layer');
    layer.innerHTML = `
      <div id="joy-base"><div id="joy-knob"></div></div>
      <div id="touch-buttons">
        <button class="tbtn big" data-act="fire">🔥</button>
        <button class="tbtn" data-act="interact">拾</button>
        <button class="tbtn" data-act="jump">跳</button>
        <button class="tbtn" data-act="crouch">蹲</button>
        <button class="tbtn" data-act="sprint">跑</button>
        <button class="tbtn" data-act="reload">换</button>
        <button class="tbtn" data-act="swap">枪</button>
        <button class="tbtn" data-act="inv">包</button>
        <button class="tbtn" data-act="map">图</button>
      </div>`;
    this.joyBase = document.getElementById('joy-base');
    this.joyKnob = document.getElementById('joy-knob');
  }

  bind() {
    const JOY_R = 52;

    const isUiTarget = (t) => t && t.closest &&
      t.closest('button, .tbtn, #inv-panel, #inspect-panel, #map-overlay, #resume-overlay, #wait-overlay, .result-screen, #screen-death, #screen-extract');

    // —— 摇杆 / 视角（绑在 document 上，UI 元素自动放行）——
    document.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' && !window.__sdcForceTouch) return;
      if (isUiTarget(e.target)) return;
      const x = e.clientX, y = e.clientY;
      if (this.joyId === null && x < innerWidth * 0.45 && y > innerHeight * 0.35) {
        // 左下区：虚拟摇杆（浮动手位）
        this.joyId = e.pointerId;
        this.joyCenter = { x, y };
        this.joyBase.style.left = (x - 60) + 'px';
        this.joyBase.style.top = (y - 60) + 'px';
        this.joyBase.classList.add('active');
        this.setKnob(0, 0);
      } else if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.lastLook = { x, y };
      }
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerId === this.joyId) {
        let dx = e.clientX - this.joyCenter.x;
        let dy = e.clientY - this.joyCenter.y;
        const len = Math.hypot(dx, dy);
        if (len > JOY_R) { dx = dx / len * JOY_R; dy = dy / len * JOY_R; }
        this.setKnob(dx, dy);
        this.player.touchMove = { x: dx / JOY_R, z: dy / JOY_R };
      } else if (e.pointerId === this.lookId && this.lastLook) {
        const dx = e.clientX - this.lastLook.x;
        const dy = e.clientY - this.lastLook.y;
        this.lastLook = { x: e.clientX, y: e.clientY };
        this.player.yaw -= dx * 0.005;
        this.player.pitch = Math.max(-1.55, Math.min(1.55, this.player.pitch - dy * 0.005));
      }
    });

    const release = (e) => {
      if (e.pointerId === this.joyId) {
        this.joyId = null;
        this.player.touchMove = null;
        this.joyBase.classList.remove('active');
        this.setKnob(0, 0);
      }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);

    // —— 按钮 ——
    const layer = document.getElementById('touch-layer');
    for (const btn of layer.querySelectorAll('.tbtn')) {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const p = this.player;
        switch (act) {
          case 'fire':
            p.firing = true;
            if (p.state === 'ground') p.tryShoot(true);
            btn.classList.add('active');
            break;
          case 'jump':
            p.keys['Space'] = true;
            setTimeout(() => { p.keys['Space'] = false; }, 160);
            break;
          case 'crouch':
            p.crouch = !p.crouch;
            btn.classList.toggle('active', p.crouch);
            break;
          case 'sprint':
            p.touchSprint = !p.touchSprint;
            btn.classList.toggle('active', p.touchSprint);
            break;
          case 'interact':
            p.tryInteract();
            break;
          case 'reload':
            p.doReload();
            break;
          case 'inv':
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
            break;
          case 'map':
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
            break;
          case 'swap': {
            // 轮换下一把武器
            const inv = window.__sdc && window.__sdc.ui.invState;
            if (!inv) break;
            const wIdx = inv.items.map((it, i) => (WEAPONS[it.id] ? i : -1)).filter(i => i >= 0);
            if (!wIdx.length) break;
            const cur = wIdx.indexOf(inv.equipped);
            const next = wIdx[(cur + 1) % wIdx.length];
            window.__sdc.net.send({ t: 'equip', idx: next });
            break;
          }
        }
      });
      const up = () => {
        if (act === 'fire') {
          this.player.firing = false;
          btn.classList.remove('active');
        }
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  setKnob(dx, dy) {
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}
