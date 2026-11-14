// ============================================================
// Three.js 3D 场景：海岛地形 / 建筑 / 树木 / 战利品 / 其他玩家 / 特效
// ============================================================
import * as THREE from 'three';
import { terrainHeight } from '/shared/terrain.js';
import { MAP, POIS, EXTRACTORS } from '/shared/constants.js';
import { buildItemModel, normalizeModel } from '/js/inspect.js';
import { buildHumanoid } from '/js/humanoid.js';

const TERRAIN_SEG = 150;

function hashPix(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.world = null;
    this.walls = [];
    this.remotes = new Map();   // id -> {group, target, lastYaw}
    this.botMeshes = new Map();
    this.lootMeshes = new Map();
    this.tracers = [];
    this.impacts = [];
    this.recoil = 0;
    this.time = 0;
  }

  async init() {
    // 渲染器
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5d9);
    this.scene.fog = new THREE.Fog(0x9ec8e0, 200, 950);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 4000);
    // 渐变天穹（顶部深蓝 → 地平线暖白）
    this.buildSky();
    // 天上的云（漂移精灵）
    this.buildClouds();

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // 光照
    const hemi = new THREE.HemisphereLight(0xbfdcff, 0x5a6f4a, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.05);
    sun.position.set(300, 500, 200);
    this.scene.add(sun);

    // 拉取世界数据并构建
    const res = await fetch('/api/world');
    this.world = await res.json();
    this.walls = this.world.walls;
    this.floors = this.world.floors || [];
    this.buildTerrain();
    this.buildWater();
    this.buildVegetation();
    this.buildStructures();
    this.buildGrass();
    this.buildZone();
    this.buildExtractors();
    this.buildViewmodel();
    this.buildIslandImage();
    return this;
  }

  // ---------- 氛围：天空/云/草 ----------
  buildSky() {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const ctx = cv.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#2a5a8a');
    grad.addColorStop(0.45, '#7fb2d9');
    grad.addColorStop(0.72, '#cfe6f2');
    grad.addColorStop(0.88, '#ffe2b0');
    grad.addColorStop(1, '#ffe9c9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2800, 20, 14),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.scene.add(dome);
    this.skyDome = dome;
  }

  buildClouds() {
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
    const tex = new THREE.CanvasTexture(cv);
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.75, fog: false }));
      c.position.set((Math.random() - 0.5) * 1600, 260 + Math.random() * 160, (Math.random() - 0.5) * 1600);
      const s = 60 + Math.random() * 90;
      c.scale.set(s * 2, s, 1);
      c.userData.speed = 1.5 + Math.random() * 2;
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  buildGrass() {
    // 草叶贴图
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 5; i++) {
      const bx = 10 + i * 11 + Math.random() * 4;
      const grd = ctx.createLinearGradient(0, 64, bx, 0);
      grd.addColorStop(0, '#3a6a2a');
      grd.addColorStop(1, i % 2 ? '#7aae4a' : '#5a9e3a');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(bx - 3, 64);
      ctx.quadraticCurveTo(bx - 6 + Math.random() * 10, 30, bx + Math.random() * 8 - 4, 4 + Math.random() * 14);
      ctx.quadraticCurveTo(bx + 5, 32, bx + 3, 64);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.PlaneGeometry(1.4, 1.0);
    geo.translate(0, 0.5, 0);
    this.grassSwayUniform = { value: 0 };
    const makeGrassMat = () => {
      const m = new THREE.MeshLambertMaterial({
        map: tex, transparent: true, alphaTest: 0.42, side: THREE.DoubleSide,
      });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = this.grassSwayUniform;
        shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           #ifdef USE_INSTANCING
           float sway = sin(uTime * 1.7 + (instanceMatrix[3].x + instanceMatrix[3].z) * 0.06) * 0.14 * position.y;
           transformed.x += sway;
           transformed.z += sway * 0.55;
           #endif
          `);
      };
      return m;
    };
    const matA = makeGrassMat(), matB = makeGrassMat();
    // 落点：草地高度带、避开建筑/跑道/POI 核心
    const spots = [];
    let tries = 0;
    while (spots.length < 700 && tries < 7000) {
      tries++;
      const x = (Math.random() - 0.5) * (MAP.SIZE - 60), z = (Math.random() - 0.5) * (MAP.SIZE - 60);
      const h = terrainHeight(x, z);
      if (h < 3 || h > 26) continue;
      if (Math.abs(x - 60) < 170 && Math.abs(z + 180) < 24) continue;   // 跑道
      let nearPoi = false;
      for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.r * 0.55) { nearPoi = true; break; }
      if (nearPoi) continue;
      let inBld = false;
      for (const b of this.world.buildings) {
        if (Math.abs(x - b.x) < b.w / 2 + 2 && Math.abs(z - b.z) < b.d / 2 + 2) { inBld = true; break; }
      }
      if (inBld) continue;
      spots.push({ x, y: h, z, s: 0.8 + Math.random() * 0.9, r: Math.random() * Math.PI });
    }
    const mkInst = (mat, rotBase) => {
      const inst = new THREE.InstancedMesh(geo, mat, spots.length);
      const mm = new THREE.Matrix4();
      const e = new THREE.Euler();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3(1, 1, 1);
      spots.forEach((g, i) => {
        e.set(0, rotBase + g.r, 0);
        q.setFromEuler(e);
        mm.compose(new THREE.Vector3(g.x, g.y, g.z), q, v.multiplyScalar(g.s));
        inst.setMatrixAt(i, mm);
        v.set(1, 1, 1);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    };
    mkInst(matA, 0);
    mkInst(matB, Math.PI / 2);
    console.log(`[scene] 草丛 ${spots.length} 丛（双向面片）`);
  }

  // ---------- 地形 ----------
  buildTerrain() {
    const S = MAP.SIZE;
    const geo = new THREE.PlaneGeometry(S, S, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xd9c89a);
    const cGrass = new THREE.Color(0x6a9e4e);
    const cGrass2 = new THREE.Color(0x517f3c);
    const cRock = new THREE.Color(0x8d8677);
    const cSnow = new THREE.Color(0xe8ecf0);
    const cDeep = new THREE.Color(0x2a5f6e);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const n = hashPix(Math.round(x), Math.round(z)) * 0.12;
      if (h < 0.4) tmp.copy(cDeep).lerp(cSand, Math.max(0, (h + 12) / 12));
      else if (h < 3.2) tmp.copy(cSand);
      else if (h < 26) tmp.copy(cGrass).lerp(cGrass2, n);
      else if (h < 46) tmp.copy(cRock);
      else tmp.copy(cSnow);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // 手绘地面纹理：草叶细笔触 + 泥斑 + 沙点（与顶点色相乘，去纯色感）
    const gcv = document.createElement('canvas');
    gcv.width = 256; gcv.height = 256;
    const g = gcv.getContext('2d');
    g.fillStyle = '#9db06a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const bx = Math.random() * 256, by = Math.random() * 256;
      const shade = Math.random();
      g.strokeStyle = shade < 0.4 ? 'rgba(90,110,50,0.5)' : shade < 0.8 ? 'rgba(130,150,80,0.5)' : 'rgba(160,170,90,0.45)';
      g.lineWidth = 1 + Math.random();
      g.beginPath();
      g.moveTo(bx, by);
      g.lineTo(bx + Math.random() * 3 - 1.5, by - 3 - Math.random() * 4);
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const bx = Math.random() * 256, by = Math.random() * 256, r = 6 + Math.random() * 16;
      const dg = g.createRadialGradient(bx, by, 1, bx, by, r);
      dg.addColorStop(0, 'rgba(140,105,60,0.5)');
      dg.addColorStop(1, 'rgba(140,105,60,0)');
      g.fillStyle = dg;
      g.fillRect(bx - r, by - r, r * 2, r * 2);
    }
    const groundTex = new THREE.CanvasTexture(gcv);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(42, 42);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: groundTex, vertexColors: true }));
    this.scene.add(mesh);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(5000, 5000, 90, 90);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      color: 0x1e6a8f, specular: 0x9adfff, shininess: 70, transparent: true, opacity: 0.9,
    }));
    this.water.position.y = 0.05;
    this.scene.add(this.water);
    this.waterBase = this.water.geometry.attributes.position.array.slice();
  }

  // ---------- 植被 ----------
  buildVegetation() {
    const pines = this.world.trees.filter(t => t.type === 'pine');
    const palms = this.world.trees.filter(t => t.type === 'palm');

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 3.0, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6e4f2f });
    // 松树：双层塔状（下层宽、上层窄），逐棵随机色
    const pineLowGeo = new THREE.ConeGeometry(2.2, 3.4, 8);
    const pineTopGeo = new THREE.ConeGeometry(1.5, 2.8, 8);
    const pineGreens = [0x2d6a34, 0x3d7a3a, 0x58803a, 0x4a8a44, 0x35714a];
    const palmCrownGeo = new THREE.IcosahedronGeometry(1.8, 0);
    const palmGreens = [0x7aa53e, 0x8ab53e, 0x6a953e];
    const crownColor = (gi) => new THREE.Color(pineGreens[(gi + Math.floor(Math.random() * 2)) % pineGreens.length]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);

    this.addInstanced(trunkGeo, trunkMat, pines, (t, m) => {
      m.makeScale(t.s, t.s, t.s); m.setPosition(t.x, t.y + 1.1 * t.s, t.z);
    });
    // 松树冠：双层 + setColorAt 逐棵微变色
    const groups = [[], [], []];
    pines.forEach((t, i) => groups[i % 3].push(t));
    groups.forEach((arr, gi) => {
      const matLow = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const instLow = new THREE.InstancedMesh(pineLowGeo, matLow, arr.length);
      const instTop = new THREE.InstancedMesh(pineTopGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), arr.length);
      const mm = new THREE.Matrix4();
      arr.forEach((t, i) => {
        mm.makeScale(t.s, t.s, t.s); mm.setPosition(t.x, t.y + 3.6 * t.s, t.z);
        instLow.setMatrixAt(i, mm);
        mm.makeScale(t.s, t.s, t.s); mm.setPosition(t.x, t.y + 5.6 * t.s, t.z);
        instTop.setMatrixAt(i, mm);
        const col = crownColor(gi);
        instLow.setColorAt(i, col);
        instTop.setColorAt(i, col.clone().offsetHSL(0, 0, 0.04));
      });
      instLow.instanceMatrix.needsUpdate = true;
      instTop.instanceMatrix.needsUpdate = true;
      if (instLow.instanceColor) instLow.instanceColor.needsUpdate = true;
      if (instTop.instanceColor) instTop.instanceColor.needsUpdate = true;
      this.scene.add(instLow, instTop);
    });
    this.addInstanced(trunkGeo, trunkMat, palms, (t, m) => {
      m.makeScale(t.s * 0.9, t.s * 1.3, t.s * 0.9); m.setPosition(t.x, t.y + 1.5 * t.s, t.z);
    });
    const pgroups = [[], [], []];
    palms.forEach((t, i) => pgroups[i % 3].push(t));
    pgroups.forEach((arr, gi) => {
      this.addInstanced(palmCrownGeo, new THREE.MeshLambertMaterial({ color: palmGreens[gi] }), arr, (t, m) => {
        m.makeScale(t.s * 1.15, t.s * 0.6, t.s * 1.15); m.setPosition(t.x, t.y + 3.1 * t.s, t.z);
      });
    });

    // 灌木
    const bushGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const bushes = this.world.bushes || [];
    const bushGroups = [[], []];
    bushes.forEach((b, i) => bushGroups[i % 2].push(b));
    bushGroups.forEach((arr, gi) => {
      const bm = new THREE.MeshLambertMaterial({ color: gi === 0 ? 0x4e7a3c : 0x5e8a3a });
      const inst = new THREE.InstancedMesh(bushGeo, bm, arr.length);
      const mm = new THREE.Matrix4();
      arr.forEach((b, i) => {
        mm.makeRotationY(b.x * 2.7); mm.scale(new THREE.Vector3(b.s, b.s * 0.8, b.s)); mm.setPosition(b.x, b.y + b.s * 0.45, b.z);
        inst.setMatrixAt(i, mm);
      });
      inst.instanceMatrix.needsUpdate = true;
      this.scene.add(inst);
    });

    // 岩石
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8478 });
    this.addInstanced(rockGeo, rockMat, this.world.rocks, (r, m) => {
      m.makeRotationY(r.x * 3.1); m.scale(new THREE.Vector3(r.s, r.s * 0.7, r.s));
      m.setPosition(r.x, r.y + r.s * 0.2, r.z);
    });
  }

  addInstanced(geo, mat, items, place) {
    if (!items.length) return;
    const inst = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4();
    items.forEach((it, i) => { place(it, m); inst.setMatrixAt(i, m); });
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
  }

  // ---------- 建筑 ----------
  buildStructures() {
    const mats = {
      wall: new THREE.MeshLambertMaterial({ color: 0xc7c0b0 }),
      crate: new THREE.MeshLambertMaterial({ color: 0xa8763e }),
      container: new THREE.MeshLambertMaterial({ color: 0x4a8fb8 }),
      tower: new THREE.MeshLambertMaterial({ color: 0x5d6a5a }),
      lighthouse: new THREE.MeshLambertMaterial({ color: 0xe8e4da }),
      tent: new THREE.MeshLambertMaterial({ color: 0x556b3a }),
    };
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a5c40 });
    const padMat = new THREE.MeshLambertMaterial({ color: 0x3c4650 });
    const poolMat = new THREE.MeshLambertMaterial({ color: 0x3aa8c9, transparent: true, opacity: 0.85 });
    const runwayMat = new THREE.MeshLambertMaterial({ color: 0x555c60 });

    for (const w of this.world.walls) {
      if (w.kind === 'furn') continue;   // 家具单独建模渲染
      const wW = w.x1 - w.x0, wD = w.z1 - w.z0, wH = w.y1 - w.y0;
      const mat = w.c ? new THREE.MeshLambertMaterial({ color: new THREE.Color(w.c) })
        : (mats[w.kind] || mats.wall);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wW, wH, wD), mat);
      mesh.position.set((w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2, (w.z0 + w.z1) / 2);
      this.scene.add(mesh);
    }

    for (const b of this.world.buildings) {
      if (b.kind === 'pool') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, 0.5, b.d), poolMat);
        m.position.set(b.x, b.y + 0.2, b.z);
        this.scene.add(m);
        continue;
      }
      if (b.kind === 'helipad') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 0.2, 24), padMat);
        m.position.set(b.x, b.y + 0.1, b.z);
        this.scene.add(m);
        continue;
      }
      if (b.kind === 'lighthouse') {
        // 灯塔顶部红灯
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff4040 }));
        light.position.set(b.x, b.y + b.h + 0.5, b.z);
        this.scene.add(light);
        this._lighthouseLight = light;
        continue;
      }
      if (b.kind === 'tower') continue; // 墙体已渲染
    }

    // 双坡屋顶
    for (const r of (this.world.roofs || [])) {
      const c = new THREE.MeshLambertMaterial({ color: new THREE.Color(r.c || '#8a5a3a') });
      const slopeW = Math.sqrt((r.d / 2 + 0.5) * (r.d / 2 + 0.5) + r.ridgeH * r.ridgeH);
      const ang = Math.atan2(r.ridgeH, r.d / 2 + 0.5);
      const long = r.w + 0.9;
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(long, 0.14, slopeW), c);
      p1.position.set(r.x, r.y + r.ridgeH / 2, r.z - r.d / 4 - 0.12);
      p1.rotation.x = ang;
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(long, 0.14, slopeW), c);
      p2.position.set(r.x, r.y + r.ridgeH / 2, r.z + r.d / 4 + 0.12);
      p2.rotation.x = -ang;
      this.scene.add(p1, p2);
    }

    // 地毯
    for (const p of (this.world.props || []).filter(p2 => p2.kind === 'rug')) {
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(p.c || '#8a6a4a'), side: THREE.DoubleSide }));
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(p.x, p.y + 0.02, p.z);
      this.scene.add(rug);
    }

    // 场景道具（小船/集装箱上层/遮阳伞/沙袋/矿车/天线/灯塔灯体）
    for (const p of (this.world.props || [])) {
      const pm = new THREE.MeshLambertMaterial({ color: new THREE.Color(p.c || '#cccccc') });
      const g = new THREE.Group();
      switch (p.kind) {
        case 'boat':
          g.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 1.4), pm));
          g.add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.4, 0.16), pm)).position.set(0, 0.3, 0.6);
          g.add(new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.4, 0.16), pm)).position.set(0, 0.3, -0.6);
          g.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.6, 0.14), new THREE.MeshLambertMaterial({ color: 0x8a5a3a }))).position.set(-1.0, 0.9, 0);
          break;
        case 'container':
          g.add(new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.6), pm));
          break;
        case 'umbrella': {
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x8a5a3a }))).position.y = 1.2;
          g.add(new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.5, 10), pm)).position.y = 2.5;
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.06, 10, 1, true),
            new THREE.MeshLambertMaterial({ color: p.c, side: THREE.DoubleSide }))).position.y = 2.3;
          break;
        }
        case 'sandbag':
          for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.32, 0.55), pm);
            b.position.set((i % 2) * 0.12, 0.18 + i * 0.32, (i % 3 - 1) * 0.1);
            b.rotation.y = i * 0.3;
            g.add(b);
          }
          break;
        case 'cart':
          g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.0), pm)).position.y = 0.5;
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }))).position.set(0, 0.25, 0.5);
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 8), new THREE.MeshLambertMaterial({ color: 0x222222 }))).position.set(0, 0.25, -0.5);
          break;
        case 'antenna':
          g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 12, 6), pm)).position.y = 6;
          g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshLambertMaterial({ color: 0xff4040, emissive: 0x551111 }))).position.y = 12.2;
          break;
        case 'cross':
          g.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.28, 0.1), pm));
          g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 0.1), pm));
          g.position.y = 1.0;
          break;
        case 'sign': {
          const cv2 = document.createElement('canvas');
          cv2.width = 128; cv2.height = 40;
          const c2 = cv2.getContext('2d');
          c2.fillStyle = '#f2ede4'; c2.fillRect(0, 0, 128, 40);
          c2.fillStyle = p.c; c2.fillRect(0, 0, 40, 40);
          c2.fillStyle = '#3a3222'; c2.font = 'bold 26px sans-serif'; c2.fillText('HOSP', 46, 28);
          const tex2 = new THREE.CanvasTexture(cv2);
          g.add(new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshBasicMaterial({ map: tex2, side: THREE.DoubleSide })));
          break;
        }
        case 'lamp':
          g.add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9 })));
          g.userData.blink = true;
          this.lamps = this.lamps || [];
          this.lamps.push(g);
          break;
        default:
          g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), pm));
      }
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = p.rot || 0;
      this.scene.add(g);
    }

    // 跑道
    const runway = new THREE.Mesh(new THREE.BoxGeometry(310, 0.12, 24), runwayMat);
    runway.position.set(60, terrainHeight(60, -180) + 0.06, -180);
    this.scene.add(runway);

    this.buildFurniture();

    // POI 名称浮标（高处可见）
    for (const p of POIS) {
      this.addLabel(p.name, p.x, terrainHeight(p.x, p.z) + 24, p.z, 26, '#ffe9c9');
    }
  }

  // ---------- 家具（桌/柜/架/保险柜） ----------
  buildFurniture() {
    this.safeDoors = new Map();
    this.openSafes = new Set();
    const M = {
      wood: new THREE.MeshLambertMaterial({ color: 0x8a6840 }),
      woodDark: new THREE.MeshLambertMaterial({ color: 0x6a4f30 }),
      metal: new THREE.MeshLambertMaterial({ color: 0x3c4650 }),
      metalDark: new THREE.MeshLambertMaterial({ color: 0x272e36 }),
      gold2: new THREE.MeshLambertMaterial({ color: 0xc8a040 }),
      shelfM: new THREE.MeshLambertMaterial({ color: 0x7a6a52 }),
    };
    for (const f of (this.world.furniture || [])) {
      const g = new THREE.Group();
      if (f.kind === 'table') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.06, f.d), M.wood));
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, f.h - 0.06, 0.08), M.woodDark);
          leg.position.set(sx * (f.w / 2 - 0.1), -(f.h - 0.06) / 2, sz * (f.d / 2 - 0.1));
          g.add(leg);
        }
      } else if (f.kind === 'cabinet') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), M.wood));
        const door = new THREE.Mesh(new THREE.BoxGeometry(f.w * 0.44, f.h * 0.7, 0.02), M.woodDark);
        door.position.set(-f.w * 0.24, 0, f.d / 2 + 0.012);
        g.add(door);
        const door2 = door.clone();
        door2.position.x = f.w * 0.24;
        g.add(door2);
      } else if (f.kind === 'shelf') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.05, f.d), M.shelfM));
        for (const ly of [-0.5, 0, 0.5]) {
          if (ly === 0) continue;
          const board = new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.04, f.d), M.shelfM);
          board.position.set(0, ly, 0);
          g.add(board);
        }
        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, f.h, 0.06), M.woodDark);
          post.position.set(sx * (f.w / 2 - 0.04), 0, 0);
          g.add(post);
        }
      } else if (f.kind === 'bed') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w, 0.3, f.d), new THREE.MeshLambertMaterial({ color: 0x8a5a3a })));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.1, 0.16, f.d - 0.1), new THREE.MeshLambertMaterial({ color: 0xe8e4da }))).position.y = 0.2;
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.3, 0.12, 0.5), new THREE.MeshLambertMaterial({ color: 0xd0304a }))).position.set(0, 0.3, -f.d / 2 + 0.4);
      } else if (f.kind === 'safe') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), M.metal));
        // 柜门（可绕边旋转打开）
        const door = new THREE.Mesh(new THREE.BoxGeometry(f.w * 0.9, f.h * 0.9, 0.03), M.metalDark);
        door.position.set(0, 0, f.d / 2 + 0.02);
        g.add(door);
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10), M.gold2);
        dial.rotation.x = Math.PI / 2;
        dial.position.set(0, 0, f.d / 2 + 0.045);
        g.add(dial);
        g.userData.door = door;
        this.safeDoors.set(f.id, g);
      }
      g.position.set(f.x, f.y + f.h / 2, f.z);
      this.scene.add(g);
    }
  }

  markSafeOpen(id) {
    if (!this.safeDoors) return;
    this.openSafes.add(id);
    const g = this.safeDoors.get(id);
    if (g && g.userData.door) {
      // 柜门绕左边缘旋转 100°
      const pivot = new THREE.Group();
      const door = g.userData.door;
      const w = door.geometry.parameters.width;
      door.position.x = -w / 2 + door.position.x;   // 移到铰链侧
      pivot.add(door);
      pivot.position.set(-w / 2, 0, g.userData.door.position.z);
      g.add(pivot);
      pivot.rotation.y = 1.75;
      g.userData.door = null;
    }
  }

  addLabel(text, x, y, z, size = 10, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 34px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText(text, 128, 42);
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(size, size / 4, 1);
    spr.position.set(x, y, z);
    this.scene.add(spr);
    return spr;
  }

  // ---------- 缩圈可视化 ----------
  buildZone() {
    const geo = new THREE.CylinderGeometry(1, 1, 160, 64, 1, true);
    this.zoneWall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xff5533, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.scene.add(this.zoneWall);

    const ringGeo = new THREE.RingGeometry(0.985, 1.0, 64);
    ringGeo.rotateX(-Math.PI / 2);
    this.zoneRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.scene.add(this.zoneRing);
  }

  updateZone(zs) {
    if (!zs) return;
    this.zoneWall.scale.set(zs.r, 1, zs.r);
    this.zoneWall.position.set(zs.cx, 70, zs.cz);
    this.zoneRing.scale.set(zs.tr, 1, zs.tr);
    this.zoneRing.position.set(zs.tcx, Math.max(terrainHeight(zs.tcx, zs.tcz), 0) + 0.5, zs.tcz);
  }

  // ---------- 撤离点 ----------
  buildExtractors() {
    this.extractorBeams = new Map();
    for (const ex of EXTRACTORS) {
      const y = Math.max(terrainHeight(ex.x, ex.z), 0);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(ex.r * 0.92, ex.r * 0.92, 46, 28, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x44ff88, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
        }));
      beam.position.set(ex.x, y + 23, ex.z);
      this.scene.add(beam);

      const ringGeo = new THREE.RingGeometry(ex.r * 0.9, ex.r, 40);
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0x44ff88, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false,
      }));
      ring.position.set(ex.x, y + 0.4, ex.z);
      this.scene.add(ring);

      const label = this.addLabel(ex.name, ex.x, y + 12, ex.z, 9, '#9fffc9');
      this.extractorBeams.set(ex.id, { beam, ring, y });
    }
  }

  updateExtractors(states) {
    if (!states || !this.extractorBeams) return;
    for (const s of states) {
      const v = this.extractorBeams.get(s.id);
      if (!v) continue;
      const open = s.open;
      v.beam.material.color.set(open ? 0x44ff88 : 0x4466aa);
      v.ring.material.color.set(open ? 0x44ff88 : 0x4466aa);
      v.beam.material.opacity = open ? 0.16 + Math.sin(this.time * 3) * 0.05 : 0.07;
      v.ring.material.opacity = open ? 0.55 : 0.2;
    }
  }

  // ---------- 第一人称武器模型 ----------
  buildViewmodel() {
    this.viewmodel = new THREE.Group();
    this.gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52),
      new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
    this.gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x171a1f }));
    this.gunBarrel.position.set(0, 0.02, -0.38);
    this.hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14),
      new THREE.MeshLambertMaterial({ color: 0xc9a077 }));
    this.hand.position.set(0.01, -0.09, -0.1);
    this.viewmodel.add(this.gunBody, this.gunBarrel, this.hand);
    this.viewmodel.position.set(0.24, -0.2, -0.42);
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this.muzzleLight = new THREE.PointLight(0xffca70, 0, 14);
    this.muzzleLight.position.set(0.24, -0.12, -0.75);
    this.camera.add(this.muzzleLight);
  }

  // 右键瞄准：FOV 变焦 + 枪位居中（狙击枪隐藏枪模改用镜内视角）
  handleAim({ aiming, weapon }) {
    if (!this.aimFov) this.aimFov = { target: null };
    const kind = aiming ? weapon : null;
    let fov = 72, hideGun = false, gunCenter = false;
    if (kind === 'lr') { fov = 24; hideGun = true; }
    else if (kind === 'ak' || kind === 'smg') { fov = 50; gunCenter = true; }
    else if (kind === 'p92') { fov = 60; gunCenter = true; }
    this.aimFov.target = fov;
    this.aimWeapon = kind;
    this.aimHideGun = hideGun;
    this.aimGunCenter = gunCenter;
    if (this.viewmodel) this.viewmodel.visible = !hideGun && !(this.chute && this.chute.visible);
    this.onAimUi && this.onAimUi({ aiming, kind, hideGun });
  }

  setGunSize(weaponId) {
    const scale = weaponId === 'lr' ? 1.5 : weaponId === 'ak' ? 1.2 : weaponId === 'smg' ? 0.85 : weaponId === 'p92' ? 0.7 : 0.45;
    this.gunBody.scale.z = scale;
    this.gunBarrel.scale.z = scale * 0.9;
    this.gunBarrel.position.z = -0.38 * scale;
  }

  // ---------- 其他玩家 / 机器人 ----------
  makeAvatar(name, appearanceArr, isBot = false) {
    const group = buildHumanoid(appearanceArr);
    // 枪挂在右手锚点上（不再悬浮）
    const hand = group.userData.handR || { x: 0.33, y: 0.68, z: 0 };
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55),
      new THREE.MeshLambertMaterial({ color: 0x1e2228 }));
    gun.position.set(hand.x, hand.y + 0.06, hand.z - 0.22);
    group.add(gun);
    group.userData.gun = gun;
    if (name) {
      const spr = this.addLabel(name, 0, 2.2, 0, 1.9, isBot ? '#ffb0b0' : '#bfe3ff');
      spr.visible = this.namesVisible !== false;
      group.add(spr);
    }
    this.scene.add(group);
    return group;
  }

  updateRemotes(players) {
    // players: [{id,name,x,y,z,yaw,st,w,cr}]
    const seen = new Set();
    for (const p of players) {
      if (p.st === 'wait') continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const g = this.makeAvatar(p.name, p.a || [0,0,0,0,0], false);
        r = { group: g, tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw };
        this.remotes.set(p.id, r);
      }
      r.tx = p.x; r.ty = p.y; r.tz = p.z; r.tyaw = p.yaw;
      r.group.visible = p.st === 'ground' || p.st === 'sky';
      r.group.userData.gun.visible = !!p.w && p.w !== 'knife';
      r.group.scale.y = p.cr ? 0.62 : 1;
    }
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) { this.scene.remove(r.group); this.remotes.delete(id); }
    }
  }

  updateBots(bots) {
    const seen = new Set();
    for (const b of bots) {
      seen.add(b.id);
      let r = this.botMeshes.get(b.id);
      if (!r) {
        const g = this.makeAvatar(b.name, b.a || [0,0,0,0,0], true);
        r = { group: g, tx: b.x, ty: b.y, tz: b.z, tyaw: b.yaw };
        this.botMeshes.set(b.id, r);
      }
      r.tx = b.x; r.ty = b.y; r.tz = b.z; r.tyaw = b.yaw;
      r.group.visible = true;
    }
    for (const [id, r] of this.botMeshes) {
      if (!seen.has(id)) { this.scene.remove(r.group); this.botMeshes.delete(id); }
    }
  }

  // ---------- 战利品 ----------
  clearLoot() {
    for (const m of this.lootMeshes.values()) this.scene.remove(m);
    this.lootMeshes.clear();
  }

  clearMatch() {
    this.clearLoot();
    for (const r of this.remotes.values()) this.scene.remove(r.group);
    this.remotes.clear();
    for (const r of this.botMeshes.values()) this.scene.remove(r.group);
    this.botMeshes.clear();
    for (const t of this.tracers) this.scene.remove(t);
    this.tracers = [];
    for (const m of this.impacts) this.scene.remove(m);
    this.impacts = [];
    this.setChute(false);
    this.showPlane(false);
  }

  lootColor(itemId) {
    const map = {
      ammo: '#d8b24a', med: '#e06a6a', armor: '#4d8fd2', helmet: '#4dd2ff',
      pack: '#9a6adf', loot: '#ffcf4d',
    };
    return map[itemId] || '#cccccc';
  }

  initLoot(list, ITEMS, WEAPONS) {
    for (const e of list) this.addLootMesh(e, ITEMS, WEAPONS);
  }

  addLootMesh(e, ITEMS, WEAPONS) {
    if (this.lootMeshes.has(e.id)) return;
    const def = ITEMS[e.item] || WEAPONS[e.item];
    if (!def) return;
    // 道具模型加大，头顶悬浮名牌（分类着色），一眼可辨
    const isWeapon = !!WEAPONS[e.item];
    const model = normalizeModel(buildItemModel(e.item), isWeapon ? 1.0 : 0.6);
    model.position.set(e.x, (e.y || 0.5) + 0.55, e.z);
    const kindColor = isWeapon ? '#ffb066'
      : def.kind === 'ammo' ? '#ffe14d'
      : def.kind === 'med' || def.kind === 'food' ? '#6fe07a'
      : def.kind === 'armor' || def.kind === 'helmet' || def.kind === 'pack' ? '#4dd2ff'
      : def.kind === 'loot' ? '#ffcf4d' : '#d8e0ff';
    const spr = this.addLabel(def.name, 0, 1.0, 0, 1.35, kindColor);
    model.add(spr);
    this.scene.add(model);
    this.lootMeshes.set(e.id, model);
  }

  delLootMesh(id) {
    const m = this.lootMeshes.get(id);
    if (m) { this.scene.remove(m); this.lootMeshes.delete(id); }
  }

  // ---------- 特效 ----------
  addTracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z),
    ]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    line.userData.life = 0.09;
    this.scene.add(line);
    this.tracers.push(line);
  }

  impact(at) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xd8c9a0, transparent: true, opacity: 0.85 }));
    m.position.set(at.x, at.y, at.z);
    m.userData.life = 0.28;
    m.userData.grow = 2.4;
    this.scene.add(m);
    this.impacts.push(m);
  }

  muzzle() {
    this.muzzleLight.intensity = 2.6;
    this.recoil = 1;
    if (this.viewmodel) this.viewmodel.position.z = -0.34;
  }

  setChute(on) {
    if (on && !this.chute) {
      const geo = new THREE.SphereGeometry(2.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      this.chute = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
        color: 0xff8830, side: THREE.DoubleSide,
      }));
      this.chute.scale.y = 0.55;
      this.scene.add(this.chute);
    }
    if (this.chute) this.chute.visible = !!on;
  }

  // ---------- 跳伞运输机 ----------
  showPlane(show) {
    if (show && !this.plane) {
      const g = new THREE.Group();
      const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 11, 10),
        new THREE.MeshLambertMaterial({ color: 0x54636f }));
      fus.rotateX(Math.PI / 2);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 2.6),
        new THREE.MeshLambertMaterial({ color: 0x46545e }));
      wing.position.y = 0.6;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 0.3),
        new THREE.MeshLambertMaterial({ color: 0x46545e }));
      tail.position.set(0, 1.6, 5.4);
      g.add(fus, wing, tail);
      this.plane = g;
      this.scene.add(g);
    }
    if (this.plane) this.plane.visible = !!show;
  }

  setPlanePos(x, y, z) {
    if (this.plane) this.plane.position.set(x, y, z);
  }

  // ---------- 小地图底图 ----------
  buildIslandImage() {
    const N = 220;
    const cv = document.createElement('canvas');
    cv.width = N; cv.height = N;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const wx = (px / N - 0.5) * MAP.SIZE;
        const wz = (py / N - 0.5) * MAP.SIZE;
        const h = terrainHeight(wx, wz);
        let r, g, b;
        if (h < -3) { r = 18; g = 40; b = 66; }
        else if (h < 0.4) { r = 42; g = 84; b = 118; }
        else if (h < 3.2) { r = 216; g = 200; b = 154; }
        else if (h < 26) { const k = (h - 3.2) / 23; r = 96 + k * 30; g = 148 - k * 40; b = 70; }
        else if (h < 46) { r = 140; g = 133; b = 118; }
        else { r = 232; g = 236; b = 240; }
        const i = (py * N + px) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.islandCanvas = cv;
  }

  worldToMap(x, z, size) {
    return [((x / MAP.SIZE) + 0.5) * size, ((z / MAP.SIZE) + 0.5) * size];
  }

  // ---------- 主帧更新 ----------
  frame(dt, selfPos) {
    this.time += dt;
    // 弹道
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.userData.life -= dt;
      t.material.opacity = Math.max(0, t.userData.life / 0.09);
      if (t.userData.life <= 0) { this.scene.remove(t); this.tracers.splice(i, 1); }
    }
    // 命中特效
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const m = this.impacts[i];
      m.userData.life -= dt;
      const s = 1 + (0.28 - Math.max(0, m.userData.life)) * m.userData.grow;
      m.scale.setScalar(s);
      m.material.opacity = Math.max(0, m.userData.life / 0.28) * 0.85;
      if (m.userData.life <= 0) { this.scene.remove(m); this.impacts.splice(i, 1); }
    }
    // 瞄准 FOV/枪位平滑过渡
    if (this.aimFov && this.aimFov.target !== null) {
      const diff = this.aimFov.target - this.camera.fov;
      if (Math.abs(diff) > 0.1) {
        this.camera.fov += diff * Math.min(1, dt * 12);
        this.camera.updateProjectionMatrix();
      }
      if (this.viewmodel) {
        const tx = this.aimGunCenter ? 0.03 : 0.24;
        const ty = this.aimHideGun ? -0.2 : (this.aimGunCenter ? -0.13 : -0.2);
        this.viewmodel.position.x += (tx - this.viewmodel.position.x) * Math.min(1, dt * 12);
        this.viewmodel.position.y += (ty - this.viewmodel.position.y) * Math.min(1, dt * 12);
      }
    }
    // 枪口灯衰减
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 22);
    // 后座恢复
    if (this.recoil > 0) {
      this.recoil = Math.max(0, this.recoil - dt * 9);
      this.viewmodel.position.z = -0.42 - this.recoil * 0.09;
      this.viewmodel.rotation.x = this.recoil * 0.18;
    }
    // 战利品漂浮
    for (const m of this.lootMeshes.values()) {
      m.rotation.y += dt * 1.4;
      m.position.y += Math.sin(this.time * 2.4 + m.position.x) * 0.0016;
    }
    // 远程玩家/机器人插值
    const lerpK = Math.min(1, dt * 11);
    for (const r of this.remotes.values()) {
      const g = r.group;
      g.position.x += (r.tx - g.position.x) * lerpK;
      g.position.y += (r.ty - g.position.y) * lerpK;
      g.position.z += (r.tz - g.position.z) * lerpK;
      g.rotation.y = r.tyaw + Math.PI;
    }
    for (const r of this.botMeshes.values()) {
      const g = r.group;
      g.position.x += (r.tx - g.position.x) * lerpK;
      g.position.y += (r.ty - g.position.y) * lerpK;
      g.position.z += (r.tz - g.position.z) * lerpK;
      g.rotation.y = r.tyaw + Math.PI;
      // 攻击状态枪口抬起
      g.userData.gun.rotation.x = g.userData.attackT ? -0.2 : 0;
    }
    // 降落伞跟随
    if (this.chute && this.chute.visible && selfPos) {
      this.chute.position.set(selfPos.x, selfPos.y + 3.4, selfPos.z);
      this.chute.rotation.y = Math.sin(this.time * 1.7) * 0.15;
      this.chute.rotation.z = Math.sin(this.time * 1.3) * 0.1;
    }
    // 水面波动（顶点起伏）+ 云漂移 + 草摆动
    if (this.water) {
      const pos = this.water.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 7) {
        const bx = this.waterBase[i * 3], by = this.waterBase[i * 3 + 1];
        pos.setZ(i, Math.sin(bx * 0.08 + this.time * 1.4) * 0.22 + Math.cos(by * 0.11 + this.time) * 0.16);
      }
      pos.needsUpdate = true;
    }
    for (const c of (this.clouds || [])) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 1100) c.position.x = -1100;
    }
    if (this.grassSwayUniform) this.grassSwayUniform.value = this.time;
    // 灯塔红灯闪烁
    if (this._lighthouseLight) this._lighthouseLight.visible = Math.sin(this.time * 2.4) > 0;

    this.renderer.render(this.scene, this.camera);
  }
}
