// 大厅形象预览 v2：角色站在动态海岛场景里（渐变天穹/海浪/椰树/云/沙岛）
import * as THREE from 'three';
import { buildHumanoid } from '/js/humanoid.js';

function gradientTexture(stops, w = 4, h = 256) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

function cloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const ctx = cv.getContext('2d');
  for (const [x, y, r, o] of [[40, 36, 20, 0.9], [70, 30, 26, 0.85], [95, 38, 18, 0.8], [58, 44, 22, 0.85]]) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${o})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
  }
  return new THREE.CanvasTexture(cv);
}

export class AvatarPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.1, 200);
    this.camera.position.set(0.6, 1.5, 4.2);
    this.camera.lookAt(0, 0.95, 0);

    // 天穹
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(120, 16, 12),
      new THREE.MeshBasicMaterial({
        map: gradientTexture([[0, '#2a5a8a'], [0.5, '#7fb2d9'], [0.75, '#ffd9a0'], [1, '#ffe9c9']]),
        side: THREE.BackSide, depthWrite: false,
      }));
    this.scene.add(sky);
    // 太阳
    const sun = new THREE.Mesh(new THREE.CircleGeometry(5, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0 }));
    sun.position.set(-26, 34, -70);
    sun.lookAt(0, 2, 0);
    this.scene.add(sun);
    // 海面（两片错位波动）
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(300, 120, 48, 18),
      new THREE.MeshLambertMaterial({ color: 0x2e7ea8, transparent: true, opacity: 0.92 }));
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, -0.6, -40);
    this.scene.add(this.water);
    this.waterBase = this.water.geometry.attributes.position.array.slice();
    // 沙岛（角色站的地方）
    const sand = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 0.5, 24),
      new THREE.MeshLambertMaterial({ color: 0xf0dcb0 }));
    sand.position.y = -0.28;
    this.scene.add(sand);
    // 椰树两棵
    for (const [px, pz, s] of [[-1.9, -1.6, 1], [2.1, -2.0, 0.85]]) {
      const palm = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 2.2 * s, 6),
        new THREE.MeshLambertMaterial({ color: 0x8a5a3a }));
      trunk.position.y = 1.1 * s;
      palm.add(trunk);
      for (let i = 0; i < 5; i++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09 * s, 1.1 * s, 4),
          new THREE.MeshLambertMaterial({ color: 0x3a8a4a }));
        const ang = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.sin(ang) * 0.5 * s, 2.3 * s, Math.cos(ang) * 0.5 * s);
        leaf.rotation.set(Math.cos(ang) * 1.25, 0, -Math.sin(ang) * 1.25);
        palm.add(leaf);
      }
      palm.position.set(px, 0, pz);
      this.scene.add(palm);
    }
    // 云（缓慢漂移）
    this.clouds = [];
    for (const [x, y, z, s] of [[-14, 18, -45, 6], [10, 24, -60, 8], [-6, 15, -35, 4]]) {
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, opacity: 0.85 }));
      c.position.set(x, y, z);
      c.scale.set(s * 2, s, 1);
      this.scene.add(c);
      this.clouds.push(c);
    }
    // 光
    this.scene.add(new THREE.HemisphereLight(0xbfdcff, 0x8a7a5a, 0.85));
    const dl = new THREE.DirectionalLight(0xfff2d0, 1.0);
    dl.position.set(-6, 8, 4);
    this.scene.add(dl);

    this.current = null;
    this.rotation = 0;
    this.time = 0;
    this.setAppearance(null);
    this.running = true;
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.running || !this.canvas.isConnected) return;
      this.tick();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
    addEventListener('resize', () => this.resize());
  }

  tick() {
    this.time += 0.016;
    this.rotation += 0.012;
    if (this.current) this.current.rotation.y = this.rotation;
    // 海浪顶点波动
    const pos = this.water.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.waterBase[i * 3], by = this.waterBase[i * 3 + 1];
      pos.setZ(i, Math.sin(bx * 0.5 + this.time * 1.8) * 0.12 + Math.cos(by * 0.7 + this.time * 1.3) * 0.08);
    }
    pos.needsUpdate = true;
    for (const c of this.clouds) {
      c.position.x += 0.008;
      if (c.position.x > 30) c.position.x = -30;
    }
  }

  resize() {
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setAppearance(a) {
    if (this.current) this.scene.remove(this.current);
    this.current = buildHumanoid(a);
    this.scene.add(this.current);
  }
}
