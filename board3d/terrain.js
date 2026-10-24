// 3D-местность прототипа (этап 5, черновик по концепту
// outputs/board3d-concept/concept-river-bridge-v1.png).
//
// Правила (Doc/board-3d-terrain-refs.md):
//   - все клетки на одном уровне y = 0, рельефа под тропами нет;
//   - вода ниже: под водой земля опущена, сверху полупрозрачная гладь;
//   - клетка, центр которой над водой, — мостовая: под ней настил на уровне клеток;
//   - ёлки и скалы — инстансинг, расставлены по маске data/terrain-mask.png
//     (R — вода, G — лес, B — скалы; маску делает tools/board3d_terrain_mask.py,
//     позже её может перерисовать художник).
import * as THREE from 'three';
import { mergeGeometries } from './vendor/three/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from './vendor/three/jsm/loaders/GLTFLoader.js';

const WATER_FLOOR = -0.9;     // дно под водой
const WATER_LEVEL = -0.3;     // поверхность воды
const CLIFF_HEIGHT = 3.2;     // плато обрывов по краю карты
const ROCK_HEIGHT = 2.4;      // отдельные скалы — тоже поднятая земля с нарисованной скалой сверху
const CELL_CLEAR = 1.15;      // ствол не ближе к центру клетки: лес подходит к самым клеткам (не «городской парк»)
const BRIDGE_WIDTH = 1.95;    // ширина дорожки: гекс от грани до грани (√3) + запас
// Ёлки по концепту: высокие (≈2 роста фигурки и больше), редкие, ярусами.
const PINE_MIN = 2.9, PINE_MAX = 4.1, TREE_STEP = 0.85;   // гуще — как в цели-арте   // −15% и гуще (20.10)

// Детерминированный «случай», чтобы лес не менялся от перезагрузки.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadMask(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
}

// Ближайшая клетка через сетку-корзины: 273 клетки × сотни тысяч запросов.
function cellIndex(cells, bucket = 2) {
  const map = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const c of cells) {
    const k = key(Math.floor(c.x / bucket), Math.floor(c.z / bucket));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  }
  return (x, z, filter) => {
    const bi = Math.floor(x / bucket), bj = Math.floor(z / bucket);
    let best = 9;
    for (let i = bi - 1; i <= bi + 1; i += 1) {
      for (let j = bj - 1; j <= bj + 1; j += 1) {
        for (const c of map.get(key(i, j)) ?? []) {
          if (filter && !filter(c)) continue;
          const d = Math.hypot(c.x - x, c.z - z);
          if (d < best) best = d;
        }
      }
    }
    return best;
  };
}

function pineGeometry() {
  const parts = [];
  const paint = (g, color) => {
    g = g.toNonIndexed();
    const col = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) col.toArray(arr, i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  };
  // высота ёлки = 1, масштабируется при расстановке
  parts.push(paint(new THREE.CylinderGeometry(0.028, 0.042, 0.2, 6).translate(0, 0.1, 0), '#5a3b22'));
  const tiers = [
    [0.30, 0.30, 0.31, '#163a1a'], [0.25, 0.27, 0.47, '#1c4520'], [0.2, 0.24, 0.62, '#235127'],
    [0.14, 0.21, 0.76, '#2b5e2c'], [0.08, 0.18, 0.89, '#356b33'],
  ];
  for (const [r, h, y, c] of tiers) parts.push(paint(new THREE.ConeGeometry(r, h, 8).translate(0, y, 0), c));
  return mergeGeometries(parts);
}

// Сказочное дерево (поляна феникса): изогнутый ствол и круглые кроны-шары; высота = 1.
// Кроны белые в вершинных цветах — цвет (розовый/сиреневый/бирюзовый) задаётся инстансу.
function fairyTreeGeometry() {
  const paint = (g, color) => {
    g = g.toNonIndexed();
    const col = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) col.toArray(arr, i);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const trunkCol = '#7a5a8a';
  const parts = [
    paint(new THREE.CylinderGeometry(0.045, 0.07, 0.42, 6).translate(0, 0.21, 0), trunkCol),
    paint(new THREE.CylinderGeometry(0.03, 0.045, 0.32, 6).rotateZ(0.45).translate(-0.07, 0.55, 0), trunkCol),
    paint(new THREE.CylinderGeometry(0.02, 0.03, 0.22, 5).rotateZ(-0.6).translate(0.08, 0.5, 0.02), trunkCol),
    paint(new THREE.IcosahedronGeometry(0.27, 1).translate(-0.14, 0.78, 0), '#ffffff'),
    paint(new THREE.IcosahedronGeometry(0.17, 1).translate(0.17, 0.64, 0.04), '#ffffff'),
    paint(new THREE.IcosahedronGeometry(0.12, 1).translate(0.02, 0.92, -0.12), '#ffffff'),
  ];
  return mergeGeometries(parts);
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const r = rng(seed);
  const p = g.attributes.position;
  // Сдвигаем вершины, общие для граней, одинаково — иначе камень «треснет».
  const moved = new Map();
  for (let i = 0; i < p.count; i += 1) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!moved.has(k)) moved.set(k, 0.78 + r() * 0.4);
    const s = moved.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.8, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function plankTexture() {
  // тёмные потёртые доски поперёк моста (реф v6b): разный тон доски, щели, сучки, царапины
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2716'; g.fillRect(0, 0, 128, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < 512; y += 32) {
    const t = 0.75 + rnd() * 0.35;
    g.fillStyle = `rgb(${Math.round(92 * t)},${Math.round(64 * t)},${Math.round(40 * t)})`;
    g.fillRect(0, y + 3, 128, 27);
    for (let i = 0; i < 10; i += 1) {                     // волокна
      g.fillStyle = `rgba(30,18,8,${0.12 + rnd() * 0.15})`;
      g.fillRect(0, y + 4 + rnd() * 24, 128, 1);
    }
    if (rnd() < 0.5) { g.fillStyle = 'rgba(25,15,6,0.6)'; g.beginPath(); g.ellipse(rnd() * 128, y + 16, 4, 2, 0, 0, 7); g.fill(); }
    g.fillStyle = '#1a0f07'; g.fillRect(0, y, 128, 3);     // щель
    g.fillStyle = 'rgba(20,12,6,0.8)'; g.fillRect(0, y + 30, 128, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function blobShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Ворота дварфов: две деревянные башни с шатровыми крышами и створки между ними.
// Стена вдоль локальной оси x, створки смотрят в +z (к своей клетке, как дверь домика).
// Ворота дварфов (как в игровом ролике): каменный портал в скале — пилоны с рунами, перемычка,
// утопленные железные двери, ступени, жаровни. Фасадные грани — текстуры из рисунка Codex
// (outputs/board3d-concept/sprites2/sheet-gate.png → data/gate-*.webp), руны светятся (gate-*-glow).
const gateTex = {};
const FLOOR_WALL_Y = -0.3;     // низ стен у ворот — чуть в землю
function gateMat(name, repeat) {
  if (!gateTex[name]) {
    const l = new THREE.TextureLoader();
    const map = l.load(`./data/gate-${name}.webp?v=1`); map.colorSpace = THREE.SRGBColorSpace;
    const glow = l.load(`./data/gate-${name}-glow.webp?v=1`);
    gateTex[name] = new THREE.MeshLambertMaterial({ map, emissive: 0x6fe8ff, emissiveMap: glow, emissiveIntensity: 1.6 });
  }
  return gateTex[name];
}
// модель ворот v2 из Blender: портал по частям + столбчатая скала вокруг (tools/blender/dwarf_gate_v2.py)
let gateModel = null;
let _doorTex = null;
const doorTex = () => {
  if (_doorTex) return _doorTex;
  const l = new THREE.TextureLoader();
  const m = l.load('./data/gate/doors4-front.webp?v=1'); m.colorSpace = THREE.SRGBColorSpace; m.flipY = false;
  const g = l.load('./data/gate/doors4-glow.webp?v=1'); g.colorSpace = THREE.SRGBColorSpace; g.flipY = false;
  return (_doorTex = [m, g]);
};
async function loadGateModel(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.traverse(o => {
    // жаровня из двух материалов приходит группой — огонь вешаем на один её меш
    if (o.userData.torch && !o.isMesh) { const m = o.children.find(c => c.isMesh); if (m) m.userData.torch = true; o.userData.torch = false; }
    // пивоты огня чаш (fire_l / fire_r, инженерка §6): огонь ставит atmosphere.js
    if (o.userData.fire) o.userData.firePoint = true;
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      if (o.material.emissiveMap) o.material.emissiveIntensity = 1.1;
      if (o.material.name === 'gate_stone' || o.material.name === 'gate_floor') { o.material.color.setRGB(0.8, 0.8, 0.82); o.material.roughness = 1; }
      if (o.material.name === 'gate_rune') { o.material.emissive.set(0x3fc8f0); o.material.emissiveIntensity = 0.9; o.material.color.set(0x0c2a33); }   // руны — голубым, без пересвета
      if (o.name === 'keystone_rune' || o.parent?.name === 'keystone_rune') {   // 23.10: ромб в замке — сплошное свечение (из атласа брал тёмный угол)
        o.material = o.material.clone(); o.material.map = null; o.material.emissiveMap = null;
        o.material.color.set(0x0c2a33); o.material.emissive.set(0x3fc8f0); o.material.emissiveIntensity = 1.0; o.material.needsUpdate = true;
      }
      if (o.material.name === 'gate_ember') { o.material.emissive.set(0xff4a10); o.material.emissiveIntensity = 0.8; o.material.color.set(0x220804); }
      // 23.10: створки были чёрными — металл без окружения отражает пустоту; дерево и железо — матовые, металличность низкая
      // 23.10: створки — текстура Codex по концепту (doors4-front + свечение рун) на ОБЕ стороны, матовый металл
      if (/gate_door_(front|back)/.test(o.material.name)) {
        const [dm, dg] = doorTex();
        o.material.map = dm; o.material.emissiveMap = dg; o.material.emissive.set(0x3fc8f0); o.material.emissiveIntensity = 0.9;
        o.material.metalness = 0.25; o.material.roughness = 0.65; o.material.color.setRGB(1.15, 1.1, 1.05); o.material.needsUpdate = true;
      }
      if (o.material.name === 'gate_iron') { o.material.metalness = 0.3; o.material.roughness = 0.6; o.material.color.multiplyScalar(1.2); }
      if (o.material.name === 'gate_inner') { o.material.color.setRGB(0.07, 0.07, 0.08); o.material.roughness = 1; }   // тоннель — темнота   // боковины блоков — в тон скал хребта
    }
  });
  gateModel = root;
}
function dwarfGate(span) {
  if (gateModel) {
    const W = Math.max(3.2, span * 0.9);              // ширина портала по раме (в модели 3.6 м)
    const v4 = !!gateModel.getObjectByName('tunnel');   // v4 (22.10): тёсаный фасад 4.8 м, скалу вокруг строит сцена
    const k = v4 ? W / 4.2 : W / 3.6;                 // рама модели v3 — 3.6 м по наружному контуру
    const g = new THREE.Group();
    const m = gateModel.clone(true);
    m.scale.setScalar(k);
    g.add(m);
    g.userData.span = W;
    g.userData.v4 = v4;
    g.userData.depth = (v4 ? 3.2 : 3.4) * k + 0.3;    // пол за воротами — до Y=3.4 модели
    return g;
  }
  const gate = new THREE.Group();
  const stoneTex = new THREE.TextureLoader().load('./data/tex-rockside-v6b.webp?v=1'); stoneTex.colorSpace = THREE.SRGBColorSpace; stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping; stoneTex.repeat.set(0.6, 0.6);
  const stone = new THREE.MeshLambertMaterial({ map: stoneTex, color: 0xc8c8c8 });
  const iron = new THREE.MeshLambertMaterial({ color: 0x2e2c2a });
  const W = Math.max(3.2, span * 0.9);              // ширина портала
  const doorW = W * 0.56, doorH = 3.0, pilW = W * 0.13, depth = 0.7;
  const face = (mat) => [stone, stone, stone, stone, mat, stone];     // +z — лицевая грань (к клетке)
  // скальный массив не моделируем коробками — за порталом стоит настоящий обрыв хребта
  // пилоны с рунами
  for (const t of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(pilW, doorH + 0.5, depth), face(gateMat('pillar')));
    pil.position.set(t * (doorW / 2 + pilW / 2), (doorH + 0.5) / 2, 0);
    gate.add(pil);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(pilW * 1.25, 0.28, depth * 1.15), stone);
    cap.position.set(t * (doorW / 2 + pilW / 2), doorH + 0.6, 0);
    gate.add(cap);
  }
  // перемычка (с камнем-ромбом по центру — на текстуре)
  const lin = new THREE.Mesh(new THREE.BoxGeometry(doorW + pilW * 2.3, 0.95, depth * 1.05), face(gateMat('lintel')));
  lin.position.set(0, doorH + 0.95 / 2 + 0.15, 0.02);
  gate.add(lin);
  // двери — утоплены в проём; скосы верхних углов — на текстуре
  const doors = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.2), face(gateMat('doors')));
  doors.position.set(0, doorH / 2, -depth / 2 + 0.05);
  gate.add(doors);
  // откосы проёма
  for (const t of [-1, 1]) {
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.08, doorH, depth * 0.9), iron);
    j.position.set(t * (doorW / 2 - 0.04), doorH / 2, 0);
    gate.add(j);
  }
  // ступени к клетке
  for (let i = 0; i < 3; i += 1) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(doorW + pilW * 2 - i * 0.25, 0.16, 0.45), i === 0 ? face(gateMat('steps')) : stone);
    st.position.set(0, 0.08 + (2 - i) * 0.14 - 0.14 * 2 + 0.28 - 0.14 * 0, depth / 2 + 0.2 + i * 0.4);
    st.position.y = 0.36 - i * 0.14;
    gate.add(st);
  }
  // жаровни по бокам ступеней (огонь — atmosphere.js по userData.torch)
  for (const t of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.42), stone);
    base.position.set(t * (doorW / 2 + pilW / 2), 0.28, depth / 2 + 0.35);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.36), iron);
    cage.position.set(t * (doorW / 2 + pilW / 2), 0.7, depth / 2 + 0.35);
    cage.userData.torch = true;
    gate.add(base, cage);
  }
  gate.userData.span = W;
  gate.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return gate;
}

// Условные домики-ориентиры (клетки с marker: хижины колод «лес», «озеро», «тёмный лес»…).
// Куб + двускатная крыша; цвет крыши — по классу колоды. Размер — чтобы фигурка (1.8) входила в дверь.
const HOUSE_W = 1.9, HOUSE_D = 1.9, HOUSE_H = 1.87;   // 22.10: домики квадратные, вход к камере (шаг 90°)  // −15% (20.10): фасад с дверью 1.7, боковые стены длиннее
const HOUSE_ROOF = { forest: 0x6b8f3a, forest_trail: 0x4f7a3a, mixed: 0xa08a4a, lake: 0x3d5a78, dark_forest: 0x5a3d6b };
function houseMesh(cls) {
  const g = new THREE.Group();
  const W = HOUSE_W, D = HOUSE_D, H = HOUSE_H;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshLambertMaterial({ color: 0x9a7650 }));
  walls.position.y = H / 2;
  // треугольная крыша: конёк вдоль дома (от двери к задней стене), над дверью — фронтон
  const shape = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.15, 0), new THREE.Vector2(W / 2 + 0.15, 0), new THREE.Vector2(0, 1.1)]);
  const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: D + 0.3, bevelEnabled: false });
  roofGeo.translate(0, 0, -(D + 0.3) / 2);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshLambertMaterial({ color: HOUSE_ROOF[cls] ?? 0x8a4a22, flatShading: true }));
  roof.position.y = H;
  // дверь на передней стене (+z — к клетке)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.77, 1.62, 0.06), new THREE.MeshLambertMaterial({ color: 0x3b2414 }));
  door.position.set(0, 0.81, D / 2 + 0.02);
  g.add(walls, roof, door);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// Гнездо феникса (клетка fairy_glade): круглое кольцо из прутьев, внутри угли и пламя.
function phoenixNest() {
  const g = new THREE.Group();
  const twigs = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.26, 7, 18).rotateX(Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x5a3a20, flatShading: true }));
  twigs.position.y = 0.26;
  const embers = new THREE.Mesh(new THREE.CircleGeometry(0.62, 18).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
  embers.position.y = 0.22;
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0xffb030 }));
  flame.position.y = 0.65;
  g.add(twigs, embers, flame);
  return g;
}
// Камень кузнеца (клетка blueprints): низкая плоская плита.
function smithStone() {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.35, 7),
    new THREE.MeshLambertMaterial({ color: 0x7a756d, flatShading: true }));
  slab.position.y = 0.17;
  g.add(slab);
  return g;
}

// Водопад: полотно воды от края уступа (река на плато) вниз к заводи. Струи бегут вниз
// (шейдер), края полупрозрачные, внизу пена. Анимация — через uniforms.time.
function waterfallMesh(lipL, lipR, poolC, topY, bottomY) {
  const width = lipL.distanceTo(lipR);
  const top = lipL.clone().add(lipR).multiplyScalar(0.5);
  const dir = new THREE.Vector3(poolC.x - top.x, 0, poolC.z - top.z);
  const run = dir.length();
  dir.normalize();
  const side = new THREE.Vector3().subVectors(lipR, lipL).normalize();
  const segs = 14;
  const pos = [], uv = [], idx = [];
  // перекрытие с водой плато: ряд вершин на 0.5 выше по течению, на уровне воды плато
  for (const k of [-0.5, 0.5]) {
    const p = top.clone().addScaledVector(side, k * width).addScaledVector(dir, -1.1);
    pos.push(p.x, topY + 0.14, p.z);
    uv.push(k + 0.5, -0.15);
  }
  for (let i = 0; i <= segs; i += 1) {
    const t = i / segs;
    // вода срывается с края и падает почти отвесно: горизонтальный вынос — в начале
    const out = run * Math.sin(t * Math.PI / 2) * 0.55 + 0.15;
    const y = topY + (bottomY - topY) * t * t * 0.4 + (bottomY - topY) * t * 0.6;
    for (const k of [-0.5, 0.5]) {
      const p = top.clone().addScaledVector(side, k * width * (1 + t * 0.25)).addScaledVector(dir, out);
      pos.push(p.x, i === 0 ? topY + 0.13 : y, p.z);
      uv.push(k + 0.5, t);
    }
    const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time; varying vec2 vUv;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      float n1(float x){ float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
      void main(){
        float cols = vUv.x * 18.0;
        float speed = 1.6 + n1(floor(cols) * 3.1) * 0.8;
        float streak = n1(cols * 1.3 + 7.0) * 0.6 + n1((vUv.y * 6.0 - time * speed) + floor(cols) * 1.7) * 0.4;
        vec3 water = mix(vec3(0.263, 0.388, 0.427), vec3(0.545, 0.706, 0.749), smoothstep(0.3, 0.6, streak));   // v6b: серебристо-голубой
        water = mix(water, vec3(0.827, 0.898, 0.906), smoothstep(0.72, 0.92, streak));
        float foam = smoothstep(0.78, 1.0, vUv.y);
        water = mix(water, vec3(1.0), foam * 0.8);
        water = mix(water, vec3(0.85, 0.97, 1.0), smoothstep(0.07, 0.0, abs(vUv.y - 0.01)) * 0.55);   // гребень на кромке
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float head = smoothstep(-0.15, 0.02, vUv.y);                 // вход с воды плато — растворяется, без плиты
        water = mix(vec3(0.27, 0.45, 0.50), water, smoothstep(-0.02, 0.06, vUv.y));   // до кромки — цвет воды плато
        gl_FragColor = vec4(water, (0.72 + 0.25 * streak) * edge * head * head);
      }`,
  });
  return new THREE.Mesh(g, mat);
}

function foamRing(center, radius) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float time; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
        float wave = fract(r * 2.5 - time * 0.6);
        float blob = h(floor(vec2(a * 6.0, r * 8.0 - time * 2.0)));
        float alpha = (1.0 - smoothstep(0.55, 1.0, r)) * (0.35 + 0.45 * step(0.55, blob)) * (0.6 + 0.4 * wave);
        gl_FragColor = vec4(vec3(1.0), alpha * 0.85);
      }`,
  });
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 32).rotateX(-Math.PI / 2), mat);
  m.position.copy(center);
  return m;
}

// Террасная скала (data/rocks.json) выкладывается отдельными камнями, как в концепте:
// каждый ярус контура заполняется крупными блоками со скруглёнными гранями, следующий
// ярус лежит на предыдущем и уже его; у основания — отдельные валуны (часть в воде).
const ROCK_TOP = new THREE.Color(0xc2baac), ROCK_SIDE = new THREE.Color(0x67625b);

// Набор камней: из этих моделей собираются и скалы, и отдельные камни.
// [пропорции x, y, z; радиус скругления; скос верха (клин); сид неровностей]
const STONE_KIT = [
  { name: 'плита', size: [1, 0.45, 0.9], R: 0.16, wedge: 0, seed: 11 },
  { name: 'блок', size: [1, 0.7, 0.85], R: 0.2, wedge: 0, seed: 12 },
  { name: 'высокий блок', size: [0.8, 1, 0.75], R: 0.18, wedge: 0, seed: 13 },
  { name: 'валун', size: [1, 0.75, 0.95], R: 0.34, wedge: 0, seed: 14 },
  { name: 'клин', size: [1, 0.7, 0.85], R: 0.18, wedge: 0.25, seed: 15 },
  { name: 'камешек', size: [1, 0.6, 0.8], R: 0.3, wedge: 0, seed: 16 },
];
// Окраска камня по нормалям: верх светлее, бока и низ темнее.
function paintStone(geo) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.computeVertexNormals();
  const n = geo.attributes.normal, cols = new Float32Array(n.count * 3), col = new THREE.Color();
  for (let i = 0; i < n.count; i += 1) {
    col.copy(ROCK_SIDE).lerp(ROCK_TOP, THREE.MathUtils.smoothstep(n.getY(i), 0.25, 0.8)).toArray(cols, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}
// Модели набора из Blender (models/stone-kit.glb, tools/blender/stone_kit.py): гексовые камни.
// Имена объектов — в том же порядке, что STONE_KIT. Размер набора берём по габаритам модели.
const KIT_NAMES = ['stone_slab', 'stone_block', 'stone_tall', 'stone_boulder', 'stone_wedge', 'stone_pebble'];
async function loadStoneKit(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return KIT_NAMES.map((name, i) => {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh?.geometry) return null;
    const geo = mesh.geometry.clone();
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    geo.translate(-(b.max.x + b.min.x) / 2, -(b.max.y + b.min.y) / 2, -(b.max.z + b.min.z) / 2);   // центр в нуле (как у процедурных)
    STONE_KIT[i].size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    // свои цвета из Blender (мох, тёмные швы) оставляем; если их нет — красим по нормалям
    for (const key of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(key)) geo.deleteAttribute(key);
    return geo.attributes.color ? geo : paintStone(geo);
  });
}

// Модель камня из набора: куб со скруглёнными рёбрами и неровными гранями; размер ~1.
function stoneBlockGeometry(kit) {
  const r = rng(kit.seed);
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 3, 4);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const R = kit.R;                                   // радиус скругления
  const jitter = new Map();
  for (let i = 0; i < p.count; i += 1) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -0.5 + R, 0.5 - R), THREE.MathUtils.clamp(v.y, -0.5 + R, 0.5 - R), THREE.MathUtils.clamp(v.z, -0.5 + R, 0.5 - R));
    v.sub(c).normalize().multiplyScalar(R).add(c);
    const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jitter.has(k)) jitter.set(k, [(r() - 0.5) * 0.08, (r() - 0.5) * 0.06, (r() - 0.5) * 0.08]);
    const [jx, jy, jz] = jitter.get(k);
    const wedgeDrop = v.y > 0 ? kit.wedge * (v.x + 0.5) : 0;      // клин: верх скошен к +x
    p.setXYZ(i, (v.x + jx) * kit.size[0], (v.y + jy - wedgeDrop) * kit.size[1], (v.z + jz) * kit.size[2]);
  }
  const geo = g.toNonIndexed();
  geo.computeVertexNormals();
  const n = geo.attributes.normal, cols = new Float32Array(n.count * 3), col = new THREE.Color();
  for (let i = 0; i < n.count; i += 1) {
    col.copy(ROCK_SIDE).lerp(ROCK_TOP, THREE.MathUtils.smoothstep(n.getY(i), 0.25, 0.8)).toArray(cols, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

// Плавный шум 0..1 (для групп деревьев на уступах).
function valueNoise2(x, y) {
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function inPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Расстояние от точки до границы многоугольника.
function edgeDist(x, z, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / L, 0, 1);
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// Каменные блоки одной скалы — список [x, y, z, sx, sy, sz, rotY, shade].
// Отдельный камень по плану (x, y — пиксели арта, rad — радиус в единицах).
function looseStone(st, toWorld, groundY, r) {
  const [x, z] = toWorld(st.x, st.y);
  const d = st.r * 2;
  const kit = d < 0.6 ? 5 : [3, 0, 1, 4][Math.floor(r() * 4)];
  const ks = STONE_KIT[kit].size;
  const h = d * (0.55 + r() * 0.25);
  // 22.10 разбор п.10: на грунте по его реальной высоте (min(0,…) топил камни на возвышенностях), утоплен на 20–35%
  const gy = groundY(x, z), bury = 0.20 + 0.15 * rockHash(Math.round(st.x), Math.round(st.y), 31);   // хеш, не общий r(): иначе сдвигается вся посадка дальше
  return [x, gy + h * (0.5 - bury), z, d / ks[0], h / ks[1], d * (0.85 + r() * 0.2) / ks[2], r() * 6.28, 0.84 + r() * 0.20, kit];
}

function terraceStones(rock, toWorld, seed) {
  const r = rng(seed);
  const stones = [];
  let base = -0.55;
  rock.levels.forEach((lv, li) => {
    const poly = lv.pts.map(([px, py]) => toWorld(px, py));
    const step = 1.75 - li * 0.15;                   // крупные камни внизу, чуть меньше наверху
    const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
    const ox = r() * step, oz = r() * step;
    const height = 0.85 + (lv.top - base - 0.85) * 0.5;
    for (let x = Math.min(...xs) - ox; x < Math.max(...xs) + step; x += step) {
      for (let z = Math.min(...zs) - oz; z < Math.max(...zs) + step; z += step * 0.92) {
        const jx = x + (r() - 0.5) * step * 0.35, jz = z + (r() - 0.5) * step * 0.35;
        if (!inPolygon(jx, jz, poly) || edgeDist(jx, jz, poly) < step * 0.28) continue;
        const sx = step * (1.0 + r() * 0.25), sz = step * (0.9 + r() * 0.3);
        const sy = Math.max(0.7, lv.top - base) * (0.95 + r() * 0.15);
        const kit = [1, 1, 0, 4, 2][Math.floor(r() * 5)];          // в ярусах — блоки, плиты, валуны, высокие
        const ks = STONE_KIT[kit].size;
        stones.push([jx, base + sy / 2, jz, sx / ks[0], sy / ks[1], sz / ks[2], (r() - 0.5) * 0.9, 0.82 + li * 0.07 + (r() - 0.5) * 0.12, kit]);
      }
    }
    base = lv.top - 0.12;
  });
  return stones;
}

// ── Цельная скала (монолит) ──
// Ярусы по контуру плана, каждый — одна плита со скруглённой фаской (без деления на камни).
// Вид сложенных плит даёт рисованная текстура: сверху — «верх скалы», по бокам — «бок скалы»
// (двухплоскостная проекция в мировых координатах, UV не нужны), смешивание по наклону грани.
function rockMaterial(topTex, sideTex, opt = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: !!opt.blocks });
  const BT = !!opt.blocks;   // монолит блоками: атрибут тона блока aBlockTone + AO у основания/подтёки
  mat.onBeforeCompile = shader => {
    shader.uniforms.rockTop = { value: topTex };
    shader.uniforms.rockSide = { value: sideTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vRockPos;
varying vec3 vRockNrm;${BT ? '\nattribute float aBlockTone; varying float vTone;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${BT ? '\nvTone = aBlockTone;' : ''}
#ifdef USE_INSTANCING
vRockPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
vRockNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
vRockPos = (modelMatrix * vec4(position, 1.0)).xyz;
vRockNrm = normalize(mat3(modelMatrix) * normal);
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D rockTop;
uniform sampler2D rockSide;
varying vec3 vRockPos;
varying vec3 vRockNrm;${BT ? '\nvarying float vTone;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 n = normalize(vRockNrm);
  float topW = smoothstep(0.45, 0.8, n.y);
  vec3 top = texture2D(rockTop, vRockPos.xz * 0.13).rgb * 1.05;   // 22.10 разбор: без пересвета верха
  // двухплоскостная проекция для боков: ось, ближе всего к нормали по горизонтали
  vec2 uvX = vec2(vRockPos.z * 0.4, vRockPos.y * 0.4), uvZ = vec2(vRockPos.x * 0.4, vRockPos.y * 0.4);   // 22.10: без растяжения — текстура v12 сама вертикальная
  float wx = abs(n.x) / (abs(n.x) + abs(n.z) + 1e-4);
  vec3 side = mix(texture2D(rockSide, uvZ).rgb, texture2D(rockSide, uvX).rgb, smoothstep(0.35, 0.65, wx)) * 1.2;
  {
  // мох: пятнами на гранях, обращённых вверх и вбок (стиль домиков)
  float mn = 0.5 + 0.5 * sin(vRockPos.x * 1.9 + sin(vRockPos.z * 1.3 + vRockPos.y) * 1.7) * sin(vRockPos.z * 1.7 - sin(vRockPos.x * 1.1) * 1.5 + vRockPos.y * 0.8);   // плавный шум, без клеток
  float mn2 = sin(vRockPos.x * 1.3 + vRockPos.y * 2.1) * sin(vRockPos.z * 1.1 - vRockPos.y * 1.7);
  float moss = smoothstep(0.15, 0.55, n.y + 0.25 * mn2) * smoothstep(0.35, 0.75, mn * 0.6 + 0.4 * (mn2 * 0.5 + 0.5));
  vec3 mossCol = vec3(0.30, 0.42, 0.16) * (0.85 + 0.3 * mn);
    top = mix(top, mossCol, moss * 0.22);      // в текстуре мох уже есть — свой только слегка
    side = mix(side, mossCol, moss * 0.3);
  }
  // реф v6b: верх и кромки камней — светлый серый камень, мох лишь пятнами (замечание 21.10)
  // 22.10 (разбор скал): сплошная светлая кромка «торта» и пересвет верха убраны
  vec3 rcol = mix(side, top, smoothstep(0.50, 0.82, n.y));
  ${BT ? `
  // тон блока (свой у каждой колонны) + AO у подошвы + подтёки вниз по отвесным граням
  rcol *= vTone * mix(vec3(1.03, 1.0, 0.96), vec3(0.96, 1.0, 1.04), fract(vTone * 9.7));
  float aoB = 1.0 - 0.32 * (1.0 - smoothstep(-0.45, 0.35, vRockPos.y));
  float vert = 1.0 - smoothstep(0.25, 0.65, abs(n.y));
  float hu = abs(n.x) > abs(n.z) ? vRockPos.z : vRockPos.x;
  float st = smoothstep(0.55, 0.78, fract(sin(floor(hu * 6.0) * 12.9898) * 43758.5) * 0.7 + fract(sin(floor(hu * 17.0) * 78.233) * 43758.5) * 0.3);
  rcol *= max(0.45, aoB) * (1.0 - 0.25 * st * vert * smoothstep(-0.4, 1.2, vRockPos.y));` : ''}
  diffuseColor.rgb *= rcol;
}`);
  };
  return mat;
}

// ── Скала блоками (22.10, разбор скал п.1–4): ярусы не сплошными плитами, а мозаикой угловатых колонн
// (Voronoi по смещённой сетке шагом ~1.45, обрезка контуром нижнего яруса), верх каждой — своя наклонная
// плоскость, высота = отметка самого высокого яруса в её центре + разброс; зазоры между колоннами — расселины,
// нижнее кольцо чуть внутрь (нависание), узкая фаска сверху. Детерминированно (хеш по координатам).
function rockHash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function clipPoly(poly, ax, az, bx, bz) {   // оставить сторону полуплоскости слева от a→b (Sutherland–Hodgman)
  const out = [], side = ([x, z]) => (bx - ax) * (z - az) - (bz - az) * (x - ax);
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i], q = poly[(i + 1) % poly.length], sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function rockBlocks(rock, toWorld) {
  const lv = rock.levels.map(l => ({ top: l.top, pts: l.pts.map(([px, py]) => toWorld(px, py)) }));
  const outer = lv[0].pts;
  if (outer.length < 3) return null;
  // ориентация контура — против часовой (для клиппинга «слева»)
  let area = 0; for (let i = 0; i < outer.length; i += 1) { const [x1, z1] = outer[i], [x2, z2] = outer[(i + 1) % outer.length]; area += x1 * z2 - x2 * z1; }
  const P = area < 0 ? outer.slice().reverse() : outer;
  const xs = P.map(p => p[0]), zs = P.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const sx = Math.round(rock.x), sz = Math.round(rock.y);
  const step = 1.45;
  const seeds = [];
  for (let gz = Math.floor(z0 / step) - 1; gz <= Math.ceil(z1 / step) + 1; gz += 1) for (let gx = Math.floor(x0 / step) - 1; gx <= Math.ceil(x1 / step) + 1; gx += 1) {
    const h1 = rockHash(gx + sx, gz + sz, 1), h2 = rockHash(gx + sx, gz + sz, 2);
    seeds.push([(gx + 0.5 + (h1 - 0.5) * 0.6) * step, (gz + 0.5 + (h2 - 0.5) * 0.6) * step, gx, gz]);
  }
  const levelTop = (x, z) => { let t = null; for (const l of lv) if (inPoly(x, z, l.pts)) t = Math.max(t ?? -9, l.top); return t; };
  const pos = [], tone = [];
  let C0 = [0, 0, 0];   // центр текущего блока — нормаль каждого треугольника разворачиваем от него наружу
  const push = (a, b, c, tn) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + c[0]) / 3 - C0[0], my = (a[1] + b[1] + c[1]) / 3 - C0[1], mz = (a[2] + b[2] + c[2]) / 3 - C0[2];
    if (nx * mx + ny * my + nz * mz < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    tone.push(tn, tn, tn);
  };
  const base = rock.base ?? -0.6;   // 22.10: скала над входом ворот висит — у неё свой низ и донная грань
  for (const [cx, cz, gx, gz] of seeds) {
    if (cx < x0 - step || cx > x1 + step || cz < z0 - step || cz > z1 + step) continue;
    // ячейка Voronoi: контур скалы, обрезанный полуплоскостями к соседним семенам
    let cell = P.map(p => [p[0], p[1]]);
    for (const [ox, oz] of seeds) {
      if (ox === cx && oz === cz) continue;
      const dx = ox - cx, dz = oz - cz; if (dx * dx + dz * dz > (step * 2.6) ** 2) continue;
      const mx = (cx + ox) / 2, mz = (cz + oz) / 2;
      // граница — перпендикуляр к (dx,dz) через середину; оставляем сторону семени cx,cz
      cell = clipPoly(cell, mx + dz, mz - dx, mx - dz, mz + dx);   // сторона, где лежит само семя
      if (cell.length < 3) break;
    }
    if (cell.length < 3) continue;
    let ca = 0, ccx = 0, ccz = 0;
    for (let i = 0; i < cell.length; i += 1) { const [ax, az] = cell[i], [bx, bz] = cell[(i + 1) % cell.length]; const cr = ax * bz - bx * az; ca += cr; ccx += (ax + bx) * cr; ccz += (az + bz) * cr; }
    if (Math.abs(ca) < 0.06) continue;                     // огрызок
    ccx /= 3 * ca; ccz /= 3 * ca;
    const lt = levelTop(ccx, ccz) ?? lv[0].top;
    const q = k => rockHash(gx + sx, gz + sz, k);
    const wide = q(3) < 0.15;                               // широкая расселина
    const gap = wide ? 0.09 + 0.04 * q(4) : 0.03 + 0.02 * q(4);
    // сжать к центроиду на зазор (половина с каждой стороны)
    const shrink = (poly, d) => poly.map(([x, z]) => { const vx = x - ccx, vz = z - ccz, L = Math.hypot(vx, vz) || 1; const k = Math.max(0.2, (L - d) / L); return [ccx + vx * k, ccz + vz * k]; });
    const topPoly = shrink(cell, gap);
    const botPoly = shrink(cell, gap + 0.06 + 0.10 * q(5));   // нависание: низ уже верха
    const T = lt + 0.22 * (2 * q(6) - 1) + 0.10 * (2 * q(7) - 1);
    const ta = Math.tan(8 * Math.PI / 180) * (2 * q(8) - 1), tb = Math.tan(6 * Math.PI / 180) * (2 * q(9) - 1);
    const topY = (x, z, i) => T + Math.max(-0.15, Math.min(0.15, ta * (x - ccx) + tb * (z - ccz))) + 0.035 * (2 * rockHash(gx + sx + i, gz + sz, 10) - 1);
    const tn = 0.86 + 0.26 * q(11);
    const n = topPoly.length;
    const ring = (poly, y) => poly.map(([x, z], i) => [x, typeof y === 'function' ? y(x, z, i) : y, z]);
    C0 = [ccx, (base + T) / 2, ccz];
    const B = ring(botPoly, base), M = ring(topPoly, (x, z, i) => topY(x, z, i) - 0.07), U = ring(shrink(topPoly, 0.05), topY);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      push(B[i], B[j], M[j], tn); push(B[i], M[j], M[i], tn);      // бок
      push(M[i], M[j], U[j], tn); push(M[i], U[j], U[i], tn);      // фаска
    }
    const cTop = [ccx, topY(ccx, ccz, 99) + 0.04, ccz];
    for (let i = 0; i < n; i += 1) push(U[i], U[(i + 1) % n], cTop, tn);   // крышка веером
    if (rock.base !== undefined) { const cB = [ccx, base, ccz]; for (let i = 0; i < n; i += 1) push(B[i], B[(i + 1) % n], cB, tn); }   // низ нависания
  }
  // обход граней мог оказаться обратным: ориентируем по нормали наружу/вверх при сборке
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBlockTone', new THREE.Float32BufferAttribute(tone, 1));
  return g;
}
function rockMonolith(rock, toWorld, seed, material) {
  const bg = rockBlocks(rock, toWorld);
  if (bg) {
    bg.computeVertexNormals();   // flat: у каждого треугольника свои вершины
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(bg, material);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return g;
  }
  return rockMonolithSlabs(rock, toWorld, seed, material);
}
function rockMonolithSlabs(rock, toWorld, seed, material) {
  const r = rng(seed);
  const g = new THREE.Group();
  let base = -0.6;
  rock.levels.forEach((lv, li) => {
    const shape = new THREE.Shape();
    lv.pts.forEach(([px, py], i) => {
      const [x, z] = toWorld(px, py);
      const j = 0.06 * (r() - 0.5);
      if (i === 0) shape.moveTo(x + j, -(z + j)); else shape.lineTo(x + j, -(z + j));
    });
    const top = lv.top + (r() - 0.5) * 0.1;
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.3, top - base), bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 1, curveSegments: 1,   // 22.10: узкая фаска (широкая давала «торт»)
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, base, 0);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    base = top - 0.32;
  });
  return g;
}

// ── Модули обрыва хребта (models/cliff-kit.glb, tools/blender/cliff_kit.py) ──
// Материал: бока — рисованная скала (двухплоскостная проекция), верх — трава «колпаком»
// (по нормали в мировых координатах), всё в мировых координатах — UV не нужны.
const CLIFF_NAMES = ['cliff_straight_a', 'cliff_straight_b', 'cliff_straight_c', 'cliff_corner', 'cliff_column', 'cliff_end'];
function cliffMaterial(sideTex, grassTex) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  mat.onBeforeCompile = shader => {
    shader.uniforms.cliffSide = { value: sideTex };
    shader.uniforms.cliffGrass = { value: grassTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vCPos;
varying vec3 vCNrm;
varying float vCLocY; varying float vCTone;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vCLocY = position.y;   // модуль нормирован: 0 — низ, 1 — верх
#ifdef USE_INSTANCING
vCTone = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);   // свой тон у модуля
#else
vCTone = 0.5;
#endif
#ifdef USE_INSTANCING
vCPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
vCNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
vCPos = (modelMatrix * vec4(position, 1.0)).xyz;
vCNrm = normalize(mat3(modelMatrix) * normal);
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D cliffSide;
uniform sampler2D cliffGrass;
varying vec3 vCPos;
varying vec3 vCNrm;
varying float vCLocY; varying float vCTone;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 n = normalize(vCNrm);
  vec2 uvX = vec2(vCPos.z * 0.4, vCPos.y * 0.4), uvZ = vec2(vCPos.x * 0.4, vCPos.y * 0.4);
  // трёхплоскостная проекция: веса — по нормали самой грани (сглаженная нормаль вершин у модулей
  // скал расходится с гранью, и камень проецировался вдоль стены — полосы-«лесенка»)
  vec3 fc = cross(dFdx(vCPos), dFdy(vCPos)); float fl = length(fc);
  vec3 fn = fl > 1e-9 ? fc / fl : n;
  vec3 tw = pow(abs(fn), vec3(6.0)); tw /= (tw.x + tw.y + tw.z + 1e-4);
  vec3 side = (texture2D(cliffSide, uvX).rgb * tw.x + texture2D(cliffSide, vCPos.xz * 0.17).rgb * tw.y + texture2D(cliffSide, uvZ).rgb * tw.z) * 1.30 * vec3(0.95, 0.98, 1.04);
  side = mix(vec3(dot(side, vec3(0.3, 0.59, 0.11))), side, 0.6);   // серее
  side *= mix(0.78, 1.08, clamp(vCPos.y / 6.5, 0.0, 1.0));          // низ темнее, верх светлее
  // верх уступа — камень с мхом и лишайником (tex-rocktop), не газон; редкие пятна травы
  vec3 rtop = mix(texture2D(cliffGrass, vCPos.xz * 0.13).rgb,
                  texture2D(cliffGrass, mat2(0.8, -0.6, 0.6, 0.8) * vCPos.xz * 0.071 + 0.37).rgb, 0.4);
  float gp = smoothstep(0.6, 0.9, sin(vCPos.x * 0.43 + 1.3) * sin(vCPos.z * 0.37 + 0.7) * 0.5 + 0.5);
  vec3 grass = mix(rtop, rtop * vec3(0.8, 1.05, 0.7), gp * 0.6);
  float g = smoothstep(0.55, 0.8, n.y);
  // мох: пятнами на гранях, обращённых вверх и вбок (стиль домиков)
  float mn = 0.5 + 0.5 * sin(vCPos.x * 1.9 + sin(vCPos.z * 1.3 + vCPos.y) * 1.7) * sin(vCPos.z * 1.7 - sin(vCPos.x * 1.1) * 1.5 + vCPos.y * 0.8);   // плавный шум, без клеток
  float mn2 = sin(vCPos.x * 1.3 + vCPos.y * 2.1) * sin(vCPos.z * 1.1 - vCPos.y * 1.7);
  float moss = smoothstep(0.15, 0.55, n.y + 0.25 * mn2) * smoothstep(0.35, 0.75, mn * 0.6 + 0.4 * (mn2 * 0.5 + 0.5));
  vec3 mossCol = vec3(0.30, 0.42, 0.16) * (0.85 + 0.3 * mn);
  side = mix(side, mossCol, moss * (1.0 - g) * 0.17);   // реф: мха на вертикалях вдвое меньше
  // реф v6b: верх уступа и его кромка — светлый камень (мох пятнами), не тёмный мшистый ковёр
  vec3 cc = mix(side, grass, g);   // 22.10: без светлой кромки и пересвета верха
  // разбор скал п.7–8: тон модуля, AO у подошвы, подтёки вниз по отвесным граням
  cc *= mix(0.86, 1.12, vCTone) * mix(vec3(1.03, 1.0, 0.96), vec3(0.96, 1.0, 1.04), fract(vCTone * 9.7));
  cc *= 1.0 - 0.30 * (1.0 - smoothstep(0.0, 0.35, vCLocY));
  float vert = 1.0 - smoothstep(0.25, 0.65, abs(fn.y));
  float hu = abs(fn.x) > abs(fn.z) ? vCPos.z : vCPos.x;
  float st = smoothstep(0.58, 0.78, fract(sin(floor(hu * 5.0) * 12.9898) * 43758.5) * 0.7 + fract(sin(floor(hu * 13.0) * 78.233) * 43758.5) * 0.3);
  cc *= 1.0 - 0.24 * st * vert * smoothstep(0.15, 0.85, vCLocY + 0.25 * fract(sin(floor(hu * 3.0)) * 913.7));
  diffuseColor.rgb *= cc;
}`);
  };
  return mat;
}
async function loadCliffKit(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  return CLIFF_NAMES.map(name => {
    const m = gltf.scene.getObjectByName(name);
    if (!m?.geometry) return null;
    const g = m.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal'].includes(key)) g.deleteAttribute(key);
    return g;
  });
}

// ── Набор деревьев (models/tree-kit.glb, tools/blender/tree_kit.py) и биомы по колодам ──
async function loadKitGeos(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const out = {};
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key);
    // цвета в Blender заданы как sRGB — переводим в линейные, иначе деревья блёклые
    const c = g.attributes.color;
    if (c) for (let i = 0; i < c.count; i += 1) c.setXYZ(i, Math.pow(c.getX(i), 2.2), Math.pow(c.getY(i), 2.2), Math.pow(c.getZ(i), 2.2));
    out[o.name] = g;
  });
  return out;
}
// Колода клетки -> биом леса вокруг неё (цель-арт: paintover-biomes-spires-v2-overview.png).
const DECK_BIOME = { forest: 'forest', dark_forest: 'dark', forest_trail: 'birch', mixed: 'autumn', lake: 'lake', sheep: 'meadow', fairy_glade: 'fairy' };
// Состав видов по биомам: [имя модели, вес]. Высоты видов — в TREE_H.
// Состав по биомам — по замерам концепта v6b (outputs/board3d-concept/zones/answer.md)
const BIOME_MIX = {
  forest: [['tree_spruce', 6], ['tree_pine', 0.5], ['tree_birch', 3], ['tree_autumn_orange', 0.3]],   // реф: красная осень только справа
  dark: [['tree_spruce_dark', 4.5], ['tree_dead', 2.5], ['tree_snag', 4], ['tree_spruce', 0.5]],   // коряг много (решение 20.10), елей меньше
  birch: [['tree_birch', 9], ['tree_spruce', 1.2]],      // зона D рефа: сплошь золотые берёзы, редкие ели
  autumn: [['tree_autumn_red', 4], ['tree_autumn_orange', 3.5], ['tree_spruce', 2], ['tree_dead', 0.3]],   // зона F: 50% красно-оранжевые, ели вкраплениями
  lake: [['tree_willow', 5.5], ['tree_spruce', 2], ['tree_autumn_orange', 1.5], ['tree_birch', 1]],
  meadow: [['tree_spruce', 7], ['tree_birch', 2], ['tree_autumn_red', 1.5], ['tree_autumn_orange', 1.5]],
  fairy: [['tree_fairy_pink', 1], ['tree_fairy_violet', 1], ['tree_fairy_teal', 1], ['tree_fairy_gold', 1],
    ['tree_fairy_mushroom', 1], ['tree_fairy_crystal', 0.8], ['tree_fairy_willow', 0.8], ['tree_fairy_lantern', 0.8]],
  ridge: [['tree_spruce', 7], ['tree_spruce_dark', 3]],      // реф v6b (answer-ridge.md): густые тёмные ели, без тонких сосен
};
// доля мест, где дерево остаётся (замеры v6b: деревьев в 1,3–2 раза меньше)
const BIOME_KEEP = { forest: 0.75, dark: 1, birch: 1, autumn: 1, lake: 0.85, meadow: 1, fairy: 1, ridge: 1 };

const TREE_H = {
  tree_spruce: [2.9, 4.1], tree_spruce_dark: [3.0, 4.4], tree_pine: [3.4, 4.4], tree_birch: [2.6, 3.4],
  tree_autumn_orange: [2.4, 3.2], tree_autumn_red: [2.4, 3.2], tree_autumn_yellow: [2.4, 3.2],
  tree_willow: [3.2, 4.0],   /* 21.10: ива заметно выше камыша */ tree_dead: [2.2, 3.2], tree_bush: [0.7, 1.0], tree_snag: [0.75, 1.1], tree_dry_bush: [0.6, 0.95], tree_oak_green: [2.6, 3.4],
  tree_fairy_pink: [2.6, 3.6], tree_fairy_violet: [2.6, 3.6], tree_fairy_teal: [2.6, 3.6], tree_fairy_gold: [2.6, 3.6],
  tree_fairy_mushroom: [1.8, 2.6], tree_fairy_crystal: [2.3, 3.2], tree_fairy_willow: [2.3, 3.1], tree_fairy_lantern: [2.4, 3.3],
};
// Деревья-картинки (камера только спереди): рисованные Codex спрайты на плоскостях,
// повёрнутых к камере вокруг вертикали. Атлас: data/tree-sprites.png + .json
// (tools/board3d_tree_atlas.py): frames[{name, x, y, w, h}] в долях атласа.
// Вид из набора моделей -> группа кадров атласа.
const SPRITE_GROUP = {
  tree_spruce: 'spruce', tree_spruce_dark: 'dark', tree_pine: 'pine', tree_birch: 'birch',
  tree_autumn_orange: 'autumn_orange', tree_autumn_red: 'autumn_red', tree_autumn_yellow: 'autumn_yellow',
  tree_willow: 'willow', tree_dead: 'dead', tree_bush: 'bush', tree_snag: 'snag', tree_dry_bush: 'dry_bush', tree_oak_green: 'oak_green',
  tree_fairy_pink: 'fairy_pink', tree_fairy_violet: 'fairy_violet', tree_fairy_teal: 'fairy_teal', tree_fairy_gold: 'fairy_gold',
  tree_fairy_mushroom: 'fairy_mushroom', tree_fairy_crystal: 'fairy_crystal', tree_fairy_willow: 'fairy_willow', tree_fairy_lantern: 'fairy_lantern',
};
// Плоские картинки, лежащие на поверхности (кувшинки): квадрат по XZ, кадр атласа, альфа-срез.
function flatDecals(list, atlasTex, frames) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, null, list.length);
  const rects = new Float32Array(list.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((t, i) => {
    const f = frames[t.pick % frames.length];
    const aspect = (f.w * atlasTex.image.width) / (f.h * atlasTex.image.height);
    m.compose(pos.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.rot), sc.set(t.size * aspect, 1, t.size));
    mesh.setMatrixAt(i, m);
    rects.set([f.x, f.y, f.w, f.h], i * 4);
  });
  geo.setAttribute('uvRect', new THREE.InstancedBufferAttribute(rects, 4));
  mesh.material = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlasTex } },
    vertexShader: `attribute vec4 uvRect; varying vec2 vUv;
      void main(){ vUv = vec2(uvRect.x + uv.x * uvRect.z, uvRect.y + uv.y * uvRect.w);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D atlas; varying vec2 vUv;
      void main(){ vec4 c = texture2D(atlas, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  mesh.renderOrder = 3;
  return mesh;
}

// грейд пород под концепт v6b: [сдвиг оттенка, насыщенность ×, яркость ×]
const SPRITE_GRADE = {   // новые породы (sheet6b-*) уже в цветах рефа — правим только старые
  spruce: [0.0, 0.8, 0.72], dark: [0.0, 0.75, 0.6],   // реф: ели темнее и глуше
  autumn_red: [0.03, 0.95, 0.85], autumn_orange: [0.015, 1.0, 0.9],
  birch: [0.0, 1.0, 1.0],      // берёзы v3 уже в тоне рефа   // реф: тёплый красно-оранжевый, не малиновый
  pine: [0.02, 0.9, 0.66], oak_green: [0.0, 0.9, 0.7], autumn_yellow: [-0.02, 1.2, 0.95],
  fern: [0.02, 0.9, 0.7], snag: [0, 0.8, 0.75],
  shrub: [0.0, 1.0, 1.25], bush: [0.0, 1.0, 1.25],   // 22.10: новый лист кустов (Codex, с альфой) уже тусклый — не глушить, а чуть высветлить   // разбор «парка» п.5: салатовые кусты приглушить
}
function billboardTrees(list, atlasTex, frames, { writeDepth = false } = {}) {
  // list: [{x, y, z, h, group, tint}]
  const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, null, list.length);
  const rects = new Float32Array(list.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  const byGroup = {};
  for (const f of frames) (byGroup[f.group] ??= []).push(f);
  for (const t of list) {
    const grp = t.group === 'bush' && byGroup.shrub ? 'shrub' : t.group;   // круглые садовые кусты -> дикие (21.10)
    if (grp === 'shrub' && !t.shrubScaled) { t.h = Math.min(t.h * 1.1, 0.95); t.shrubScaled = true; }   // куст не выше молодой ели (22.10: двойное приглушение убрано — новый лист и так тёмный, кусты чернели)
    // 24.10: единый тон зелени к рефу — ивы, кувшинки, камыш глуше и темнее (для всех посадок, один раз)
    const PG = { willow: [0.0, 0.62, 0.76], young_willow: [0.0, 0.62, 0.76], lily: [0.0, 0.6, 0.78], reeds: [0.01, 0.55, 0.72] }[grp];
    if (PG && !t.pg && t.tint) { t.tint = [t.tint[0] + PG[0], t.tint[1] * PG[1], t.tint[2] * PG[2]]; t.pg = true; }
    const opts = byGroup[grp] ?? byGroup.spruce ?? frames;
    t.frame = opts[t.pick % opts.length];
    t.aspect = (t.frame.w * atlasTex.image.width) / (t.frame.h * atlasTex.image.height);
  }
  const rectAttr = new THREE.InstancedBufferAttribute(rects, 4);
  const tintArr = new Float32Array(list.length * 4);
  const tintAttr = new THREE.InstancedBufferAttribute(tintArr, 4);
  geo.setAttribute('uvRect', rectAttr);
  geo.setAttribute('tint', tintAttr);
  // Порядок отрисовки — от дальних к ближним по глубине вдоль взгляда камеры (с учётом высоты:
  // деревья на хребте ближе к камере). Пересортировка, когда камера заметно сдвинулась.
  const fwd = new THREE.Vector3(), last = new THREE.Vector3(Infinity, 0, 0), lastF = new THREE.Vector3();
  mesh.userData.resort = camera => {
    // «Y-sort», как в 2.5D-играх: порядок задаётся один раз по мировой оси «к зрителю» (+z; камера
    // всегда спереди, азимут ±15°) и от камеры не зависит — соседние деревья никогда не меняются
    // местами при сдвиге, зуме и повороте. Развязка равных — по x (постоянная).
    if (list.sorted) return;
    list.sorted = true;
    for (const t of list) t.depth = -(t.z - t.y * 0.35) + t.x * 1e-4;   // выше на склоне — чуть ближе
    list.sort((a, b) => b.depth - a.depth);
    list.forEach((t, i) => {
      m.compose(pos.set(t.x, t.y - 0.05, t.z), q, sc.set(t.h * t.aspect, t.h, 1));
      mesh.setMatrixAt(i, m);
      rects.set([t.frame.x, t.frame.y, t.frame.w, t.frame.h], i * 4);
      tintArr.set([...t.tint, t.shade ?? 1], i * 4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    rectAttr.needsUpdate = true;
    tintAttr.needsUpdate = true;
  };
  mesh.material = new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlasTex } },
    // Алгоритм художника: деревья рисуются последними, от дальних к ближним (resort ниже),
    // между собой глубину НЕ пишут — ближнее дерево целиком ложится поверх дальнего, не
    // пересекаясь; с остальным миром (скалы, дома, мелочь) проверка глубины остаётся.
    transparent: !writeDepth, depthWrite: writeDepth, depthTest: true,
    // Плоскость параллельна экрану (векторы «вправо»/«вверх» камеры) — нет наклона из-за
    // перспективы и плоскости соседних деревьев не протыкают друг друга. Глубина всего дерева —
    // глубина его основания: деревья перекрывают друг друга и склоны по месту, где стоят.
    vertexShader: `attribute vec4 uvRect; attribute vec4 tint; varying vec2 vUv; varying vec4 vTint; varying float vH;
      void main(){
        vec3 base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float w = length(instanceMatrix[0].xyz), h = length(instanceMatrix[1].xyz);
        // ось дерева — вертикаль мира (как у домов), все деревья смотрят в одну сторону —
        // по направлению взгляда камеры (не на её точку: нет «веера» по краям экрана);
        // высота компенсирует наклон камеры, чтобы дерево не сплющивалось
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 right = normalize(vec3(camRight.x, 0.0, camRight.z));
        vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float k = clamp(1.0 / max(length(fwd.xz), 0.55), 1.0, 1.6);
        vec3 upv = vec3(0.0, 1.0, 0.0);
        vec3 p = base + right * position.x * w + upv * position.y * h * k;
        vUv = vec2(uvRect.x + uv.x * uvRect.z, uvRect.y + uv.y * uvRect.w);
        vTint = tint; vH = uv.y;
        // глубина дерева = глубина основания, сдвинутого к камере (~радиус кроны у земли):
        // всё, что стоит за стволом, остаётся за деревом
        // глубина — как у настоящего вертикального дерева (верх кроны ближе к камере, чем основание):
        // иначе стена уступа выше-сзади дерева оказывалась «ближе» основания и срезала крону
        vec3 vert = base + upv * position.y * h * k;
        vec4 cb = projectionMatrix * viewMatrix * vec4(vert + normalize(cameraPosition - base) * 0.45, 1.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        gl_Position.z = (cb.z / cb.w) * gl_Position.w;
      }`,
    fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying vec4 vTint; varying float vH;
      vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
      vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
      void main(){ vec4 c = texture2D(atlas, vUv); if (c.a < ALPHA_CUT) discard;
        // 24.10 разбор п.6: контраст деталей листвы ×0.5 — смесь с грубым mip (общая масса кроны, без крапа)
        c.rgb = mix(texture2D(atlas, vUv, 2.0).rgb, c.rgb, 0.8);   // 24.10: деревья погасли — деталь почти вернул
        vec3 hsv = rgb2hsv(c.rgb);
        // сдвиг оттенка — только у насыщенных пикселей: у тёмной малонасыщенной хвои оттенок неустойчив,
        // и сдвиг уводил её в розовый (новые ели v6b)
        hsv.x = fract(hsv.x + vTint.x * smoothstep(0.25, 0.5, hsv.y)); hsv.y = clamp(hsv.y * vTint.y, 0.0, 1.0); hsv.z *= vTint.z;
        // п.5: зелень и цветочки — насыщенность ×0.75 (осенние красно-жёлтые оттенки не трогаем — это акценты рощ)
        float green = smoothstep(0.14, 0.2, hsv.x) * (1.0 - smoothstep(0.45, 0.55, hsv.x));
        float violet = smoothstep(0.70, 0.78, hsv.x) * (1.0 - smoothstep(0.92, 0.98, hsv.x));
        hsv.y *= 1.0 - 0.08 * green - 0.30 * violet;
        // затенение: низ кроны и ствол темнее (окклюзия), в густой роще всё дерево темнее (vTint.w)
        hsv.z *= mix(0.62, 1.0, smoothstep(0.0, 0.55, vH)) * vTint.w;
        vec3 rgb = hsv2rgb(hsv);
        // грейд под концепт v6b: темнее, чуть холоднее и приглушённее (картинки не видят освещение сцены)
        float lum = dot(rgb, vec3(0.3, 0.59, 0.11));
        rgb = rgb * vec3(0.95, 0.94, 0.90);   // 24.10: светлее — лес не гаснет   // нейтрально-тёплый: холодный грейд и обесцвечивание уводили охру берёз в лосось
        { // раунд 2 п.5: осенняя листва сочнее (+12% цветности, +8% яркости), хвоя не трогается
          float autumn = smoothstep(0.025, 0.12, rgb.r - rgb.b) * smoothstep(-0.015, 0.06, rgb.r - rgb.g) * smoothstep(0.08, 0.28, rgb.r);
          float leafY = dot(rgb, vec3(0.3, 0.59, 0.11));
          vec3 rich = max(mix(vec3(leafY), rgb, 1.12), vec3(0.0));
          rich *= leafY / max(dot(rich, vec3(0.3, 0.59, 0.11)), 1e-4) * 1.08;
          rgb = mix(rgb, min(rich, vec3(1.0)), autumn); }
        { float goldRatio = rgb.g / max(rgb.r, 1e-4);   // раунд 3: золото рощ ярче
          float gold = smoothstep(0.025, 0.12, rgb.r - rgb.b) * smoothstep(0.015, 0.08, rgb.g - rgb.b) * smoothstep(0.58, 0.78, goldRatio) * (1.0 - smoothstep(0.98, 1.12, goldRatio)) * smoothstep(0.12, 0.35, rgb.r);
          rgb = mix(rgb, min(rgb * vec3(1.08, 1.10, 1.02), vec3(1.0)), gold); }
        gl_FragColor = vec4(rgb, c.a);
        #include <colorspace_fragment>
      }`,
  });
  mesh.material.defines = { ALPHA_CUT: writeDepth ? '0.5' : '0.02' };
  mesh.frustumCulled = false;
  // деревья — последними; папоротники пишут глубину (по основанию) и рисуются раньше — так деревья
  // и папоротники перекрывают друг друга правильно, хотя это разные сетки
  mesh.renderOrder = writeDepth ? 9 : 10;
  return mesh;
}

// «Гиблиевский» дуб (tools/blender/ghibli_tree.py): листовые карточки с альфа-срезом,
// нормали от центров облачков (мягкий объёмный свет), ветер в вершинном шейдере.
// Рисуется как непрозрачный с записью глубины + alpha-to-coverage — без сортировки.
const windUniform = { value: 0 };
function addWind(mat, strength, vcScale = 1) {
  // three.js кэширует программу по тексту onBeforeCompile — у разных strength/vcScale он одинаковый
  mat.customProgramCacheKey = () => `wind:${strength}:${vcScale}`;
  mat.onBeforeCompile = shader => {
    shader.uniforms.time = windUniform;
    // обратная сторона карточки не переворачивает нормаль: у кроны нормали «сферы» (руководство, подводные камни)
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize( vNormal );\n#endif');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;')
      // цвет вершин хранится /vcScale — так глубина может и осветлять (до ×vcScale), не только темнить
      .replace('#include <color_vertex>', vcScale !== 1 ? `#include <color_vertex>\n  vColor.rgb *= ${vcScale.toFixed(2)};` : '#include <color_vertex>')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        // фаза — от положения дерева, сила — от высоты точки в дереве
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = ip.x * 0.37 + ip.z * 0.53;
        float hgt = max(position.y - 0.25, 0.0);
        float sw = sin(time * 1.3 + ph) * 0.6 + sin(time * 2.1 + ph * 1.7 + position.x * 6.0) * 0.4;
        transformed.x += sw * hgt * ${strength.toFixed(3)};
        transformed.z += cos(time * 1.1 + ph) * hgt * ${(strength * 0.5).toFixed(3)};
      }`);
  };
  return mat;
}

function pickWeighted(list, r) {
  const total = list.reduce((a, [, w]) => a + w, 0);
  let t = r() * total;
  for (const [name, w] of list) { t -= w; if (t <= 0) return name; }
  return list[list.length - 1][0];
}

export async function buildTerrain({ cells, cellById, groundX0, groundZ0, groundW, groundH, groundTex, maskUrl, cliffUrl, heightUrl, planUrl, upperRiverUrl, rocksUrl, modeledRocks = [], stoneKitUrl, rockStyle = 'stones', rockTopUrl, rockSideUrl, cliffKitUrl, cliffTexUrl, grassUrl, treeKitUrl, groundTextures, waterDistUrl, spireKitUrl, propKitUrl, treeSpritesUrl, treesUrl, leafAtlasUrl, kitTreesUrl, kitLodUrl, gateModelUrl }) {
  const sheepSpots = [];
  // набор камней из Blender грузим первым: размеры набора нужны при расстановке
  const kitGeos = stoneKitUrl ? await loadStoneKit(stoneKitUrl).catch(() => null) : null;
  // рисованные текстуры камня (Codex): скалы, камни и стены хребта
  const loadTex = async url => {
    const t = await new THREE.TextureLoader().loadAsync(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
  };
  const [rockTopTex, rockSideTex] = rockTopUrl && rockSideUrl ? await Promise.all([loadTex(rockTopUrl), loadTex(rockSideUrl)]) : [null, null];
  const T = { start: performance.now() };
  const mark = name => { T[name] = Math.round(performance.now() - T.start); window.__loadStage?.(name); };
  const [mask, cliffMask, heightMap] = await Promise.all([loadMask(maskUrl), loadMask(cliffUrl), heightUrl ? loadMask(heightUrl) : null]);
  mark('masks');
  // билинейная выборка из маски — края воды и леса гладкие
  const bilinear = (img, x, z, ch) => {
    const u = THREE.MathUtils.clamp((x - groundX0) / groundW, 0, 0.9999);
    const v = THREE.MathUtils.clamp((z - groundZ0) / groundH, 0, 0.9999);
    const fx = u * (img.w - 1), fy = v * (img.h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (xx, yy) => img.data[(yy * img.w + xx) * 4 + ch] / 255;
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const sampleMask = (x, z) => {
    const u = THREE.MathUtils.clamp((x - groundX0) / groundW, 0, 0.9999);
    const v = THREE.MathUtils.clamp((z - groundZ0) / groundH, 0, 0.9999);
    const fx = u * (mask.w - 1), fy = v * (mask.h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const at = (xx, yy, ch) => mask.data[(yy * mask.w + xx) * 4 + ch] / 255;
    const lerp2 = ch => {
      const a = at(x0, y0, ch), b = at(x0 + 1, y0, ch), c = at(x0, y0 + 1, ch), d = at(x0 + 1, y0 + 1, ch);
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    return { water: lerp2(0), forest: lerp2(1), rock: lerp2(2) };
  };

  // Направление тропы через клетку — по двум самым дальним соседям.
  const pathDir = c => {
    const ns = (c.neighbors ?? []).map(n => cellById.get(n)).filter(Boolean);
    const dir = new THREE.Vector2(1, 0);
    if (ns.length >= 2) {
      let best = -1;
      for (const a of ns) for (const b of ns) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > best) { best = d; dir.set(b.x - a.x, b.z - a.z); }
      }
    } else if (ns.length === 1) dir.set(ns[0].x - c.x, ns[0].z - c.z);
    return dir.normalize();
  };
  // Мостовая клетка: вода по обе стороны поперёк тропы (нарисованный мост на карте
  // коричневый, поэтому сам центр клетки водой не считается).
  const bridgeIds = new Set(cells.filter(c => {
    const d = pathDir(c);
    const px = -d.y, pz = d.x;
    const side = k => Math.max(sampleMask(c.x + px * k, c.z + pz * k).water, sampleMask(c.x + px * k * 1.5, c.z + pz * k * 1.5).water);
    return side(1.4) > 0.3 && side(-1.4) > 0.3;   // 0.3: после сглаживания маски воды (21.10) у каменного моста ~0.4
  }).map(c => c.id));
  const bridgeCells = [...bridgeIds].map(id => cellById.get(id));
  // Под мостом река продолжается: добавляем воду в маску вокруг мостовых клеток.
  const sample = (x, z) => {
    const m = sampleMask(x, z);
    for (const c of bridgeCells) {
      const d = Math.hypot(c.x - x, c.z - z);
      // под каменным и бревенчатым мостом русло шире (21.10): вода на ~3 ед. вокруг клетки-моста;
      // клетки суши остаются сухими — их держит heightFromMap (у клеток земля ровная)
      if (d < 1.6) m.water = Math.max(m.water, 1 - THREE.MathUtils.smoothstep(d, 1.1, 1.6));
    }
    return m;
  };
  const nearest = cellIndex(cells);
  mark('bridges');
  const nearestLand = (x, z) => nearest(x, z, c => !bridgeIds.has(c.id));

  const group = new THREE.Group();

  // ── Земля: плоско везде, кроме воды; у клеток всегда ровно ──
  const seg = 300;   // шаг сетки ~0.27: уже спуска клетка→русло, иначе край воды лесенкой (21.10)
  const groundGeo = new THREE.PlaneGeometry(groundW, groundH, seg, Math.round(seg * groundH / groundW));
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(groundX0 + groundW / 2, 0, groundZ0 + groundH / 2);
  // Обрыв (data/terrain-cliff.png — каменный массив у края карты): поднимаем саму
  // землю в плато, нарисованные стены обрыва ложатся на склон. Узкие полоски
  // (песок у берега) отсекаются средним по кольцу.
  const RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 1.5, Math.sin(i * Math.PI / 4) * 1.5]);
  const cliffAt = (x, z) => {
    const here = bilinear(cliffMask, x, z, 0);
    if (here < 0.05) return 0;
    let sum = here;
    for (const [dx, dz] of RING) sum += bilinear(cliffMask, x + dx, z + dz, 0);
    return THREE.MathUtils.smoothstep(here, 0.3, 0.7) * THREE.MathUtils.smoothstep(sum / 9, 0.55, 0.8)
      * THREE.MathUtils.smoothstep(nearestLand(x, z), 1.6, 3.0);
  };
  const RING_ROCK = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 1.1, Math.sin(i * Math.PI / 4) * 1.1]);
  // Карта высот (data/terrain-height.png): собрана скриптом
  // tools/board3d_heightmap_from_zones.py из карты зон от Codex. Яркость = только высота:
  // h = v / 255 * 8 - 1 (земля 0, вода до -0.9, хребет — три террасы 2.1 / 4.3 / 6.4).
  const fromHeightMap = v => v * 8 - 1;
  const WBLUR = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4) * 0.45, Math.sin(i * Math.PI / 4) * 0.45]);
  const heightFromMap = (x, z) => {
    const m = sample(x, z);
    let h = fromHeightMap(bilinear(heightMap, x, z, 0));
    const dLand = nearestLand(x, z);
    // у клеток всегда ровно (и не опускаем, и не поднимаем). Вниз (вода) — только в пределах самого гекса:
    // раньше ровный пояс 1.5 рвал узкие русла между клетками на лужи (21.10); вверх (холмы) — как раньше
    h *= h < 0 ? THREE.MathUtils.smoothstep(dLand, 0.78, 1.2) : THREE.MathUtils.smoothstep(dLand, 1.0, 1.5);
    // под мостом — река (на карте высот мост нарисован полосой земли)
    // плавно, без порога: жёсткое «water > 0.5» давало обрыв 0 → -0.45 между узлами сетки — край воды лесенкой (21.10)
    // маска воды почти двоичная (512 px) — размываем выборкой по кругу r≈0.45, иначе склон уже шага сетки
    let wb = m.water * 0.2;
    for (const [dx, dz] of WBLUR) wb += sample(x + dx, z + dz).water * 0.1;
    if (wb > 0.15) h = Math.min(h, WATER_FLOOR * THREE.MathUtils.smoothstep(wb, 0.25, 0.85) * THREE.MathUtils.smoothstep(dLand, 0.78, 1.2));
    return h;
  };
  const heightAt = (x, z) => {
    if (heightMap) return heightFromMap(x, z);
    const m = sample(x, z);
    const cliff = cliffAt(x, z);
    if (cliff > 0) return CLIFF_HEIGHT * cliff;
    // Под скалой землю не опускаем: скала стоит на берегу, а не висит над ямой.
    const w = THREE.MathUtils.smoothstep(m.water, 0.3, 0.65) * (1 - THREE.MathUtils.smoothstep(m.rock, 0.35, 0.6));
    const dLand = nearestLand(x, z);
    const keep = THREE.MathUtils.smoothstep(dLand, 0.95, 1.35);
    let lift = 0;
    if (m.rock > 0.35) {
      // только сплошные скальные пятна: тонкая светлая кромка (песок у озера) не поднимается
      let ring = 0;
      for (const [dx, dz] of RING_ROCK) ring += sample(x + dx, z + dz).rock;
      lift = ROCK_HEIGHT * THREE.MathUtils.smoothstep(m.rock, 0.35, 0.75)
        * THREE.MathUtils.smoothstep(ring / RING_ROCK.length, 0.35, 0.6)
        * THREE.MathUtils.smoothstep(dLand, 1.25, 1.9);
    }
    return WATER_FLOOR * w * keep + lift;
  };
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  groundGeo.computeVertexNormals();
  mark('ground');
  // Стены и уступы хребта — той же рисованной текстурой камня, что у скал (Codex):
  // крутые грани — «бок скалы» (двухплоскостная проекция), верх террас хребта — «верх скалы».
  // Земля: смешивание рисованных текстур Codex по картам data/splat-a/b.png (tools/board3d_splat.py):
  // трава — основа; тропа, лесная подстилка, песок у воды, луг с цветами, мох тёмного леса.
  const gt = groundTextures ?? null;
  const gtex = gt ? Object.fromEntries(await Promise.all(Object.entries(gt).map(async ([k, url]) => {
    const t = await loadTex(url);
    if (k.startsWith('splat')) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.NoColorSpace; }
    return [k, t];
  }))) : null;
  // Лесное основание (разбор «парка» 21.10, шаг 1): маска полога — где деревья стоят группой, земля под ними
  // одним тёмным пятном подстилки с неровным краем. Заполняется после посадки деревьев (ниже).
  const canopyU = { tex: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, box: { value: new THREE.Vector4(groundX0, groundZ0, groundW, groundH) } };
  canopyU.tex.value.needsUpdate = true;
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTex });
  if (matchMedia('(pointer: coarse)').matches) groundMat.defines = { LOWQ: 1 };   // телефон: без второй выборки травы
  groundMat.onBeforeCompile = shader => {
    shader.uniforms.rockTop = { value: rockTopTex };
    shader.uniforms.rockSide = { value: rockSideTex };
    shader.uniforms.canopyTex = canopyU.tex; shader.uniforms.canopyBox = canopyU.box;
    if (gtex) for (const [k, t] of Object.entries(gtex)) shader.uniforms['g_' + k] = { value: t };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
varying vec3 vNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWorldPos = position;
vNrm = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D rockTop;
uniform sampler2D rockSide;
uniform sampler2D canopyTex; uniform vec4 canopyBox;
${gtex ? Object.keys(gtex).map(k => `uniform sampler2D g_${k};`).join('\n') : ''}
varying vec3 vWorldPos;
varying vec3 vNrm;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
${gtex ? `{
  // тайлы ~4 единицы; лёгкий поворот второй выборки травы против повтора
  // 24.10 разбор Codex п.3: мелкая фактура грунта на 55% мягче — смесь с грубым mip (bias 3)
  #define DT(t, u) mix(texture2D(t, u, 3.0).rgb, texture2D(t, u).rgb, 0.45)
  vec2 tuv = vWorldPos.xz * 0.24;
  vec3 grass = DT(g_grass, tuv);
#ifndef LOWQ
  grass = mix(grass, DT(g_grass, tuv * 0.41 + 0.37), 0.35);
#endif
  // рваный край троп: маска троп берётся со сдвигом по шуму (domain warp) — у неё край в 1 px,
  // порог двигать бесполезно; сдвиг ~0.3 ед. даёт выступы, заплаты травы и неровную ширину
  vec2 pw = vec2(sin(vWorldPos.z * 1.9 + sin(vWorldPos.x * 1.3) * 1.7) + 0.5 * sin(vWorldPos.x * 4.7 - vWorldPos.z * 3.3),
                 sin(vWorldPos.x * 2.1 - sin(vWorldPos.z * 1.1) * 1.5) + 0.5 * sin(vWorldPos.z * 5.3 + vWorldPos.x * 2.9));
  vec4 sa = texture2D(g_splatA, vMapUv);
  sa.r = texture2D(g_splatA, vMapUv + pw * vec2(0.0031, 0.0041)).r;  vec4 sb = texture2D(g_splatB, vMapUv);
  vec3 col = grass;
  if (sb.r > 0.01) col = mix(col, DT(g_meadow, tuv), sb.r);
  if (sa.g > 0.01) col = mix(col, DT(g_forest, tuv) * vec3(0.6, 0.62, 0.55), sa.g);   // под кронами темно (не газон)
  if (sb.g > 0.01) col = mix(col, DT(g_dark, tuv), sb.g);
  // берег (разбор «парка» п.2): не ровная песчаная кайма — ширина рвётся шумом, местами вместо песка мокрая
  // тёмная земля и галька, песок только редкими пляжиками
  float bn = sin(vWorldPos.x * 0.9 + sin(vWorldPos.z * 0.7) * 2.1) * sin(vWorldPos.z * 1.1 - vWorldPos.x * 0.4) * 0.5 + 0.5;
  float bn2 = sin(vWorldPos.x * 3.7 + vWorldPos.z * 2.9) * sin(vWorldPos.z * 4.1 - vWorldPos.x * 1.7) * 0.5 + 0.5;
  float beachK = smoothstep(0.35, 0.75, sa.b + (bn - 0.55) * 0.55 + (bn2 - 0.5) * 0.2);
  if (beachK > 0.01) {
    vec3 sand = texture2D(g_beach, tuv).rgb * vec3(0.95, 0.9, 0.82);
    vec3 wet = DT(g_forest, tuv * 1.4 + 0.3) * vec3(0.45, 0.43, 0.38);          // мокрая тёмная земля
    vec3 pebble = mix(texture2D(rockTop, vWorldPos.xz * 0.35).rgb * 0.7, wet, 0.4);
    vec3 bank = mix(wet, sand, smoothstep(0.55, 0.8, bn));                                 // песок — только пятнами
    bank = mix(bank, pebble, smoothstep(0.6, 0.85, bn2) * 0.7);
    col = mix(col, bank, beachK);
  }
  // тропа без видимого повтора: две выборки в разном масштабе и под углом, смешаны шумовой маской
  vec2 ruv = mat2(0.80, -0.60, 0.60, 0.80) * tuv * 0.47 + 0.31;
  float pm = sin(vWorldPos.x * 0.37 + sin(vWorldPos.z * 0.29) * 2.0) * 0.5 + 0.5;
  vec3 pth = vec3(0.0);
  if (sa.r > 0.01) {
  pth = mix(texture2D(g_path, tuv * 0.9).rgb, texture2D(g_path, ruv).rgb, 0.35 + 0.4 * pm);
  pth = mix(vec3(dot(pth, vec3(0.3, 0.59, 0.11))), pth, 0.5) * vec3(0.86, 0.76, 0.62);   // утоптанная земля, не оранжевый песок
  pth *= mix(0.9, 1.2, sb.b);                    // середина тропы светлее (протоптана), к краям темнее
  col = mix(col, pth, sa.r);   // 24.10: тропы возвращены к ранней маске (по просьбе)
  }
  // поляна (splat-b.a = 1 - поляна): не газон — пятнами трава, вытоптанная земля и мшистый камень
  float gld = 1.0 - sb.a;
  if (gld > 0.01) {
    float n1 = sin(vWorldPos.x * 0.9 + sin(vWorldPos.z * 0.7) * 1.6) * sin(vWorldPos.z * 0.8 - vWorldPos.x * 0.3);
    float n2 = sin(vWorldPos.x * 0.53 - 1.7 + sin(vWorldPos.z * 0.41) * 2.0) * sin(vWorldPos.z * 0.61 + 0.9);
    vec3 trod = texture2D(g_path, tuv * 0.9).rgb;
    trod = mix(vec3(dot(trod, vec3(0.3, 0.59, 0.11))), trod, 0.5) * vec3(0.84, 0.76, 0.62);
    vec3 stone = texture2D(rockTop, vWorldPos.xz * 0.13).rgb;
    vec3 gcol = mix(col * vec3(0.9, 0.92, 0.8), trod, smoothstep(0.2, 0.6, n1) * 0.35);   // 24.10: меньше вытоптанных пятен — не «парк»
    gcol = mix(gcol, stone, smoothstep(0.25, 0.7, n2) * 0.8);
    col = mix(col, gcol, gld);
  }
  // дно под водой: от песка у берега к глубокой бирюзе
  // от самой кромки воды (-0.3), а не от нуля: мелкий склон выше воды — земля, не светлое дно (21.10)
  float depth = clamp((-vWorldPos.y - 0.2) / 0.7, 0.0, 1.0);
  col = mix(col, mix(vec3(0.55, 0.62, 0.45), vec3(0.04, 0.32, 0.38), smoothstep(0.1, 0.8, depth)), smoothstep(0.02, 0.15, depth));
  // грейд v6b: земля темнее и холоднее, зелень приглушена
  float gl0 = dot(col, vec3(0.3, 0.59, 0.11));
  // земля как на концепте v6b: тёмная мшистая олива с бурым; тропы остаются светлыми песчаными
  vec3 graded = mix(vec3(gl0), col, 0.45) * vec3(0.68, 0.66, 0.62);   // раунд 2: олива, не салат   // 24.10: трава снова темнее — светлые тропы читаются   // 24.10 замер v6b луг ~(92,84,57): светлее и менее жёлтый
  { // п.4: зелень к одному семейству — цветность тянем к траве/мху рефа #656C45 с сохранением яркости (45%)
    vec3 P = pow(vec3(0.396, 0.424, 0.271), vec3(2.2));
    float yA = dot(graded, vec3(0.2126, 0.7152, 0.0722)), yP = dot(P, vec3(0.2126, 0.7152, 0.0722));
    graded = mix(graded, P * yA / max(yP, 1e-4), 0.45);
  }
  float pathW = sa.r;
  // лесное основание: под группами деревьев — тёмная хвойно-лиственная подстилка одним пятном; край рваный
  // (шум), на тропе и клетках нет (маска это уже учитывает, тропа — ещё и здесь)
  float cn = texture2D(canopyTex, (vWorldPos.xz - canopyBox.xy) / canopyBox.zw).r;
  if (cn > 0.01) {
    float edgeN = sin(vWorldPos.x * 1.7 + sin(vWorldPos.z * 1.3) * 2.0) * sin(vWorldPos.z * 1.9 - vWorldPos.x * 0.6) * 0.5 + 0.5;
    float cov = smoothstep(0.15, 0.75, cn + (edgeN - 0.5) * 0.35) * (1.0 - pathW);
    vec3 lit = texture2D(g_forest, tuv * 1.3).rgb;
    lit = mix(lit, texture2D(g_dark, tuv * 0.8 + 0.21).rgb, 0.4);
    float ll = dot(lit, vec3(0.3, 0.59, 0.11));
    lit = mix(vec3(ll), lit, 0.6) * vec3(0.62, 0.55, 0.42);           // бурая хвоя и опад, без зелени газона
    graded = mix(graded, lit, cov * 0.85);
    graded *= mix(vec3(1.0), vec3(0.42, 0.46, 0.51), cov * smoothstep(0.30, 0.85, cn));   // разбор «парка» п.4: ядро группы на ~45% темнее и холоднее, край мягкий
  }
  diffuseColor.rgb = mix(graded, mix(vec3(gl0), col, 0.7) * vec3(0.92, 0.86, 0.72), pathW);
}` : ''}
{
  vec3 n = normalize(vNrm);
  float steep = 1.0 - smoothstep(0.45, 0.8, n.y);
  vec3 fc = cross(dFdx(vWorldPos), dFdy(vWorldPos));             // вне if: производные в ветвлении не определены
  float fl = length(fc);
  vec3 fn = fl > 1e-9 ? fc / fl : n;                                // вырожденный случай — без NaN (чёрный пунктир)
  if (vWorldPos.y > -0.6) {
    vec2 uvX = vec2(vWorldPos.z, vWorldPos.y) * 0.4, uvZ = vec2(vWorldPos.x, vWorldPos.y) * 0.4;   // 22.10: мельче — скала «нарезана» разломами, как было с v6b
    float wx = abs(n.x) / (abs(n.x) + abs(n.z) + 1e-4);
    float ridgeTop = smoothstep(1.0, 1.6, vWorldPos.y);
    if (steep > 0.01 || ridgeTop > 0.01) {
    // веса проекции — по нормали грани (сглаженная нормаль вершин на уступах рельефа расходится с гранью,
    // камень проецировался вдоль стены — полосы-«лесенка»)
    vec3 wn = fn;
    vec3 tw = pow(abs(wn), vec3(6.0)); tw /= (tw.x + tw.y + tw.z + 1e-4);
    vec3 side = steep > 0.01 ? (texture2D(rockSide, uvX).rgb * tw.x + texture2D(rockSide, vWorldPos.xz * 0.19).rgb * tw.y + texture2D(rockSide, uvZ).rgb * tw.z) * 1.2 : vec3(0.0);
    vec3 top = texture2D(rockTop, vWorldPos.xz * 0.13).rgb;
    // верх террас хребта — камень с мхом и лишайником (не газон); вторая выборка под углом против повтора,
    // пятна травы оставляем шумом; ниже 1.2 — обычная земля
    vec3 top2 = texture2D(rockTop, mat2(0.8, -0.6, 0.6, 0.8) * vWorldPos.xz * 0.071 + 0.37).rgb;
    vec3 rtop = mix(top, top2, 0.35 + 0.3 * sin(vWorldPos.x * 0.21 + sin(vWorldPos.z * 0.17) * 2.0));
    float mossy = smoothstep(0.55, 0.85, sin(vWorldPos.x * 0.43 + 1.3) * sin(vWorldPos.z * 0.37 + 0.7) * 0.5 + 0.5);
    rtop = mix(rtop, diffuseColor.rgb, mossy * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, rtop, ridgeTop);
    diffuseColor.rgb = mix(diffuseColor.rgb, side, steep);
    // 22.10 (разбор скал): светлая кромка-полоса по всему уступу убрана
    }
  }
}`);
  };
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // ── Водная гладь (этап 3): цвет по глубине, пена у берегов, бегущая рябь и блики ──
  // data/water-dist.png (tools/board3d_water.py): R — расстояние от берега внутрь воды.
  const waterDist = waterDistUrl ? await loadTex(waterDistUrl) : null;
  if (waterDist) { waterDist.wrapS = waterDist.wrapT = THREE.ClampToEdgeWrapping; waterDist.colorSpace = THREE.NoColorSpace; }
  const waterMat = waterDist ? new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, dist: { value: waterDist },
      lakeC: { value: (() => { const l = cells.filter(c => c.deck === 'lake').map(c => new THREE.Vector2(c.x, c.z)); while (l.length < 6) l.push(l[0] ?? new THREE.Vector2(9999, 9999)); return l.slice(0, 6); })() },
      lakeR: { value: new THREE.Vector4(0, 0, 0, 7.5) },
      poolC: { value: new THREE.Vector2(9999, 9999) },
      rapids: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() },
      rbox: { value: new THREE.Vector4(groundX0, groundZ0, groundW, groundH) },
      impactC: { value: new THREE.Vector2(9999, 9999) }, impactR: { value: 1.0 },
      carveTex: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, cbox: { value: new THREE.Vector4(groundX0, groundZ0, groundW, groundH) },
      bridgeC: { value: (() => { const l = bridgeCells.filter(c => c.x >= 0).map(c => new THREE.Vector2(c.x, c.z)); while (l.length < 3) l.push(new THREE.Vector2(9999, 9999)); return l.slice(0, 3); })() },
      reflTex: { value: (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); t.needsUpdate = true; return t; })() },
      flowTex: { value: (() => { const t = new THREE.TextureLoader().load('./data/water-flow.png?v=4'); t.colorSpace = THREE.NoColorSpace; return t; })() } },
    vertexShader: `varying vec2 vUv; varying vec3 vPos;
      void main(){ vUv = uv; vPos = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
    fragmentShader: `uniform float time; uniform sampler2D dist; uniform vec2 lakeC[6]; uniform vec4 lakeR; uniform vec2 poolC; uniform sampler2D rapids; uniform sampler2D flowTex; uniform sampler2D reflTex; uniform vec4 rbox; uniform vec2 bridgeC[3]; uniform sampler2D carveTex; uniform vec4 cbox; uniform vec2 impactC; uniform float impactR; varying vec2 vUv; varying vec3 vPos;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      // ячеистый шум Вороного (расстояние до края ячейки) — сетка бликов, как каустика
      vec2 hh(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      float vor(vec2 p, float t){ vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y));
          vec2 o = 0.5 + 0.5 * sin(t + 6.2831 * hh(i + g)); float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return d2 - d1; }
      void main(){
        float d = texture2D(dist, vUv).r;                  // 0 у берега -> 1 на глубине
        // тёмная холодная вода (концепт v6b): бирюза у берега -> глубокий сине-зелёный
        // палитра v6b по зонам (разбор Codex water-v6b/answer.md): глубина / середина / мелководье (sRGB→linear)
        float lakeK = 0.0;
        for (int i = 0; i < 6; i++) lakeK = max(lakeK, 1.0 - smoothstep(lakeR.w * 0.25, lakeR.w * 1.6, length(vPos.xz - lakeC[i])));   // 24.10: граница озеро/река шире — без резкой линии
        float poolK = 1.0 - smoothstep(4.5, 7.0, length(vPos.xz - poolC));
        // 24.10 замер рефа v6b (озеро ~(46,72,81) sRGB): прежняя палитра была ближе всего — оставлена, мелководье чуть холоднее
        // 24.10 «не лазурная»: тёмная холодная сланцево-зелёная, низкая насыщенность (как глубокая вода на рефе)
        // реки — сланцевые серые; озеро (lakeK) — глубокое сине-бирюзовое, как на рефе (~(30,62,78) в центре)
        vec3 dp = mix(vec3(0.105,0.150,0.160), vec3(0.075,0.180,0.235), lakeK); dp = mix(dp, vec3(0.110,0.160,0.170), poolK);
        vec3 md = mix(vec3(0.170,0.220,0.225), vec3(0.120,0.250,0.300), lakeK); md = mix(md, vec3(0.190,0.240,0.245), poolK);
        vec3 sh = mix(vec3(0.290,0.330,0.315), vec3(0.200,0.320,0.340), lakeK); sh = mix(sh, vec3(0.330,0.370,0.355), poolK);
        dp = pow(dp, vec3(2.2)); md = pow(md, vec3(2.2)); sh = pow(sh, vec3(2.2));
        d = clamp(d * mix(3.2, 1.0, lakeK), 0.0, 1.0);   // узкие русла и чаша — расстояние до берега мало, но вода не мелкая
        for (int i = 0; i < 3; i++) d = max(d, (1.0 - smoothstep(2.0, 3.6, length(vPos.xz - bridgeC[i]))) * 0.55);   // расширенное русло под мостом — не берег
        d = max(d, texture2D(carveTex, (vPos.xz - cbox.xy) / cbox.zw).r * 0.6);   // раструб русла у моста (22.10)
        vec3 col = mix(sh, md, smoothstep(0.0, 0.18, d));
        col = mix(col, dp, smoothstep(0.18, 0.65, d));
        // ── течение (карта data/water-flow.png, tools/board3d_flowmap.py): рябь и пена сносятся по руслу,
        // две фазы со сдвигом в полпериода и плавной сменой — без «прыжка» рисунка
        vec3 fl = texture2D(flowTex, vUv).rgb;
        vec2 F = fl.rg * 2.0 - 1.0;
        float sp = fl.b * (1.0 - lakeK * 0.85);
        float ph0 = fract(time * 0.12), ph1 = fract(time * 0.12 + 0.5);
        float fw = abs(ph0 * 2.0 - 1.0);                                 // вес второй фазы
        vec2 o0 = F * sp * ph0 * 2.6, o1 = F * sp * ph1 * 2.6;
        // гребни ряби: Вороной с разорванными гранями (не сетка), в каждой фазе свой сдвиг
        vec2 wb = vPos.xz + vec2(n2(vPos.xz * 0.7 + time * 0.05), n2(vPos.xz * 0.7 + 5.3 - time * 0.04)) * 1.2;
        vec2 wp0 = wb - o0, wp1 = wb - o1 + 3.7;
        float l0 = (1.0 - smoothstep(0.0, 0.05, vor(wp0 * 1.1, time * 0.5))) * smoothstep(0.55, 0.8, n2(wp0 * 2.3 + 7.1));
        float l1 = (1.0 - smoothstep(0.0, 0.05, vor(wp1 * 1.1, time * 0.5 + 1.3))) * smoothstep(0.55, 0.8, n2(wp1 * 2.3 + 7.1));
        float lines = mix(l0, l1, fw);
        lines *= smoothstep(0.2, 0.7, n2(vPos.xz * 0.45 + time * 0.03));
        col = mix(col, pow(vec3(0.459, 0.616, 0.651), vec3(2.2)), clamp(lines * mix(0.26, 0.12, lakeK), 0.0, 1.0));
        // прибой: мягкие волны, бегущие к берегу (на озере едва заметно), тонкая мокрая кромка
        float wave = sin(d * 34.0 - time * 1.7 + n2(vPos.xz * 1.1) * 3.0) * 0.5 + 0.5;
        float foamBand = (1.0 - smoothstep(0.0, 0.035, d)) * 0.45
                       + (1.0 - smoothstep(0.02, 0.16, d)) * smoothstep(0.82, 0.97, wave) * 0.35;
        foamBand *= (0.55 + 0.6 * n2(vPos.xz * 4.0 + time * 0.3)) * mix(1.0, 0.35, lakeK);
        // белая вода: пороги у камней (шлейф сносится по течению) и ядро под водопадом; приглушённая, клочьями
        float rap = texture2D(rapids, (vPos.xz - rbox.xy) / rbox.zw).r;
        float a0 = n2((vPos.xz - o0 * 1.4) * 3.1), a1 = n2((vPos.xz - o1 * 1.4) * 3.1 + 4.1);
        float wn1 = mix(a0, a1, fw), wn2 = n2(vPos.xz * 9.3 - F * time * 0.9);
        float white = smoothstep(0.45, 0.7, rap * (0.45 + 0.7 * wn1) + (wn2 - 0.5) * 0.3) * 0.7;
        float ri = length(vPos.xz - impactC) / impactR;
        float core = (1.0 - smoothstep(0.35, 1.1, ri + (wn1 - 0.5) * 0.45));
        float arcs = smoothstep(0.72, 0.95, sin(ri * 9.0 - time * 2.6 + wn2 * 3.0) * 0.5 + 0.5) * (1.0 - smoothstep(1.0, 2.2, ri)) * smoothstep(0.5, 0.9, wn1 + 0.2);
        white = max(white, max(core * smoothstep(0.2, 0.6, wn1 * 0.6 + 0.5) * 0.9, arcs * 0.55));
        // струи течения: вытянуты вдоль F, бегут по течению, только где течёт быстро
        vec2 Fn = normalize(F + vec2(1e-4)), Fp = vec2(-Fn.y, Fn.x);
        vec2 sq0 = vec2(dot(vPos.xz - o0 * 1.6, Fp) * 2.4, dot(vPos.xz - o0 * 1.6, Fn) * 0.6);
        vec2 sq1 = vec2(dot(vPos.xz - o1 * 1.6, Fp) * 2.4, dot(vPos.xz - o1 * 1.6, Fn) * 0.6) + 5.3;
        float streak = mix(smoothstep(0.8, 0.95, n2(sq0)), smoothstep(0.8, 0.95, n2(sq1)), fw);
        float riverK = (1.0 - lakeK) * (1.0 - poolK * smoothstep(1.4, 2.4, ri));
        white = max(white, streak * riverK * smoothstep(0.55, 0.85, sp) * smoothstep(0.15, 0.5, d) * (1.0 - smoothstep(0.75, 1.0, d)) * 0.3);   // струи только в узких быстрых руслах, не на плёсах
        foamBand = max(foamBand, white);
        // отражения: тёмные массы берега и тёплые огни, разбитые рябью (сдвиг по шуму + полосы поперёк)
        vec2 rj = vec2(n2(vPos.xz * 2.7 + time * 0.25) - 0.5, n2(vPos.xz * 1.3 - time * 0.15) - 0.5) * vec2(0.35, 0.12);
        vec2 ruv = (vPos.xz + rj - rbox.xy) / rbox.zw;
        vec2 refl = texture2D(reflTex, ruv).rg;
        float bands = 0.65 + 0.35 * sin(vPos.z * 9.0 + n2(vPos.xz * 3.0) * 4.0 - time * 1.2);
        col = mix(col, pow(vec3(0.06, 0.11, 0.09), vec3(2.2)), clamp(refl.r * 0.85 * mix(0.75, 1.0, bands), 0.0, 0.85));   // тёмно-зелёное отражение крон
        col += pow(vec3(1.0, 0.62, 0.25), vec3(2.2)) * refl.g * 0.55 * smoothstep(0.35, 0.9, bands * (0.6 + 0.6 * n2(vPos.xz * 6.0 + time)));
        // Френель: к горизонту вода светлее от неба (F0 ~0.02), блики редкие
        vec3 V = normalize(cameraPosition - vPos);
        float fres = 0.02 + 0.98 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
        col = mix(col, pow(vec3(0.52, 0.62, 0.68), vec3(2.2)), clamp(fres * 0.8, 0.0, 0.12) * (1.0 - refl.r * 0.7));
        col = mix(col, pow(vec3(0.70, 0.80, 0.82), vec3(2.2)), clamp(foamBand, 0.0, 1.0));   // пена серо-голубая, не белая
        col = pow(col, vec3(1.0 / 2.2));                            // обратно в вывод (шейдер пишет как есть)
        float a = mix(0.55, 0.96, smoothstep(0.0, 0.14, d));
        a = max(a, clamp(foamBand, 0.0, 1.0) * 0.9);
        gl_FragColor = vec4(col, a);
      }`,
  }) : new THREE.MeshLambertMaterial({ color: 0x35c6d6, transparent: true, opacity: 0.38, depthWrite: false });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(groundW, groundH).rotateX(-Math.PI / 2)
      .translate(groundX0 + groundW / 2, WATER_LEVEL, groundZ0 + groundH / 2),
    waterMat,
  );
  water.renderOrder = 0;
  group.add(water);

  // ── Мосты: всё — от клеток ──
  // Мостовые клетки рядом друг с другом — один мост. Ось — прямая между двумя клетками
  // суши по обе стороны (соседи мостовых клеток); длина — от клетки до клетки суши;
  // ширина — ровно ширина гекса поперёк оси, чтобы края моста совпадали с краями клеток.
  const bridges = new THREE.Group();
  // модели мостов из Blender (tools/blender/bridges.py) по инженерке Codex: левый — верёвочный, под водопадом —
  // каменная арка дварфов, у сказочной поляны — бревенчатый (решение 21.10). Нет модели — прежний деревянный.
  const bridgeModels = {};
  await Promise.all(['rope', 'stone', 'log'].map(k => new GLTFLoader().loadAsync(k === 'stone' ? './models/bridge-stone2.glb?v=20' : k === 'log' ? './models/bridge-log2.glb?v=1' : `./models/bridge-${k}.glb?v=10`)   // 22.10: каменный — горбатый v2 (bridge_stone2.py)
    .then(g => { bridgeModels[k] = g.scene; }).catch(() => {})));
  // доски и перила — текстуры Codex по рефу v6b (outputs/board3d-concept/sprites2/sheet-bridge.png)
  const texL = new THREE.TextureLoader();
  const deckTex = texL.load('./data/bridge-deck.webp?v=1'); deckTex.colorSpace = THREE.SRGBColorSpace; deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  const railTex = texL.load('./data/bridge-rail.webp?v=1'); railTex.colorSpace = THREE.SRGBColorSpace; railTex.wrapS = THREE.RepeatWrapping;
  // верёвочный мост (22.10): текстуры Codex (outputs/board3d-concept/bridges3d/rope3) — 6 досок полосами, у каждой реальной
  // доски своя нарисованная (развёртка тут, по локальным осям модели: x поперёк, y вверх, z вдоль; шаг досок 5/21);
  // столбы и поперечины — дерево с волокном вдоль длины детали; канаты — витой канат
  const ropeTex = Object.fromEntries(['boards', 'post', 'rope'].map(n => {
    const t = texL.load(`./data/bridge/rope3-${n}.webp?v=1`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return [n, t];
  }));
  const ropeRetex = model => model.traverse(o => {
    if (!o.isMesh) return;
    const mat = o.material, nm = mat.name, g = o.geometry;
    const P = g.attributes.position, N = g.attributes.normal, uv = g.attributes.uv;
    if (!uv) return;
    if (nm === 'plank') {
      const p = 5 / 21;
      for (let k = 0; k < P.count; k += 1) {
        const x = P.getX(k), z = P.getZ(k);
        const f = (z + 2.5) / p, i = Math.min(20, Math.max(0, Math.floor(f))), t = Math.min(1, Math.max(0, f - i));   // у досок зазор .004 — граница не попадает ровно на целое
        const j = ((i % 6) + 6) % 6;
        uv.setXY(k, j / 6 + 0.01 + t * (1 / 6 - 0.02), (x + 2) / 1.6 + i * 0.37);
      }
    } else if (nm === 'wood') {
      g.computeBoundingBox(); const b = g.boundingBox, s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
      const upright = s.y > Math.max(s.x, s.z);
      for (let k = 0; k < P.count; k += 1) {
        const x = P.getX(k), y = P.getY(k), z = P.getZ(k);
        if (upright) uv.setXY(k, Math.atan2(z - c.z, x - c.x) / Math.PI * 0.5, y / 1.6);   // столб: по кругу × по высоте
        else uv.setXY(k, (Math.abs(N.getY(k)) > 0.5 ? z : y) * 2.0, x / 1.6);              // поперечина: волокно вдоль X
      }
    } else if (nm !== 'rope') return;
    uv.needsUpdate = true;
    mat.map = ropeTex[nm === 'plank' ? 'boards' : nm === 'wood' ? 'post' : 'rope'];
    mat.color.set(0xffffff); mat.needsUpdate = true;
  });
  const deckMat = new THREE.MeshLambertMaterial({ map: deckTex });
  const railMat = new THREE.MeshLambertMaterial({ map: railTex, alphaTest: 0.5, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a301b });   // тёмное дерево (реф)
  const groups = [];
  for (const c of bridgeCells) {
    const g = groups.find(gr => gr.some(o => (o.neighbors ?? []).includes(c.id) || Math.hypot(o.x - c.x, o.z - c.z) < 1.9));
    if (g) g.push(c); else groups.push([c]);
  }
  // Ширина гекса (радиус 1, плоский верх) поперёк направления (dx, dz).
  const hexWidthAcross = (dx, dz) => {
    const nx = -dz, nz = dx;
    let m = 0;
    for (let i = 0; i < 6; i += 1) m = Math.max(m, Math.abs(Math.cos(i * Math.PI / 3) * nx + Math.sin(i * Math.PI / 3) * nz));
    return 2 * m;
  };
  for (const g of groups) {
    const ids = new Set(g.map(c => c.id));
    const land = [...new Set(g.flatMap(c => c.neighbors ?? []))]
      .filter(id => !ids.has(id)).map(id => cellById.get(id)).filter(Boolean);
    let a = null, b = null, far = -1;
    for (const p of land) for (const q of land) {
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d > far) { far = d; a = p; b = q; }
    }
    if (!a) { a = g[0]; b = g[g.length - 1]; far = Math.hypot(a.x - b.x, a.z - b.z) || 1.7; }
    const dx = (b.x - a.x) / far, dz = (b.z - a.z) / far;
    const axis = Math.atan2(dx, dz);
    // Ширина — по всем полосам дорожки: к мостовым клеткам добавляем клетки соседнего ряда
    // (рядом поперёк оси, в пределах пролёта) и берём крайние вершины их гексов.
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const nx = -dz, nz = dx;
    const lanes = cells.filter(c => {
      const along = (c.x - mx) * dx + (c.z - mz) * dz, perp = (c.x - mx) * nx + (c.z - mz) * nz;
      return ids.has(c.id) || (Math.abs(along) < 1.0 && Math.abs(perp) > 0.9 && Math.abs(perp) < 2.1);
    });
    let pMin = Infinity, pMax = -Infinity;
    for (const c of lanes) for (let i = 0; i < 6; i += 1) {
      const p = (c.x + Math.cos(i * Math.PI / 3) - mx) * nx + (c.z + Math.sin(i * Math.PI / 3) - mz) * nz;
      pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
    }
    const BRIDGE_WIDTH = Number.isFinite(pMin) ? pMax - pMin : hexWidthAcross(dx, dz);
    const sideShift = Number.isFinite(pMin) ? (pMax + pMin) / 2 : 0;
    // от центра клетки суши до центра другой клетки суши (+ заход), как нарисованный мост
    const len = far + 0.6;
    const cx = mx + nx * sideShift, cz = mz + nz * sideShift, mid = 0;
    const piece = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE_WIDTH, 0.16, len), deckMat);
    deck.position.y = -0.07;
    piece.add(deck);
    const half = BRIDGE_WIDTH / 2;
    for (const side of [-1, 1]) {
      // перила как на рефе: брус по краю настила, верхний поручень, частые балясины
      const sx = side * (half - 0.07);
      // перила — плоскость с нарисованными балясинами (Codex), повтор по длине
      const railGeo = new THREE.PlaneGeometry(len - 0.3, 0.62).rotateY(Math.PI / 2);
      const uv = railGeo.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * (len - 0.3) / 1.8);
      const railM = new THREE.Mesh(railGeo, railMat);
      railM.position.set(sx, 0.3, 0);
      piece.add(railM);
      for (const end of [-1, 1]) {
        // толстые угловые столбы с чашей огня (огонь — atmosphere.js)
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), woodMat);
        post.position.set(sx, 0.3, end * (len / 2 - 0.15));
        post.userData.torch = true;
        const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.12, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0x2a2420 }));
        bowl.position.set(sx, 0.82, end * (len / 2 - 0.15));
        piece.add(post, bowl);
      }
      for (let t = -len / 2 + 0.9; t < len / 2 - 0.8; t += 1.1) {
        const pile = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), woodMat);
        pile.position.set(side * (half - 0.25), -0.65, t);
        piece.add(pile);
      }
    }
    // доски поперёк: повтор текстуры по длине моста
    deck.material = deckMat.clone();
    deck.material.map = deckMat.map.clone();
    deck.material.map.repeat.set(1, len / 2.2);
    deck.material.map.rotation = 0;
    deck.material.map.needsUpdate = true;
    const kind = cx < 0 ? 'rope' : cz < 0 ? 'stone' : 'log';
    if (bridgeModels[kind]) {
      // модель: X — поперёк (3.5 м), вдоль — 5 м (4 м русло + по 0.5 м на берега); подгоняем под пролёт и ширину
      piece.clear();
      const m = bridgeModels[kind].clone(true);
      // мост — ровно по своей клетке: на переправе одна клетка-мост, соседние клетки суши — не полосы моста
      const bc = g.reduce((acc, c) => ({ x: acc.x + c.x / g.length, z: acc.z + c.z / g.length }), { x: 0, z: 0 });
      const along = (bc.x - mx) * dx + (bc.z - mz) * dz;
      piece.userData.center = [bc.x, bc.z];   // центр — сама клетка-мост
      // ось — поперёк течения: направление реки = где вдоль линии через клетку больше всего воды;
      // мост перпендикулярен ей, длина — от берега до берега (+0.5 на каждый берег)
      let best = 0, bestW = -1;
      for (let a = 0; a < 180; a += 5) {
        const ux = Math.cos(a * Math.PI / 180), uz = Math.sin(a * Math.PI / 180);
        let w = 0;
        for (let t = -6; t <= 6; t += 0.25) w += sampleMask(bc.x + ux * t, bc.z + uz * t).water;   // без искусственной воды у моста
        if (w > bestW) { bestW = w; best = a; }
      }
      // поперёк течения, но вдоль ряда клеток: направления на соседей гекса (плоский верх) — 30°+60°k
      const raw = best + 90, snap = Math.round((raw - 30) / 60) * 60 + 30;
      const fa = snap * Math.PI / 180, fx = Math.cos(fa), fz = Math.sin(fa);
      const reach = sgn => {   // до берега: сперва вода (под мостом карта может быть нарисована сушей), потом суша
        let seen = false, t = 0;
        for (; t < 6; t += 0.1) { const w = sampleMask(bc.x + fx * t * sgn, bc.z + fz * t * sgn).water; if (w > 0.5) seen = true; else if (seen && w < 0.3) break; }
        return seen ? t : len / 2;
      };
      const r1 = reach(1), r2 = reach(-1);
      const span = Math.max(3.0, r1 + r2 + 1.0);
      // ширина — две полосы клеток (21.10: «мост 2 клетки вмещать должен»): клетка-мост и соседняя клетка
      // поперёк оси; центр — посередине между ними, края — по вершинам их гексов
      const nx2 = -fz, nz2 = fx;
      const lane2 = cells.filter(c => {
        const al = (c.x - bc.x) * fx + (c.z - bc.z) * fz, pe = (c.x - bc.x) * nx2 + (c.z - bc.z) * nz2;
        return g.includes(c) || (Math.abs(al) < 1.0 && Math.abs(pe) > 0.9 && Math.abs(pe) < 2.1);
      });
      let q0 = Infinity, q1 = -Infinity;
      for (const c of lane2) for (let i = 0; i < 6; i += 1) {
        const pe = (c.x + Math.cos(i * Math.PI / 3) - bc.x) * nx2 + (c.z + Math.sin(i * Math.PI / 3) - bc.z) * nz2;
        q0 = Math.min(q0, pe); q1 = Math.max(q1, pe);
      }
      const wid = Number.isFinite(q0) ? Math.max(3.4, q1 - q0) : 3.5, sh = Number.isFinite(q0) ? (q0 + q1) / 2 : 0;
      piece.userData.center = [bc.x + fx * (r1 - r2) / 2 + nx2 * sh, bc.z + fz * (r1 - r2) / 2 + nz2 * sh];
      piece.userData.axis = Math.atan2(fx, fz);
      m.scale.x = wid / 3.5;
      m.scale.z = span / (kind === 'stone' ? 7.0 : 5.0);
      // столбы и борта не должны стоять на клетках суши: сдвигаем мост вдоль оси, пока его крайние
      // столбы/опоры не уйдут с клеток (21.10: «сдвинь мост, чтоб он с клетки ушел»)
      const L2 = (kind === 'stone' ? 3.2 : 2.35) * m.scale.z, W2 = (kind === 'stone' ? 2.02 : 1.98) * m.scale.x;
      const posts = [];   // крайние столбы/опоры — весь след (центр и углы), не одна точка
      for (const [px, pz] of [[-W2, -L2], [W2, -L2], [-W2, L2], [W2, L2]])
        for (const dx2 of [-0.32, 0, 0.32]) for (const dz2 of [-0.32, 0, 0.32]) posts.push([px + dx2, pz + dz2]);
      const [c0x, c0z] = piece.userData.center;
      const onCells = off => posts.reduce((n, [px, pz]) => {
        const wx = c0x + nx2 * px + fx * (pz + off), wz = c0z + nz2 * px + fz * (pz + off);
        return n + (cells.some(c => Math.hypot(c.x - wx, c.z - wz) < 0.9) ? 1 : 0);   // и клетка-мост — под опорой её быть не должно
      }, 0);
      let bestOff = 0, bestN = onCells(0);
      for (let o = 0.1; o <= 2.2 && bestN > 0; o += 0.1) for (const sg of [1, -1]) {
        const n = onCells(o * sg);
        if (n < bestN) { bestN = n; bestOff = o * sg; }
      }
      piece.userData.center = [c0x + fx * bestOff, c0z + fz * bestOff];
      (window.__bridgeDbg ??= []).push({ kind, bestOff, n0: onCells(0), bestN, fx, fz, L2, W2 });
      piece.add(m);
      piece.userData.kind = kind;
      m.position.y = kind === 'log' ? 0.0 : 0.05;   // настил над грунтом — земля не проглядывает; новый бревенчатый (log2) уже на своих уровнях (п.61)
      // огонь — на верхушке столбов модели (extras torch); у бревенчатого огня нет
      m.updateMatrixWorld(true);
      m.traverse(o => {
        if (!o.userData.torch) return;
        o.userData.torch = false;
        const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
        const f = new THREE.Object3D(); f.position.set(c.x, bb.max.y + 0.02, c.z); f.userData.firePoint = true;
        piece.add(f);
      });
      m.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; } });
      // руны каменного моста — голубым свечением, как на воротах (в glb приходят белыми)
      m.traverse(o => { if (o.isMesh && o.material.name === 'rune') { o.material.color.set(0x0c2a33); o.material.emissive.set(0x3fc8f0); o.material.emissiveIntensity = 0.65; } });   // руны на столбах — приглушённо
      if (kind === 'rope') ropeRetex(m);
    }
    piece.position.set(cx + dx * mid, 0, cz + dz * mid);
    if (piece.userData.center) piece.position.set(piece.userData.center[0], 0, piece.userData.center[1]);
    piece.rotation.y = piece.userData.axis ?? axis;
    piece.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    bridges.add(piece);
  }
  group.add(bridges);
  let bridgeCarve = () => 0;   // раструб русла у мостов — и для groundY (посадка не должна попадать в воду)
  // русло под каменным и бревенчатым мостом (22.10: «по нормальному»): вода проходит под всем пролётом — от одного
  // концевого столба до другого, берега раскрываются к мосту и плавно сходятся к обычной ширине реки
  // в 4 м вверх и вниз по течению. Ось моста — local z, течение — local x. Та же маска — шейдеру воды (не берег).
  {
    const posA = groundGeo.attributes.position, inv = new THREE.Matrix4(), lp = new THREE.Vector3();
    const carvers = [];
    for (const pc of bridges.children) {
      if (pc.userData.kind !== 'stone' && pc.userData.kind !== 'log') continue;
      pc.updateMatrixWorld(true);
      const m = pc.children[0];
      carvers.push({ inv: new THREE.Matrix4().copy(pc.matrixWorld).invert(), hw: 1.75 * m.scale.x,
        S: (pc.userData.kind === 'stone' ? 2.2 : 2.0) * m.scale.z - 0.1 });   // 22.10: у каменного — ровно пролёт арки, берега от её пят
    }
    const FL = 4.0;
    const carveAt = (x, z) => {
      let k = 0;
      for (const c of carvers) {
        lp.set(x, 0, z).applyMatrix4(c.inv);
        const ex = Math.max(Math.abs(lp.x) - c.hw, 0);
        if (ex > FL) continue;
        const w = c.S * (1 - THREE.MathUtils.smoothstep(ex, 0, FL)) ** 0.7;        // раструб: у моста полный пролёт
        k = Math.max(k, 1 - THREE.MathUtils.smoothstep(Math.abs(lp.z) - w, -0.5, 0.35));
      }
      return k;
    };
    bridgeCarve = carveAt;
    let changed = 0;
    for (let i = 0; i < posA.count; i += 1) {
      const k = carveAt(posA.getX(i), posA.getZ(i));
      if (k <= 0) continue;
      const ny = Math.min(posA.getY(i), THREE.MathUtils.lerp(posA.getY(i), WATER_FLOOR * 0.85, k));
      if (ny < posA.getY(i)) { posA.setY(i, ny); changed += 1; }
    }
    if (changed) { posA.needsUpdate = true; groundGeo.computeVertexNormals(); }
    if (carvers.length && waterMat.uniforms?.carveTex) {
      const CW = 512, CH = Math.round(512 * groundH / groundW), data = new Uint8Array(CW * CH * 4);
      for (let y = 0; y < CH; y += 1) for (let x = 0; x < CW; x += 1) {
        const v = carveAt(groundX0 + (x + 0.5) / CW * groundW, groundZ0 + (y + 0.5) / CH * groundH) * 255;
        data[(y * CW + x) * 4] = v; data[(y * CW + x) * 4 + 3] = 255;
      }
      const ct = new THREE.DataTexture(data, CW, CH); ct.magFilter = ct.minFilter = THREE.LinearFilter; ct.needsUpdate = true;
      waterMat.uniforms.carveTex.value = ct;
    }
  }
  // габариты мостов (с запасом) — на мост не ставим ни деревья, ни кусты, ни камыш
  const bridgeBoxes = bridges.children.map(pc => { pc.updateMatrixWorld(true); return new THREE.Box3().setFromObject(pc).expandByScalar(0.6); });
  const onBridge = (x, z) => bridgeBoxes.some(b => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z);

  // ── Ёлки и скалы ──
  const r = rng(20261019);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  // ── Домики: пристыкованы к своей клетке с «пустой» стороны, входом к клетке ──
  // Сторона — одна из 6 граней гекса, за которой нет соседней клетки, воды и скал;
  // из подходящих — самая дальняя от остальных клеток.
  // Точка внутри гекса (радиус 1, плоский верх) — проверка соседних клеток.
  const inHex = (px, pz, c) => {
    const x = Math.abs(px - c.x), z = Math.abs(pz - c.z), h = Math.sqrt(3) / 2;
    return z <= h && h * x + 0.5 * z <= h;
  };
  // Задевает ли прямоугольник (центр, ось d «клетка → постройка», полуразмеры) хоть одну клетку.
  const hitsCells = (x, z, dx, dz, hw, hd) => {
    const near = cells.filter(c => Math.hypot(c.x - x, c.z - z) < hw + hd + 1.2);
    for (let a = -1; a <= 1.0001; a += 0.25) for (let b = -1; b <= 1.0001; b += 0.25) {
      const px = x + dx * a * hd - dz * b * hw, pz = z + dz * a * hd + dx * b * hw;
      if (near.some(c => inHex(px, pz, c))) return true;
    }
    return false;
  };
  let wallSeed = 5; const wallRnd = () => (wallSeed = (wallSeed * 16807) % 2147483647) / 2147483647;
  const wallGeo = await new GLTFLoader().loadAsync('./models/gate-wall.glb?v=1').then(gl => { let g0 = null; gl.scene.traverse(o => { if (o.isMesh && !g0) g0 = o.geometry; }); return g0; }).catch(() => null);
  const wallCliffMat = cliffMaterial(...await Promise.all([loadTex(cliffTexUrl ?? rockSideUrl), loadTex(rockTopUrl ?? grassUrl)]));
  wallCliffMat.side = THREE.DoubleSide;                     // слева стена отражена (масштаб −1)
  const houses = new THREE.Group();
  const houseSpots = [];
  const footprints = [];
  const glades = [];
  if (gateModelUrl) await loadGateModel(gateModelUrl).catch(e => console.warn('gate model', e));
  // домики-модели по 2D-арту колод (концепт → инженерка Codex → Blender, tools/blender/house_*.py); остальные — пока коробки
  const HOUSE_MODELS = { 'lake-01': './models/house-lake-01.glb?v=20', 'forest-01': './models/house-forest-01.glb?v=11', 'forest-02': './models/house-forest-02.glb?v=8', 'forest-trail-01': './models/house-forest-trail-01.glb?v=5', 'forest-trail-02': './models/house-forest-trail-02.glb?v=2', 'forest-trail-03': './models/house-forest-trail-03.glb?v=2', 'mixed-01': './models/house-mixed-01.glb?v=1', 'mixed-02': './models/house-mixed-02.glb?v=3', 'dark-forest-01': './models/house-dark-forest-01.glb?v=2', 'dark-forest-02': './models/house-dark-forest-02.glb?v=2', 'lake-02': './models/house-lake-02.glb?v=4' };
  const HOUSE_PROPS = { 'lake-01': ['./models/lake01-props.glb?v=20', [1.05, 0, 1.45]], 'forest-01': ['./models/forest01-props.glb?v=2', [-0.75, 0, 1.45]], 'forest-02': ['./models/forest02-props.glb?v=1', [1.15, 0, 0.75]], 'forest-trail-01': ['./models/trail01-props.glb?v=2', [1.35, 0, 0.35]], 'forest-trail-02': ['./models/trail02-props.glb?v=1', [1.35, 0, 0.35]], 'forest-trail-03': ['./models/trail03-props.glb?v=1', [-1.45, 0, 0.20]], 'mixed-01': ['./models/mixed01-props.glb?v=1', [0, 0, 0]], 'mixed-02': ['./models/mixed02-props.glb?v=1', [0, 0, 0]], 'dark-forest-01': ['./models/darkforest01-props.glb?v=1', [1.45, 0, 0.35]], 'dark-forest-02': ['./models/darkforest02-props.glb?v=1', [1.45, 0, 0.35]], 'lake-02': ['./models/lake02-props.glb?v=1', [0.55, 0, 1.30]] };   // бочка+корзина рядом с домом (локально)
  // световой проход (22.10): текстура по второй развёртке — R затенение щелей, G износ кромок (светлее, «старит»)
  const HOUSE_WEAR = { 'lake-01': './data/house/lake01-wear.png?v=20', 'lake-01-props': './data/house/lake01props-wear.png?v=20', 'lake-01-jetty': './data/house/lake01jetty-wear.png?v=20',
    'forest-01': './data/house/forest01-wear.png?v=11', 'forest-01-props': './data/house/forest01props-wear.png?v=2',
    'forest-02': './data/house/forest02-wear.png?v=8', 'forest-02-props': './data/house/forest02props-wear.png?v=1',
    'forest-trail-01': './data/house/trail01-wear.png?v=5', 'forest-trail-01-props': './data/house/trail01props-wear.png?v=2',
    'forest-trail-02': './data/house/trail02-wear.png?v=2', 'forest-trail-02-props': './data/house/trail02props-wear.png?v=1', 'forest-trail-03': './data/house/trail03-wear.png?v=2', 'forest-trail-03-props': './data/house/trail03props-wear.png?v=1',
    'mixed-01': './data/house/mixed01-wear.png?v=1', 'mixed-01-props': './data/house/mixed01props-wear.png?v=1', 'mixed-02': './data/house/mixed02-wear.png?v=3', 'mixed-02-props': './data/house/mixed02props-wear.png?v=1',
    'dark-forest-01': './data/house/darkforest01-wear.png?v=2', 'dark-forest-01-props': './data/house/darkforest01props-wear.png?v=1', 'dark-forest-02': './data/house/darkforest02-wear.png?v=3', 'dark-forest-02-props': './data/house/darkforest02props-wear.png?v=1',
    'lake-02': './data/house/lake02-wear.png?v=4', 'lake-02-props': './data/house/lake02props-wear.png?v=1' };
  const HOUSE_JETTY = { 'lake-01': './models/lake01-jetty.glb?v=20', 'lake-02': './models/lake01-jetty.glb?v=20' };   // 23.10: lake-02 — те же мостки   // мостки к дому (в системе дома)
  const wearTex = {};
  await Promise.all(Object.entries(HOUSE_WEAR).map(async ([k, u]) => {
    const t = await new THREE.TextureLoader().loadAsync(u).catch(() => null);
    if (t) { t.flipY = false; t.colorSpace = THREE.NoColorSpace; wearTex[k] = t; }
  }));
  // тропинка по настилу моста (22.10): как у каменного — проход затёрт ногами (светлее, глаже, без цвета), к краям языками
  // мусор: листья/земля (litterMap) и мох (mossMap). vLoc — оси three внутри модели: x поперёк, y вверх, z вдоль.
  const pathGLSL = pt => `
    #define HP(p) fract(sin(dot(p, vec2(27.1, 61.7))) * 31871.3)
    #define VP(P) (mix(mix(HP(floor(P)), HP(floor(P) + vec2(1, 0)), smoothstep(0.0, 1.0, fract(P).x)), mix(HP(floor(P) + vec2(0, 1)), HP(floor(P) + vec2(1, 1)), smoothstep(0.0, 1.0, fract(P).x)), smoothstep(0.0, 1.0, fract(P).y)))
    float bigP = VP(vLoc.xz * 1.1 + 3.7), blotP = VP(vLoc.xz * 3.2), fineP = VP(vLoc.xz * 9.0);
    float dhP = vLoc.y - (${pt.deckH});
    if (vWN.y > 0.6 && abs(vLoc.x) < ${pt.halfW.toFixed(2)} && dhP < 0.07 && dhP > -0.12) {
      ${pt.plankP ? `float pk = floor((vLoc.z + 2.5) / ${pt.plankP.toFixed(4)});   // своя яркость/оттенок у каждой доски
      float ph = fract(sin(pk * 12.989) * 43758.5);
      diffuseColor.rgb *= mix(0.78, 1.18, ph) * mix(vec3(1.04, 0.98, 0.92), vec3(0.95, 1.0, 1.05), fract(ph * 7.31));
      float pe = abs(fract((vLoc.z + 2.5) / ${pt.plankP.toFixed(4)}) - 0.5) * 2.0;     // к стыку досок — темнее (грязь в щели)
      diffuseColor.rgb *= 1.0 - 0.35 * smoothstep(0.75, 1.0, pe);` : ''}
      float ax = abs(vLoc.x);
      float edgeD = ax + (bigP - 0.5) * 0.9 + (blotP - 0.5) * 0.35 + (fineP - 0.5) * 0.12;
      float centre = 1.0 - smoothstep(0.2, 1.0, ax + (bigP - 0.5) * 0.5);
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      vec3 polished = mix(vec3(lum), diffuseColor.rgb, 0.55) * 1.35 + vec3(0.05, 0.045, 0.03);
      diffuseColor.rgb = mix(diffuseColor.rgb, polished, centre * 0.7);
      float debris = smoothstep(${(pt.edge0 ?? 1.05).toFixed(2)}, ${((pt.edge0 ?? 1.05) + 0.4).toFixed(2)}, edgeD) * smoothstep(0.30, 0.55, fineP * 0.6 + blotP * 0.5);
      vec3 litter = texture2D(litterMap, vLoc.xz * 0.55).rgb * vec3(0.9, 0.85, 0.75);${pt.dust ? `
      diffuseColor.rgb = mix(diffuseColor.rgb, litter * 0.9, ${pt.dust.toFixed(2)} * smoothstep(0.35, 0.75, fineP * 0.5 + bigP * 0.6) * (1.0 - centre * 0.6));   // пыль/грязь налётом` : ''}
      vec3 mossy = texture2D(mossMap, vLoc.xz * 0.9).rgb * 0.85;
      vec3 junk = mix(litter, mossy, smoothstep(0.55, 0.8, bigP));
      diffuseColor.rgb = mix(diffuseColor.rgb, junk * (0.85 + 0.3 * fineP), clamp(debris, 0.0, 0.9));
    }${pt.moss ? `
    else {   // ворота (23.10): мох в щелях/тени (по запечённому AO) и пятнами на верхах камней — не на проходе
      float mo = (1.0 - smoothstep(0.25, 0.7, w.r)) * 0.55 * smoothstep(0.25, 0.6, fineP * 0.5 + bigP * 0.7);
      mo += smoothstep(0.6, 0.9, vWN.y) * smoothstep(0.40, 0.78, blotP * 0.6 + bigP * 0.6) * 0.75;
      vec3 mossT = texture2D(mossMap, vLoc.xz * 0.9 + vLoc.y * 0.3).rgb * vec3(0.85, 0.95, 0.7);
      diffuseColor.rgb = mix(diffuseColor.rgb, mossT, clamp(mo, 0.0, 0.8));
    }` : ''}`;
  const applyWear = (root, tex, opt = {}) => {
    if (!tex) return;
    const topMoss0 = opt.topMoss ?? 0;   // 23.10 домики: мох пятнами на верхних гранях (как на скалах/мостах)
    const aged = !!opt.aged;   // каменный мост (22.10): сильнее состарить — мох в щелях и на верхах бортиков, затёртый проход, мусор к краям
    const streakTop = opt.streakTop ?? null;   // высота (локальная Y), откуда идут подтёки — дом/мостки/пропсы
    const path = opt.path ?? null;   // тропинка по настилу (22.10, бревенчатый/верёвочный): {deckH: GLSL-высота верха настила от vLoc, halfW, plankP?}
    const done = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (!o.geometry.attributes.uv1 && !aged && !path) return;
      // glTF разбивает объект по материалам — у части (настил) может не оказаться 2-й развёртки: тогда без запечённого износа (w=1)
      o.geometry.setAttribute('wearUv', o.geometry.attributes.uv1 ?? o.geometry.attributes.uv);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (done.has(m)) continue; done.add(m);
        if (opt.skip && opt.skip.test(m.name)) continue;   // шкура с альфой — без износа/мха
        const topMoss = (!opt.mossOn || opt.mossOn.test(m.name)) ? topMoss0 : 0;
        const cells = opt.cells ? Object.entries(opt.cells).find(([re]) => new RegExp(re).test(m.name))?.[1] : null;
        m.onBeforeCompile = sh => {
          sh.uniforms.wearMap = { value: tex };
          if (aged || path || topMoss || opt.dirt) { sh.uniforms.litterMap = { value: opt.litter ?? opt.moss }; sh.uniforms.mossMap = { value: opt.moss ?? opt.litter }; }
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 wearUv; varying vec2 vWearUv; varying vec3 vLoc; varying vec3 vWN;')
            .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWearUv = wearUv; vLoc = position; vWN = normalize(mat3(modelMatrix) * normal);');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D wearMap; varying vec2 vWearUv; varying vec3 vLoc; varying vec3 vWN;' + (aged || path || topMoss || opt.dirt ? '\nuniform sampler2D litterMap; uniform sampler2D mossMap;' : ''))
            .replace('#include <map_fragment>', `#include <map_fragment>
  { vec3 w = texture2D(wearMap, vWearUv).rgb;
    diffuseColor.rgb *= mix(1.0, smoothstep(0.05, 0.85, w.r), 0.7);                       // щели и низ — темнее
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 2.0 + vec3(0.08, 0.07, 0.055), clamp(w.g * 1.3, 0.0, 1.0) * 0.9);   // потёртые кромки — светлее
    // тон детали (B запечён по несвязным частям): каждая плашка/доска/бревно/камень — своя яркость и чуть свой оттенок
    float pc = w.b;
    diffuseColor.rgb *= mix(0.74, 1.22, pc) * mix(vec3(1.04, 0.98, 0.92), vec3(0.94, 1.0, 1.06), fract(pc * 7.31));${opt.mottle ? `
    { // 23.10 домики: неравномерность цвета — крупные пятна светлее/темнее и теплее/холоднее (выгорание, сырость)
      vec2 mp = vLoc.xz + vLoc.y * 0.7;
      float m1 = fract(sin(dot(floor(mp * 1.3), vec2(12.99, 78.23))) * 43758.5);
      float a1 = fract(sin(dot(floor(mp * 1.3) + vec2(1, 0), vec2(12.99, 78.23))) * 43758.5);
      vec2 fp = fract(mp * 1.3); fp = fp * fp * (3.0 - 2.0 * fp);
      float b1 = fract(sin(dot(floor(mp * 1.3) + vec2(0, 1), vec2(12.99, 78.23))) * 43758.5), c1 = fract(sin(dot(floor(mp * 1.3) + vec2(1, 1), vec2(12.99, 78.23))) * 43758.5);
      float n = mix(mix(m1, a1, fp.x), mix(b1, c1, fp.x), fp.y);
      float n2 = fract(sin(dot(floor(mp * 4.1), vec2(39.3, 11.7))) * 9137.1);
      float k = (n - 0.5) * ${(+opt.mottle).toFixed(2)} * 2.0 + (n2 - 0.5) * ${(+opt.mottle).toFixed(2)} * 0.6;
      diffuseColor.rgb *= (1.0 + k) * mix(vec3(1.06, 1.0, 0.90), vec3(0.92, 1.0, 1.08), n2);
    }` : ''}${opt.dirt ? `
    { // 23.10 «грязью присыпем — везде»: земля/листья на пологих гранях пятнами, в щелях (AO) и брызги у низа стен
      vec2 dp = vLoc.xz * 1.7 + vLoc.y * 0.9;
      vec2 fi = floor(dp), ff = fract(dp); ff = ff * ff * (3.0 - 2.0 * ff);
      #define HD(q) fract(sin(dot(q, vec2(41.3, 17.9))) * 24634.6)
      float dn = mix(mix(HD(fi), HD(fi + vec2(1, 0)), ff.x), mix(HD(fi + vec2(0, 1)), HD(fi + vec2(1, 1)), ff.x), ff.y);
      float flat_ = smoothstep(0.25, 0.75, vWN.y);
      float crev = 1.0 - smoothstep(0.25, 0.75, w.r);
      float foot = 1.0 - smoothstep(0.0, 0.45, vLoc.y);
      float d = clamp(flat_ * smoothstep(0.35, 0.75, dn) * 0.85 + crev * 0.55 + foot * (0.4 + 0.5 * dn), 0.0, 1.0) * ${(+opt.dirt).toFixed(2)};
      vec3 dirt = texture2D(litterMap, vLoc.xz * 0.9).rgb * vec3(0.72, 0.62, 0.50);
      diffuseColor.rgb = mix(diffuseColor.rgb, dirt, clamp(d, 0.0, 0.85));
    }` : ''}${cells ? `
    #ifdef USE_MAP
    { // каждая плашка/доска — свой тон (ячейки по UV текстуры: rows рядов, cols плашек в ряду, ряды со сдвигом)
      float rw = floor(vMapUv.y * ${cells[0].toFixed(1)});
      float cl = floor(vMapUv.x * ${cells[1].toFixed(1)} + rw * 0.5);
      float h = fract(sin(dot(vec2(rw, cl), vec2(12.99, 78.23))) * 43758.5);
      diffuseColor.rgb *= mix(0.5, 1.5, h) * mix(vec3(1.12, 0.98, 0.80), vec3(0.86, 1.0, 1.12), fract(h * 5.7));
    }
    #endif` : ''}
    ${streakTop !== null && !aged ? `
    // подтёки (дом, мостки, пропсы): тёмные вертикальные следы на отвесных гранях от верха (streakTop) вниз
    #define HH2(p) fract(sin(dot(p, vec2(27.1, 61.7))) * 31871.3)
    #define VN2(P) (mix(mix(HH2(floor(P)), HH2(floor(P) + vec2(1, 0)), smoothstep(0.0, 1.0, fract(P).x)), mix(HH2(floor(P) + vec2(0, 1)), HH2(floor(P) + vec2(1, 1)), smoothstep(0.0, 1.0, fract(P).x)), smoothstep(0.0, 1.0, fract(P).y)))
    float vert2 = 1.0 - smoothstep(0.35, 0.6, abs(vWN.y));
    float hz2 = vLoc.x + vLoc.z * 1.37;
    float col2 = VN2(vec2(hz2 * 6.0, 0.5)), colF2 = VN2(vec2(hz2 * 21.0, 4.1));
    float len2 = 0.3 + 0.9 * VN2(vec2(hz2 * 2.5, 9.3));
    float fall2 = clamp((${streakTop.toFixed(3)} - vLoc.y) / len2, 0.0, 1.0);
    float streak2 = vert2 * smoothstep(0.45, 0.70, col2 * 0.7 + colF2 * 0.45) * (1.0 - fall2 * fall2);
    float wet2 = vert2 * (1.0 - smoothstep(-0.35, -0.10, vLoc.y));          // у воды (сваи) — сырая полоса
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.36, 0.38, 0.30) + vec3(0.0, 0.02, 0.0), clamp(streak2 * 0.85 + wet2 * 0.6, 0.0, 0.85));` : ''}
    ${aged ? `
    // модель моста: X поперёк, Z вверх (glTF → three: y вверх, x поперёк, -z вдоль) — vLoc в осях three
    #define HH(p) fract(sin(dot(p, vec2(27.1, 61.7))) * 31871.3)
    #define VN(P) (mix(mix(HH(floor(P)), HH(floor(P) + vec2(1, 0)), smoothstep(0.0, 1.0, fract(P).x)), mix(HH(floor(P) + vec2(0, 1)), HH(floor(P) + vec2(1, 1)), smoothstep(0.0, 1.0, fract(P).x)), smoothstep(0.0, 1.0, fract(P).y)))
    float hsh = fract(sin(dot(floor(vLoc.xz * 7.0), vec2(12.99, 78.23))) * 43758.5);
    float n1 = fract(sin(dot(floor(vLoc.xz * 2.3 + vLoc.y), vec2(39.3, 11.7))) * 9137.1);
    float up = smoothstep(0.55, 0.95, vWN.y);
    // мох: в затенённом (щели, низ арки, под бортиками) и пятнами на верхах бортиков/столбов
    // гладкий value-шум трёх масштабов (не клетки, не полосы)
    float big = VN(vLoc.xz * 1.1 + 3.7), blot = VN(vLoc.xz * 3.2), fine = VN(vLoc.xz * 9.0);
    bool deck = up > 0.5 && abs(vLoc.x) < 1.76 && vLoc.y - 0.275 * (1.0 + cos(3.14159 * clamp(vLoc.z / 3.5, -1.0, 1.0))) < 0.05;
    // мох: в тени (щели, низ арки, стык бортика) — только НЕ на настиле; на верхах бортиков/столбов — пятнами
    // верх камней бортика/столбов — это всё, что выше настила (горб D), без привязки к X (порог по X резал каждый камень линией)
    float hd = vLoc.y - 0.275 * (1.0 + cos(3.14159 * clamp(vLoc.z / 3.5, -1.0, 1.0)));
    float topK = up * smoothstep(0.10, 0.20, hd);
    float moss = (deck ? 0.0 : (1.0 - smoothstep(0.25, 0.7, w.r)) * 0.6) + topK * smoothstep(0.35, 0.75, blot * 0.6 + big * 0.6) * 0.9;
    moss *= smoothstep(0.25, 0.6, fine * 0.5 + big * 0.7);
    // подтёки (22.10): на отвесных гранях — тёмные вертикальные следы воды от верха вниз; колонки по горизонтальной
    // координате грани, длина своя у каждой, к низу растворяются; у подошвы (вода) — сырая тёмная полоса
    float vert = 1.0 - smoothstep(0.35, 0.6, abs(vWN.y));
    float hz = abs(vLoc.x) > 1.9 ? vLoc.z : vLoc.x;                          // горизонталь вдоль грани (фасады |x|≈2.1 — вдоль z)
    float col = VN(vec2(hz * 7.0, 0.5)), colF = VN(vec2(hz * 23.0, 4.1));
    float topZ = 0.275 * (1.0 + cos(3.14159 * clamp(vLoc.z / 3.5, -1.0, 1.0)));
    topZ += abs(vLoc.x) > 1.7 ? 0.42 : 0.0;                                 // на бортике — от верха камней
    float len = 0.35 + 0.9 * VN(vec2(hz * 3.0, 9.3));
    float fall = clamp((topZ - vLoc.y) / len, 0.0, 1.0);
    float streak = vert * smoothstep(0.42, 0.68, col * 0.7 + colF * 0.45) * (1.0 - fall * fall) * step(-0.05, topZ - vLoc.y);
    float wetBase = vert * (1.0 - smoothstep(-0.35, -0.05, vLoc.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.30, 0.34, 0.24) + vec3(0.01, 0.03, 0.0), clamp(streak * 0.95 + wetBase * 0.55, 0.0, 0.9));
    vec3 mossTex = texture2D(mossMap, vLoc.xz * 0.9 + vLoc.y * 0.3).rgb;
    diffuseColor.rgb = mix(diffuseColor.rgb, mossTex * vec3(0.85, 0.95, 0.7), clamp(moss, 0.0, 0.85));
    if (deck) {
      float ax = abs(vLoc.x);
      // граница «тропа/обочина» рваная: расстояние до края сдвинуто крупным и средним шумом — мусор заходит языками
      float edgeD = ax + (big - 0.5) * 0.9 + (blot - 0.5) * 0.35 + (fine - 0.5) * 0.12;
      float centre = 1.0 - smoothstep(0.2, 1.0, ax + (big - 0.5) * 0.5);
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      vec3 polished = mix(vec3(lum), diffuseColor.rgb, 0.6) * 1.45 + vec3(0.06, 0.05, 0.035);
      diffuseColor.rgb = mix(diffuseColor.rgb, polished, centre * 0.75);
      float debris = smoothstep(1.05, 1.40, edgeD) * smoothstep(0.30, 0.55, fine * 0.6 + blot * 0.5);   // островками, с просветами камня
      vec3 litter = texture2D(litterMap, vLoc.xz * 0.55).rgb * vec3(0.9, 0.85, 0.75);
      vec3 mossy = texture2D(mossMap, vLoc.xz * 0.9).rgb * 0.85;
      vec3 junk = mix(litter, mossy, smoothstep(0.55, 0.8, big));                                   // где-то листья/земля, где-то мох
      diffuseColor.rgb = mix(diffuseColor.rgb, junk * (0.85 + 0.3 * fine), clamp(debris, 0.0, 0.92));
    }` : ''}
    ${path ? pathGLSL(path) : ''}${topMoss ? `
    { // мох сверху: по нормали вверх + крупные пятна, в тени (AO) гуще
      #define HM_(p) fract(sin(dot(p, vec2(27.1, 61.7))) * 31871.3)
      #define VM_(P) (mix(mix(HM_(floor(P)), HM_(floor(P) + vec2(1, 0)), smoothstep(0.0, 1.0, fract(P).x)), mix(HM_(floor(P) + vec2(0, 1)), HM_(floor(P) + vec2(1, 1)), smoothstep(0.0, 1.0, fract(P).x)), smoothstep(0.0, 1.0, fract(P).y)))
      float bigM = VM_(vLoc.xz * 1.3 + 2.1), fineM = VM_(vLoc.xz * 5.0 + 7.7);
      float upM = smoothstep(0.35, 0.8, vWN.y);
      float mo = upM * smoothstep(0.52, 0.78, bigM * 0.7 + fineM * 0.4) * ${topMoss.toFixed(2)};
      vec3 mt = texture2D(mossMap, vLoc.xz * 0.6).rgb * 0.9;
      diffuseColor.rgb = mix(diffuseColor.rgb, mt, clamp(mo, 0.0, 0.9));
    }` : ''} }`);
        };
        m.customProgramCacheKey = () => (aged ? 'wear-aged' : 'wear') + (streakTop ?? '') + (opt.mottle ? 'mt' + opt.mottle : '') + (opt.dirt ? 'dt' + opt.dirt : '') + (m.name ?? '') + (topMoss ? 'tm' + topMoss : '') + (path ? 'path' + path.deckH + path.halfW + (path.edge0 ?? '') + (path.dust ?? '') : '');
        m.needsUpdate = true;
      }
    });
  };
  const houseModels = {};
  // 23.10: затенение окон к раме — свечение стекла гаснет к краям (виньетка по габариту меша в его плоскости)
  const windowShade = root => root.traverse(o => {
    if (!o.isMesh || !/glow|glass|stained/i.test(o.material?.name ?? '')) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    const ax = [0, 1, 2].sort((a, b) => sz.getComponent(b) - sz.getComponent(a));   // две самые большие оси — плоскость окна
    const m = o.material.clone(); o.material = m;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      sh.uniforms.wsC = { value: c }; sh.uniforms.wsH = { value: new THREE.Vector2(sz.getComponent(ax[0]) / 2 || 1, sz.getComponent(ax[1]) / 2 || 1) };
      sh.uniforms.wsA = { value: new THREE.Vector2(ax[0], ax[1]) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWsP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWsP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWsP; uniform vec3 wsC; uniform vec2 wsH; uniform vec2 wsA;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 d = (vWsP - wsC);
          float a = abs(wsA.x < 0.5 ? d.x : (wsA.x < 1.5 ? d.y : d.z)) / wsH.x;
          float b = abs(wsA.y < 0.5 ? d.x : (wsA.y < 1.5 ? d.y : d.z)) / wsH.y;
          float e = max(a, b);
          float k = 1.0 - smoothstep(0.35, 1.0, e) * 0.85;
          totalEmissiveRadiance *= k * 0.42; diffuseColor.rgb *= mix(0.35, 1.0, k) * 0.7; }`);   // 24.10: окна пригашены
    };
    const pk = m.customProgramCacheKey?.bind(m);
    m.customProgramCacheKey = () => (pk ? pk() : '') + 'winshade';
    m.needsUpdate = true;
  });
  const HOUSE_TOPMOSS = { 'forest-01': 0.75, 'forest-02': 0.9, 'forest-trail-01': 0.0 };   // 23.10: мох на верхах — шейдером, как на скалах/мостах
  const houseDirt = await new THREE.TextureLoader().loadAsync('./data/tex-forest.webp?v=1').then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }).catch(() => null);
  const houseMoss = await new THREE.TextureLoader().loadAsync('./data/tex-grass.webp?v=1')   /* 23.10: трава поля, не камень */.then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }).catch(() => null);
  await Promise.all(Object.entries(HOUSE_MODELS).map(([k, u]) => new GLTFLoader().loadAsync(u).then(g => {
    g.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      if (o.material.name === 'hide' || o.material.name === 'fleece') { o.material.alphaTest = 0.5; o.material.transparent = false; o.material.depthWrite = true; o.material.side = THREE.DoubleSide; }   // шкура с альфой (Codex)
    });
    applyWear(g.scene, wearTex[k], { streakTop: 1.85, topMoss: houseMoss && HOUSE_TOPMOSS[k] ? HOUSE_TOPMOSS[k] : 0, moss: houseMoss, mossOn: /^bark/, skip: /^(hide|fleece)/, mottle: 0.25, cells: { '^tshingle': [4, 7], '^tplanks': [6, 1.5] }, mottleSkip: /^(tglow|tskull)/, dirt: 0.75, litter: houseDirt });
    windowShade(g.scene);
    houseModels[k] = g.scene;
  }).catch(e => console.warn('house model', k, e))));
  const houseProps = {};
  await Promise.all(Object.entries(HOUSE_PROPS).map(([k, [u, at]]) => new GLTFLoader().loadAsync(u).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    applyWear(g.scene, wearTex[k + '-props'], { streakTop: 0.62 });
    g.scene.position.set(...at); houseProps[k] = g.scene;
  }).catch(e => console.warn('house props', k, e))));
  // износ кромок у моделей мостов (запекание по 2-й развёртке, как у домиков)
  {
    const wt = await new THREE.TextureLoader().loadAsync('./data/bridge/stone2-wear.png?v=20').catch(() => null);
    const ld = async u => { const t = await new THREE.TextureLoader().loadAsync(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; };
    const [litter, moss] = await Promise.all([ld('./data/tex-forest.webp?v=1'), ld('./data/tex-rocktop-v6b.webp')]).catch(() => [null, null]);
    if (wt && litter) { wt.flipY = false; wt.colorSpace = THREE.NoColorSpace; for (const pc of bridges.children) if (pc.userData.kind === 'stone') applyWear(pc, wt, { aged: true, litter, moss }); }
    const wl = await new THREE.TextureLoader().loadAsync('./data/bridge/log2-wear.png?v=1').catch(() => null);
    // тропинка (22.10): верх настила бревенчатого — D(y) из tools/blender/bridge_log2.py, верёвочного — D(y) из bridges.py rope_bridge
    const logPath = { deckH: '0.105 - 0.060 * pow(cos(3.14159 * vLoc.z / 5.0), 2.0)', halfW: 2.1 };
    const ropePath = { deckH: 'abs(vLoc.z) <= 2.0 ? 0.10 + 0.10 * pow(vLoc.z / 2.0, 2.0) : 0.40 * (2.5 - abs(vLoc.z))', halfW: 1.76, plankP: 5 / 21 };
    if (wl) { wl.flipY = false; wl.colorSpace = THREE.NoColorSpace; for (const pc of bridges.children) if (pc.userData.kind === 'log') applyWear(pc, wl, { streakTop: 0.12, litter, moss, path: logPath }); }
    // верёвочный — без запечённого износа: нейтральная карта (R=1 без затемнения, G=0 без кромок, B=.5 средний тон)
    const flat = new THREE.DataTexture(new Uint8Array([255, 0, 128, 255]), 1, 1); flat.needsUpdate = true;
    for (const pc of bridges.children) if (pc.userData.kind === 'rope') applyWear(pc, flat, { litter, moss, path: ropePath });
    // ворота v4 (23.10, «всё состариваем как мосты»): камень — запечённый износ (gate4-wear по 2-й развёртке), подтёки
    // от верха арки, проход по ступеням и площадке затёрт, к краям пыль/листья/мох; мох в щелях и на верхах.
    // Оси модели в three: x = X, y = Z (вверх), z = −Y (Y модели — в гору). Верх ступеней .2/.4/.6, площадка .60.
    if (gateModel?.getObjectByName('tunnel')) {
      const ldw = async u => { const t = await new THREE.TextureLoader().loadAsync(u).catch(() => null); if (t) { t.flipY = false; t.colorSpace = THREE.NoColorSpace; } return t; };
      const [gw, gd] = await Promise.all([ldw('./data/gate/gate4-wear.png?v=1'), ldw('./data/gate/gate4doors-wear.png?v=1')]);
      const pick = test => ({ traverse: f => gateModel.traverse(o => { if (o.isMesh && test(o)) f(o); }) });
      const gatePath = { deckH: 'min(0.6, 0.2 * (floor(-vLoc.z / 0.4) + 1.0))', halfW: 1.40, moss: true, edge0: 0.75, dust: 0.45 };
      if (gw && litter) applyWear(pick(o => /gate_stone|gate_floor/.test(o.material.name) && !/^door_/.test(o.parent?.name ?? o.name)), gw, { litter, moss, streakTop: 4.1, path: gatePath });
      if (gd) applyWear(pick(o => /gate_door_(front|back)/.test(o.material.name)), gd, {});
    }
  }
  const houseJetty = {};
  // пена там, где столбы входят в воду (22.10): кольцо на поверхности, рваный край, мягко «дышит»; оси свай — как в
  // tools/blender/jetty_lake01.py (Blender X,Y → three x, −z), берётся точка оси на уровне воды
  const JETTY_PILES = [
    [1.350, -0.290, 1.330, -0.305, 0.250, 0.095], [1.350, 0.990, 1.370, 1.005, 0.250, 0.095],
    [2.650, -0.290, 2.625, -0.310, 0.350, 0.100], [2.650, 0.990, 2.680, 1.010, 0.350, 0.100],
    [4.000, -0.290, 4.025, -0.315, 0.410, 0.125], [4.000, 0.990, 3.975, 1.015, 1.350, 0.120]];
  const HOUSE_PILES_FOAM = [[0.905, -0.905, 0.915, -0.915, 0.002, 0.110], [0.905, 0.905, 0.915, 0.915, 0.002, 0.110], [0.930, 0.000, 0.935, 0.010, 0.002, 0.100]];
  // мостки от берега (22.10, стрелка пользователя): мировая поза — начало настила (локально X=1.15, центр Y=.35) на берегу,
  // ось в озеро; сваи под углами дома — отдельной моделью, стоят с домом
  const JETTY_POSE = { 'lake-01': { start: [-7.62, -2.02], yaw: 0.50 }, 'lake-02': { start: [-2.55, -5.75], yaw: 0.95 } };
  const housePiles = {};
  const foamMats = [];
  const foamMat = () => {
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, seed: { value: Math.random() * 10 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float time; uniform float seed; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x);
          // неровный край и клочья — value-шум по точке, без регулярных лучей
          vec2 q = p * 4.0 + vec2(seed, seed * 1.7) + vec2(time * 0.08, -time * 0.06);
          vec2 i = floor(q), fq = fract(q); fq = fq * fq * (3.0 - 2.0 * fq);
          float h00 = fract(sin(dot(i, vec2(12.9898, 78.233))) * 43758.5), h10 = fract(sin(dot(i + vec2(1, 0), vec2(12.9898, 78.233))) * 43758.5);
          float h01 = fract(sin(dot(i + vec2(0, 1), vec2(12.9898, 78.233))) * 43758.5), h11 = fract(sin(dot(i + vec2(1, 1), vec2(12.9898, 78.233))) * 43758.5);
          float n = mix(mix(h00, h10, fq.x), mix(h01, h11, fq.x), fq.y);
          float edge = 0.62 + 0.30 * n + 0.05 * sin(a * 3.0 + time * 0.7 + seed);
          float ring = smoothstep(0.28, 0.33, r) * (1.0 - smoothstep(edge - 0.28, edge, r));
          vec2 q2 = p * 11.0 + vec2(seed * 3.1, time * 0.15); vec2 i2 = floor(q2), f2 = fract(q2); f2 = f2 * f2 * (3.0 - 2.0 * f2);
          float n2 = mix(mix(fract(sin(dot(i2, vec2(12.9898, 78.233))) * 43758.5), fract(sin(dot(i2 + vec2(1, 0), vec2(12.9898, 78.233))) * 43758.5), f2.x),
                         mix(fract(sin(dot(i2 + vec2(0, 1), vec2(12.9898, 78.233))) * 43758.5), fract(sin(dot(i2 + vec2(1, 1), vec2(12.9898, 78.233))) * 43758.5), f2.x), f2.y);
          float lace = smoothstep(0.45, 0.75, n2);                 // кружево с дырками, не сплошная лужа
          float near = 1.0 - smoothstep(0.30, 0.55, r);              // у самой сваи плотнее
          float alpha = ring * max(lace * smoothstep(0.3, 0.7, n), near * 0.7) * (0.85 + 0.15 * sin(time * 1.3 + seed));
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(vec3(0.78, 0.85, 0.86), alpha * 0.55);
        }` });
    foamMats.push(m); return m;
  };
  const addFoam = (root, list = JETTY_PILES) => {
    for (const [xb, yb, xt, yt, zt, r] of list) {
      const f = (-0.30 + 0.95) / (zt + 0.95);
      if (f > 1) continue;
      const x = xb + (xt - xb) * f, y = yb + (yt - yb) * f;
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), foamMat());
      const s = (r + 0.01) / 0.15;          // внутренний край (r=.30 в UV → .15 в плоскости) — у сваи, пена до ~2.6r
      ring.scale.set(s, s, 1); ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, -0.295, -y); ring.renderOrder = 3;
      root.add(ring);
    }
  };
  // пятно мостков (локально: X 0.9…4.6, z −1.3…0.6) — без деревьев и камыша; высокое перед мостками (ближе к камере, +z) тоже
  const jettyRoots = [];
  const inJetty = (x, z) => jettyRoots.some(j => {
    const c = Math.cos(j.rotation.y), sn = Math.sin(j.rotation.y), ox = x - j.position.x, oz = z - j.position.z;
    const lx = ox * c - oz * sn, lz = ox * sn + oz * c;
    return lx > 0.9 && lx < 4.6 && lz > -1.3 && lz < 0.6;
  });
  const onJetty = (x, z, h0 = 0) => {
    for (let s = 0; s <= (h0 > 1.5 ? 0.9 * h0 : 0); s += 0.3) if (inJetty(x, z - s)) return true;
    return false;
  };
  await Promise.all(Object.entries(HOUSE_JETTY).map(([k, u]) => new GLTFLoader().loadAsync(u).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    applyWear(g.scene, wearTex[k + '-jetty'] ?? wearTex['lake-01-jetty'], { streakTop: 0.05 }); addFoam(g.scene); houseJetty[k] = g.scene;
  }).catch(e => console.warn('house jetty', k, e))));
  await Promise.all(Object.entries(HOUSE_JETTY).filter(([k]) => k === 'lake-01').map(([k, u]) => new GLTFLoader().loadAsync(u.replace('lake01-jetty', 'lake01-housepiles')).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    applyWear(g.scene, wearTex[k + '-jetty'], { streakTop: 0.0 }); addFoam(g.scene, HOUSE_PILES_FOAM); housePiles[k] = g.scene;
  }).catch(e => console.warn('house piles', k, e))));
  const HM = { hw: 1.25, hd: 1.25 };   // v4: низ с пропсами ±1.20, крыша ±1.35 (свес над землёй, не над клетками)
  for (const c of cells) {
    const cls = c.marker?.class;
    const isGate = c.pointClass === 'dwarf_entry';
    const make = isGate ? () => dwarfGate(3.0)
      : HOUSE_ROOF[cls] ? () => (houseModels[c.marker?.asset] ? houseModels[c.marker.asset].clone(true) : houseMesh(cls)) : cls === 'fairy_glade' ? phoenixNest : cls === 'blueprints' ? smithStone : null;
    if (!make) continue;
    let best = null;
    const isSmall = cls === 'fairy_glade' || cls === 'blueprints';
    const isModel = !!houseModels[c.marker?.asset];
    const halfW = isSmall ? 0.9 : isModel ? HM.hw : HOUSE_W / 2, halfD = isSmall ? 0.9 : isModel ? HM.hd : HOUSE_D / 2;
    for (let i = 0; i < 6; i += 1) {
      const ang = Math.PI / 6 + i * Math.PI / 3;           // направления на грани гекса (плоский верх)
      const dx = Math.cos(ang), dz = Math.sin(ang);
      // Отодвигаем от грани, пока прямоугольник постройки не перестанет задевать клетки.
      let off = Math.sqrt(3) / 2 + (isGate ? 0.35 : halfD + 0.05);
      if (!isGate) {   // постройка стоит по осям (дверь к камере, +z) — проверяем её прямоугольник без поворота
        const [ax, az] = isSmall ? [dx, dz] : [0, 1];
        while (off < 4.5 && hitsCells(c.x + dx * off, c.z + dz * off, ax, az, halfW + 0.05, halfD + 0.05)) off += 0.1;
        if (off >= 4.5) continue;
      }
      const hx = c.x + dx * off, hz = c.z + dz * off;
      const free = nearest(hx, hz);                         // до ближайшего центра клетки
      const m = sample(hx, hz);
      // ворота стоят в проходе обрыва: для них земля может быть и выше (стена рядом)
      const ok = m.water < 0.3 && (isGate || Math.abs(heightAt(hx, hz)) < 0.2);
      let score = (ok ? 10 : 0) - off;                      // ближе к своей клетке — лучше
      if (!isSmall) score -= dz * 1.5;                      // домик за клеткой (дальше от камеры): дверь смотрит и на клетку, и на нас
      if (isGate) {
        // ворота — конец дорожки и стоят на её продолжении. Линию дороги берём по клеткам
        // в 2–4 шагах от входа (ближайшие соседи — это и боковые клетки второй полосы).
        const depth = new Map([[c.id, 0]]);
        let front = [c.id];
        for (let d = 1; d <= 4; d += 1) {
          const next = [];
          for (const id of front) for (const n of cellById.get(id)?.neighbors ?? []) if (!depth.has(n)) { depth.set(n, d); next.push(n); }
          front = next;
        }
        const road = [...depth].filter(([, d]) => d >= 2).map(([id]) => cellById.get(id)).filter(Boolean);
        const ax = road.reduce((a, o) => a + (c.x - o.x), 0), az = road.reduce((a, o) => a + (c.z - o.z), 0);
        const al = Math.hypot(ax, az) || 1;
        score = (dx * ax + dz * az) / al;              // грань, лучше всего продолжающая дорогу
      }
      if (!best || score > best.score) best = { score, hx, hz, dx, dz };
    }
    if (!best) continue;
    let h = make();
    if (isGate) {
      // Дорога к воротам в несколько полос: берём клетку входа и клетки соседнего ряда рядом
      // с ней поперёк дороги; ворота перекрывают все полосы и стоят за передней гранью.
      const { dx, dz } = best, nx = -dz, nz = dx;
      const lanes = cells.filter(o => {
        const along = (o.x - c.x) * dx + (o.z - c.z) * dz, perp = (o.x - c.x) * nx + (o.z - c.z) * nz;
        return o === c || (Math.abs(along) < 1.0 && Math.abs(perp) > 0.9 && Math.abs(perp) < 2.1 && (c.neighbors ?? []).includes(o.id));
      });
      let pMin = Infinity, pMax = -Infinity, front = -Infinity;
      for (const o of lanes) for (let i = 0; i < 6; i += 1) {
        const vx = o.x + Math.cos(i * Math.PI / 3) - c.x, vz = o.z + Math.sin(i * Math.PI / 3) - c.z;
        const p = vx * nx + vz * nz, a = vx * dx + vz * dz;
        pMin = Math.min(pMin, p); pMax = Math.max(pMax, p); front = Math.max(front, a);
      }
      // башни (1.3) стоят за краями дороги — проём на всю ширину полос
      h = dwarfGate(pMax - pMin + 1.5);
      const shift = (pMax + pMin) / 2, along = front + 0.3;
      best.hx = c.x + dx * along + nx * shift;
      best.hz = c.z + dz * along + nz * shift;
      h.userData.lanes = lanes.map(o => o.id);
    }
    h.position.set(best.hx, 0, best.hz);
    // ворота и гнёзда — к клетке; домики — с шагом 90°, вход к камере (22.10)
    h.rotation.y = isGate || isSmall ? Math.atan2(-best.dx, -best.dz) : 0;
    const HOUSE_SHIFT = { 'lake-01': [0.15, 1.1], 'lake-02': [-5.9, 1.7], 'forest-trail-01': [1.3, 0.9] };   // 23.10 lake-02 — на берег у ивы (по разметке)   // 22.10: к камере (+z), чтобы крыша не закрывала клетки за домом
    if (houseModels[c.marker?.asset] && !isGate && HOUSE_SHIFT[c.marker.asset]) { best.hx += HOUSE_SHIFT[c.marker.asset][0]; best.hz += HOUSE_SHIFT[c.marker.asset][1]; h.position.set(best.hx, 0, best.hz); }
    // 23.10: у каждого дома свой разворот — дверь к камере (+z), но с разбросом ±40° (не все одинаково); lake-01 — как подобрали (−30°)
    const HOUSE_YAW = { 'lake-01': -30, 'forest-01': -35, 'forest-02': 25, 'forest-trail-01': -40, 'forest-trail-02': -38, 'forest-trail-03': 12,
      'mixed-01': -8, 'mixed-02': -28, 'dark-forest-01': -25, 'dark-forest-02': -25 };
    if (houseModels[c.marker?.asset] && !isGate) h.rotation.y = THREE.MathUtils.degToRad(HOUSE_YAW[c.marker.asset] ?? -30);
    if (!isGate && !isSmall) { best.dx = 0; best.dz = -1; }   // след постройки — по осям
    h.userData.cell = c.id;
    if (houseModels[c.marker?.asset] && !isGate) h.userData.houseModel = c.marker.asset;
    if (houseProps[c.marker?.asset] && !isGate) { const pr = houseProps[c.marker.asset].clone(true); pr.userData.noFogSolid = true; h.add(pr); }
    if (housePiles[c.marker?.asset] && !isGate) h.add(housePiles[c.marker.asset].clone(true));
    if (houseJetty[c.marker?.asset] && !isGate && JETTY_POSE[c.marker.asset]) {
      const jt = houseJetty[c.marker.asset].clone(true), P = JETTY_POSE[c.marker.asset], a = P.yaw;
      // локальная точка (1.15, 0, −0.35) → в start
      jt.rotation.y = a;
      jt.position.set(P.start[0] - (1.15 * Math.cos(a) + -0.35 * Math.sin(a)), 0, P.start[1] - (-1.15 * Math.sin(a) + -0.35 * Math.cos(a)));
      jt.userData.noFogSolid = true; houses.add(jt); jettyRoots.push(jt);
    }
    houses.add(h);
    if (isGate && gateModel && !h.userData.v4) gateWalls(h);
    houseSpots.push([best.hx, best.hz]);
    if (isGate) { h.userData.isGate = true; houseSpots.push([best.hx + best.dx * 1.2, best.hz + best.dz * 1.2]); }
    // След постройки (прямоугольник) — под ним и вокруг земля ровная, скалы не залезают.
    const isNest = cls === 'fairy_glade' || cls === 'blueprints';
    // ворота v4 (23.10): земля ровная и под туннелем (до Y 5.8 модели), иначе рельеф горы пролезает внутрь туннеля;
    // снаружи эту полосу закрывает массив «крыши туннеля» (rock_roof, до земли с боков и сзади)
    if (isGate && h.userData.v4) { const k = h.children[0].scale.x; footprints.push({ x: best.hx, z: best.hz, dx: best.dx, dz: best.dz, hw: 2.4 * k, hdFront: 0.0, hdBack: 5.8 * k }); }
    footprints.push({
      x: best.hx, z: best.hz, dx: best.dx, dz: best.dz,
      hw: isGate ? h.userData.span / 2 + 1.2 : isNest ? 0.9 : isModel ? HM.hw : HOUSE_W / 2,
      hdFront: isGate ? 0.6 : isNest ? 0.9 : isModel ? HM.hd : HOUSE_D / 2,
      hdBack: isGate ? (h.userData.depth ?? 2.0) : isNest ? 0.9 : isModel ? HM.hd : HOUSE_D / 2,   // за воротами — пол площадки
    });
    if (cls === 'fairy_glade') glades.push({ x: c.x, z: c.z });
  }
  // стены от рамы ворот в обе стороны до скалы: кладка той же высоты, что рама; идём вдоль оси ворот,
  // пока земля не поднимется выше середины стены (там уже скала) — но не дальше 9 м
  function gateWalls(g) {
    let stoneMat = null;
    g.traverse(o => { if (o.isMesh && o.material.name === 'gate_stone' && !stoneMat) stoneMat = o.material; });
    const k = g.children[0].scale.x, H = 4.1 * k, D = 0.6 * k;
    const ax = Math.cos(g.rotation.y), az = -Math.sin(g.rotation.y);       // локальная +X ворот в мире
    const fx = Math.sin(g.rotation.y), fz = Math.cos(g.rotation.y);        // к клетке (локальная +Z)
    const cy = 1.5 * k;                                                     // середина глубины рамы (Y модели 1.2…1.8)
    for (const side of [-1, 1]) {
      const start = 1.8 * k;
      let len = 0;
      for (let d = start; d < start + 9; d += 0.25) {
        len = d - start;
        // скала — где земля поднимается выше 1.2 хоть на лицевой, хоть на тыльной линии стены
        if ([1.2 * k, 1.8 * k].some(t => heightAt(g.position.x + ax * side * d - fx * t, g.position.z + az * side * d - fz * t) > 1.2)) break;
      }
      // под воротами и вокруг земля потом выравнивается (след постройки до span/2+1.2) — стена закрывает
      // весь этот выровненный участок, иначе между рамой и скалой остаётся проём
      len = Math.max(len, g.userData.span / 2 + 1.2 - start);
      len += 0.8;                                                           // заходит в скалу
      // стена — один цельный меш из Blender (tools/blender/dwarf_wall.py): дуга 4 м, заворачивает назад в гору;
      // справа как есть, слева — зеркально. Материал — как у модулей скал (тот же камень, светлый и грубый)
      if (!wallGeo) continue;
      const sc = Math.max(0.8, len / 3.2);                    // хорда дуги ~3.2 м — растягиваем по месту
      const w = new THREE.Mesh(wallGeo, wallCliffMat);
      w.scale.set(side * sc * k / 1.0, k, sc * k);
      w.position.set(side * start, FLOOR_WALL_Y + 0.3 * k, -1.8 * k);    // ось стены — по задней плоскости рамы: лицо (−0.45) за постаментами чаш (до −1.1)
      w.castShadow = w.receiveShadow = true;
      w.name = 'gate_wall';
      g.add(w);
    }
  }
  const nearHouse = (x, z, r) => houseSpots.some(([hx, hz]) => Math.hypot(hx - x, hz - z) < r);
  // Расстояние до ближайшего следа постройки (0 — внутри).
  const footprintDist = (x, z) => {
    let best = Infinity;
    for (const f of footprints) {
      const a = (x - f.x) * f.dx + (z - f.z) * f.dz;           // вдоль оси «клетка → постройка»
      const b = (x - f.x) * -f.dz + (z - f.z) * f.dx;
      const da = a > 0 ? Math.max(0, a - f.hdBack) : Math.max(0, -a - f.hdFront);
      const db = Math.max(0, Math.abs(b) - f.hw);
      best = Math.min(best, Math.hypot(da, db));
    }
    return best;
  };
  // Скалы и обрывы у построек срезаются до уровня земли (плавно, на 1.5 вокруг следа).
  const flatAt = (x, z) => THREE.MathUtils.smoothstep(footprintDist(x, z), 0.4, 1.9);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      if (y > 0) pos.setY(i, y * flatAt(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    groundGeo.computeVertexNormals();
  }
  // Смоделированные террасные скалы: старый бугор из карты высот под ними убираем.
  const toWorldXZ = (px, py) => [groundX0 + (px / 4096) * groundW, groundZ0 + (py / 3072) * groundH];
  const rocksJson = rocksUrl ? await (await fetch(rocksUrl)).json() : { rocks: [], stones: [] };
  // какие скалы моделировать: по точке на карте (пиксели арта) — номера скал меняются при пересборке
  const rockData = modeledRocks === 'all' ? rocksJson.rocks : modeledRocks.map(([mx, my]) => rocksJson.rocks.reduce((b, rk) =>
    (!b || (rk.x - mx) ** 2 + (rk.y - my) ** 2 < (b.x - mx) ** 2 + (b.y - my) ** 2 ? rk : b), null)).filter(Boolean);
  const rockPolys = rockData.map(rk => {
    const pts = rk.levels[0].pts.map(([px, py]) => toWorldXZ(px, py));
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    pts.box = [Math.min(...xs) - 0.6, Math.max(...xs) + 0.6, Math.min(...zs) - 0.6, Math.max(...zs) + 0.6];
    return pts;
  });
  const inPoly = (x, z, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const underRock = (x, z) => rockPolys.some(poly => x > poly.box[0] && x < poly.box[1] && z > poly.box[2] && z < poly.box[3] && inPoly(x, z, poly));
  if (rockPolys.length) {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = pos.getZ(i);
      // в контуре и на полклетки вокруг — земля ровная (скала сама даёт высоту); на плато хребта (выше 4)
      // землю не опускаем — между камнями скалы иначе провал до низины (дыра у кромки водопада)
      if (pos.getY(i) > 0 && pos.getY(i) < 4 && (underRock(x, z) || [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].some(([dx, dz]) => underRock(x + dx, z + dz)))) pos.setY(i, 0);
    }
    pos.needsUpdate = true;
    groundGeo.computeVertexNormals();
  }
  const groundY0 = (x, z) => { const y = heightAt(x, z); return y > 0 ? (underRock(x, z) && y < 4 ? 0 : y * flatAt(x, z)) : y; };
  const groundY = (x, z) => { const y = groundY0(x, z), k = bridgeCarve(x, z); return k > 0 ? Math.min(y, THREE.MathUtils.lerp(y, WATER_FLOOR * 0.85, k)) : y; };

  // ── Модули обрыва вдоль стен хребта: где карта высот круто обрывается ──
  const cliffs = new THREE.Group();
  if (cliffKitUrl) {
    const kit = await loadCliffKit(cliffKitUrl);
    const [sideTex, grassTex] = await Promise.all([loadTex(cliffTexUrl ?? rockSideUrl), loadTex(rockTopUrl ?? grassUrl)]);   // верх уступов — камень с мхом
    const cmat = cliffMaterial(sideTex, grassTex);
    const cands = [];
    const D = 0.4;
    for (let z = groundZ0; z < groundZ0 + groundH; z += 0.5) {
      for (let x = groundX0; x < groundX0 + groundW; x += 0.5) {
        if (heightAt(x, z) < 0.3 && heightAt(x, z - 1) < 0.3) continue;
        const gx = (heightAt(x + D, z) - heightAt(x - D, z)) / (2 * D), gz = (heightAt(x, z + D) - heightAt(x, z - D)) / (2 * D);
        const mag = Math.hypot(gx, gz);
        if (mag > 1.8) cands.push([x + (r() - 0.5) * 0.4, z + (r() - 0.5) * 0.4, gx / mag, gz / mag]);
      }
    }
    // перемешать и оставить точки не ближе 3.2 единицы (модули 4.5–6 — с перекрытием, хребет одной массой)
    for (let i = cands.length - 1; i > 0; i -= 1) { const j = Math.floor(r() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const kept = [];
    for (const c of cands) if (!kept.some(k => Math.hypot(k[0] - c[0], k[1] - c[1]) < 2.6)) kept.push(c);   // 22.10 разбор п.5
    // вода рядом (река на плато, водопад, заводь) — модули не ставим, чтобы не закрыть водопад
    const nearWater = (x, z) => [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]
      .some(([ox, oz]) => sample(x + ox, z + oz).water > 0.3);
    const lists = CLIFF_NAMES.map(() => []);
    // ворота v4 (23.10): модуль обрыва залезал в туннель — внутри прямоугольника ворот+туннеля их не ставим
    const gv = houses.children.find(h => h.userData.isGate && h.userData.v4);
    const inGateV4 = (x, z) => {
      if (!gv) return false;
      const k = gv.children[0].scale.x, c = Math.cos(gv.rotation.y), sn = Math.sin(gv.rotation.y), ddx = x - gv.position.x, ddz = z - gv.position.z;
      const X = (ddx * c - ddz * sn) / k, Y = -(ddx * sn + ddz * c) / k;
      return X > -5.2 && X < 7.0 && Y > -1.0 && Y < 7.5;
    };
    for (const [x, z, gx, gz] of kept) {
      const dx = -gx, dz = -gz;                                      // наружу, вниз по склону
      const top = Math.max(heightAt(x - dx * 0.8, z - dz * 0.8), heightAt(x - dx * 1.2, z - dz * 1.2));
      const bottom = heightAt(x + dx * 1.0, z + dz * 1.0);
      const H = top - bottom;
      if (H < 0.8) continue;
      if (nearWater(x, z) || nearHouse(x, z, 4) || nearest(x, z) < 1.4) continue;
      const roll = r();
      const type = roll < 0.60 ? Math.floor(r() * 3) : roll < 0.80 ? 4 : roll < 0.90 ? 5 : 3;
      const len = 3.6 + r() * 1.2;
      lists[type].push([x + dx * 0.25, Math.max(bottom, -0.3) - 0.4, z + dz * 0.25, len, (H + 0.45) * (0.98 + r() * 0.06), Math.atan2(dx, dz) + (r() - 0.5) * 0.16, inGateV4(x, z)]);
    }
    kit.forEach((geo, i) => {
      if (!geo || !lists[i].length) return;
      const mesh = new THREE.InstancedMesh(geo, cmat, lists[i].length);
      lists[i].forEach(([x, y, z, len, h, ry, hide], k) => {
        q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.05, ry, (r() - 0.5) * 0.05));
        m4.compose(p.set(x, y, z), q, s.set(len, h, Math.min(len, 4.2) * (0.9 + r() * 0.2)));
        if (hide) m4.makeScale(0, 0, 0);   // в воротах v4 (туннель) — нулевой масштаб, общий r() не сдвигаем
        mesh.setMatrixAt(k, m4);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      cliffs.add(mesh);
    });
    group.add(cliffs);
  }

  // Зоны биомов — клетки-колоды. Граница зоны «волнистая» (шум к расстоянию).
  const zones = cells.filter(c => DECK_BIOME[c.deck] || c.marker?.class === 'fairy_glade')
    .map(c => ({ x: c.x, z: c.z, biome: DECK_BIOME[c.deck] ?? 'fairy' }));
  const biomeAt = (x, z) => {
    const warp = (valueNoise2(x * 0.18, z * 0.18) - 0.5) * 4;
    let best = null, bd = Infinity;
    for (const zn of zones) {
      const d = Math.hypot(zn.x - x, zn.z - z) * (zn.biome === 'fairy' ? 1.25 : 1) + warp;
      if (d < bd) { bd = d; best = zn; }
    }
    return best && bd < 10 ? best.biome : 'forest';
  };
  // Деревья и мелочь не должны стоять внутри твёрдого: в скале (с запасом), у стены уступа
  // (крутой склон рядом) — иначе любая отрисовка покажет дерево, растущее сквозь камень.
  const RING08 = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [0.57, 0.57], [-0.57, 0.57], [0.57, -0.57], [-0.57, -0.57]];
  // Дерево-картинка рядом со скалой на той же глубине «режется» её неровной поверхностью — держим
  // деревья на ширину кроны от скал и обрывов (сбоку — шире, перед скалой — можно ближе: там дерево
  // и так рисуется поверх)
  const blocked = (x, z) => {
    if (underRock(x, z) || RING08.some(([dx, dz]) => underRock(x + dx, z + dz))) return true;
    // от скалы — отступ только СБОКУ (по x); сзади и спереди можно вплотную
    if ([[1, 0], [-1, 0]].some(([dx]) => underRock(x + dx * 1.5, z))) return true;
    const y = groundY(x, z);
    // как раньше: перепад рядом (берег, уступ); плюс стена ВЫШЕ дерева чуть дальше — она режет крону.
    // Спуск к воде дальше не считаем — иначе пропадал весь прибрежный лес (замечание 20.10)
    return RING08.some(([dx, dz]) => Math.abs(groundY(x + dx * 1.4, z + dz * 1.4) - y) > 0.45)
      || RING08.some(([dx, dz]) => dz < 0 && groundY(x + dx * 1.25, z + dz * 1.25) - y > 0.45);   // стена позади-выше вплотную
  };
  // посадка: основной проход (как раньше) и второй — со сдвигом на полшага и своим генератором:
  // только ДОБАВЛЯЕТ деревья в промежутки, не пересаживая уже стоящие (замечание 20.10)
  const genSpots = (r, ox, oz, treeSpots) => {
  for (let z = groundZ0 + oz; z < groundZ0 + groundH; z += TREE_STEP) {
    for (let x = groundX0 + ox; x < groundX0 + groundW; x += TREE_STEP) {
      const jx = x + (r() - 0.5) * TREE_STEP * 0.9, jz = z + (r() - 0.5) * TREE_STEP * 0.9;
      const m = sample(jx, jz);
      // уступы и верх хребта: ёлки редкими группами на ровном месте, не у края
      if (jx < groundX0 + 1.5 || jx > groundX0 + groundW - 1.5 || jz < groundZ0 + 1.5 || jz > groundZ0 + groundH - 1.5) continue;   // не за краем карты
      if (blocked(jx, jz)) continue;
      const gyRidge = groundY(jx, jz);
      if (gyRidge > 1.0) {
        const flat = [[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]].every(([dx, dz]) => Math.abs(groundY(jx + dx, jz + dz) - gyRidge) < 0.45);   // и узкие средние уступы
        // уступы: лес КУЧНЫМИ рощами (крупный шум, внутри рощи — каждое место), между рощами пусто;
        // кустов на уступах нет. Порода — по биому соседних колод (тёмный лес -> тёмные ели и т. д.)
        const rg = valueNoise2(jx * 0.11 + 2.3, jz * 0.11 + 9.1);
        if (flat && rg > 0.18) {          // хребет густо в елях (реф v6b)          // рощи крупные, между ними — меньше голого камня
          const b = biomeAt(jx, jz);
          const uR = (jx - groundX0) / groundW;
          treeSpots.push([jx, jz, b === 'autumn' || (uR > 0.62 && r() < 0.3) ? 'autumn' : 'ridge', false]);   // на хребте ели; справа (зона C) ~30% осенних
        } else if (r() < 0.16) treeSpots.push([jx, jz, 'ridge_dry', false]);     // между рощами — сухой кустарник
        continue;
      }
      const biome0 = biomeAt(jx, jz);
      // ивы у озера вне лесной маски — редкими одиночками, не стеной вдоль воды
      const special = (biome0 === 'lake' && r() < 0.9 &&   // зона E рефа: ивы кольцом по берегу озера
        [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([ox, oz]) => sample(jx + ox, jz + oz).water > 0.4))
        || biome0 === 'fairy';
      // у подножия хребта (стена в пределах 3) лес и вне маски — не пустая трава под скалой
      const footOfRidge = m.forest < 0.5 && groundY(jx, jz) < 0.3 && [[0, -2.5], [1.8, -1.8], [-1.8, -1.8], [2.5, 0], [-2.5, 0]].some(([dx, dz]) => groundY(jx + dx, jz + dz) > 1.2);
      if (!special && !footOfRidge && m.forest < 0.5) continue;
      if (m.water > 0.3 || m.rock > 0.45) continue;
      const dCell = nearest(jx, jz);
      if (dCell < (special && biome0 === 'lake' ? 0.85 : CELL_CLEAR)) continue;   // ивы у воды — ближе к клеткам
      if (nearHouse(jx, jz, 3.1)) continue;         // дом входит в биом: вокруг него поляна
      if (groundY(jx, jz) < -0.05) continue;     // не на воде (кувшинки в озере зелёные)
      const biome = biome0;
      // ритм плотности: рощи и поляны (крупный шум), на лугу деревья редкие
      const grove = valueNoise2(jx * 0.13 + 7.1, jz * 0.13 + 3.7);
      if (grove < 0.2 && r() < 0.12) continue;          // лес сомкнутый: шум лишь слегка разрежает (совет Codex)
      if (biome === 'meadow' && r() > 0.22) continue;
      const edge = dCell < CELL_CLEAR + 0.9;            // опушка у тропы: кусты и молодые деревца
      treeSpots.push([jx, jz, biome, edge]);
    }
  }
  };
  const treeSpots = [];
  genSpots(r, 0, 0, treeSpots);
  const r2 = rng(20261020);
  const extraSpots = [];
  // genSpots(r2, TREE_STEP / 2, TREE_STEP / 2, extraSpots);   // второй проход выключен: на рефе v6b деревьев меньше
  mark('treeSpots');
  // Виды деревьев по биомам; на опушках — кусты и молодые деревца; редкие старые деревья-ориентиры.
  const kit = treeKitUrl ? await loadKitGeos(treeKitUrl).catch(() => null) : null;
  const byName = {};
  const nearWaterT = (x, z) => [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]].some(([ox, oz]) => sample(x + ox, z + oz).water > 0.4);
  // зоны рефа v6b по положению на карте (доли ширины/высоты поля): u — слева направо, v — сверху вниз
  const zoneOf = (x, z) => {
    const u = (x - groundX0) / groundW, v = (z - groundZ0) / groundH;
    if (u > 0.6 && v > 0.32 && v < 0.78) return 'F';            // осенний лес справа
    if (u > 0.3 && u < 0.7 && v > 0.62) return 'G';             // луг снизу по центру
    if (u < 0.3 && v > 0.68) return 'H';                         // низина слева снизу: тёмные ели на скале
    return null;
  };
  const nameSpots = (spots, r, byName) => { for (let [x, z, biome, edge] of spots) {
    const zn = zoneOf(x, z);
    if (zn === 'F' && biome === 'forest') biome = 'autumn';      // F: сплошная красно-оранжевая масса
    if (zn === 'H' && biome !== 'fairy') { biome = 'ridge'; if (r() < 0.45) continue; }   // H: ~65% ели, деревьев вдвое меньше
    // G: открытый луг — деревья только по краям, центр пустой
    if (zn === 'G' && biome !== 'fairy') {
      if (r() < 0.6) continue;              // реф: ~20 деревьев группами по краям луга
      biome = 'meadow';
    }
    if (r() > (BIOME_KEEP[biome] ?? 1)) continue;          // плотность по замерам рефа
    let name;
    if (biome === 'ridge_dry') name = 'tree_dry_bush';
    else if (edge && biome !== 'fairy' && r() < 0.35) name = 'tree_bush';
    else if (biome === 'lake') name = nearWaterT(x, z) ? 'tree_willow' : pickWeighted(BIOME_MIX.lake, r);
    else if (biome === 'autumn' && x < groundX0 + groundW * 0.45) name = pickWeighted(BIOME_MIX.birch, r);   // зона D рефа: слева золотые берёзы, красная осень — только справа
    else name = pickWeighted(BIOME_MIX[biome] ?? BIOME_MIX.forest, r);
    (byName[name] ??= []).push([x, z, edge && name !== 'tree_bush' ? 0.65 : r() < 0.03 ? 1.45 : 1]);
  } };
  nameSpots(treeSpots, r, byName);
  const extraByName = {};
  nameSpots(extraSpots, r2, extraByName);
  const trees = new THREE.Group();
  const billboards = [];
  let treeBillboard = null;   // { list, mesh } — папоротники потом добавляются в этот же список
  const sprites = treeSpritesUrl ? await (async () => {
    const [tex, meta] = await Promise.all([new THREE.TextureLoader().loadAsync(treeSpritesUrl + (treeSpritesUrl.includes('sprites3') ? '.webp?v=25' : '.png')), (await fetch(treeSpritesUrl + '.json?v=25')).json()]);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return { tex, frames: meta.frames };
  })().catch(e => { console.warn('tree sprites', e); return null; }) : null;
  // Готовые деревья Quaternius «Stylized Nature MegaKit» (CC0), models/megakit/*.gltf.
  // Вид поля -> [модель, варианты, оттенок листвы (instanceColor), текстура листвы]. Остальные виды — наши.
  const KIT_SPECIES = {
    tree_spruce: ['Pine', [1, 2, 3, 4, 5]],
    tree_spruce_dark: ['Pine', [1, 2, 3, 4, 5], [0.62, 0.7, 0.72]],
    tree_pine: ['Pine', [3, 5], [1.05, 1.05, 0.9]],
    tree_birch: ['CommonTree', [3, 4, 5], [1.18, 1.18, 1.0]],
    tree_autumn_orange: ['CommonTree', [1, 2, 3, 4, 5], null, 'Leaves_NormalTree_Orange'],
    tree_autumn_yellow: ['CommonTree', [1, 2, 3, 4, 5], null, 'Leaves_NormalTree_Yellow'],
    tree_autumn_red: ['TwistedTree', [1, 2, 3, 4, 5], [0.85, 0.8, 0.8]],
    tree_dead: ['DeadTree', [1, 2, 3, 4, 5]],
    tree_snag: ['DeadTree', [2, 4], [1, 1, 1]], tree_oak_green: ['CommonTree', [1, 2, 5]],
    tree_willow: ['CommonTree', [1, 2, 5], [1.1, 1.12, 0.85]],      // ивы пока нет (готовой не нашли, наша не подходит)
    tree_bush: ['Bush_Common', [0], null, 'Leaves_TwistedTree_Green'],     // в наборе куст красный
  };
  // рисованные Codex текстуры (tools/board3d_kit_paint.py): хвоя по родному силуэту лапы, кора с мхом
  const KIT_PAINTED = { Leaves_Pine: 'Leaf_Pine_Painted', Bark_NormalTree: 'Bark_NormalTree_Painted' };
  // упрощённые модели (tools/blender/kit_decimate.py): только геометрия и имена материалов,
  // текстуры подставляются по имени материала
  const KIT_TEX = {
    Bark_NormalTree: ['Bark_NormalTree', 'Bark_NormalTree_Normal'], Bark_DeadTree: ['Bark_DeadTree', 'Bark_DeadTree_Normal'],
    Bark_TwistedTree: ['Bark_TwistedTree', 'Bark_TwistedTree_Normal'],
    Leaves_Pine: ['Leaf_Pine_C'], Leaves_NormalTree: ['Leaves_NormalTree_C'], Leaves_TwistedTree: ['Leaves_TwistedTree_C'],
    Leaves_PineCards: ['Leaf_Pine_Painted'],     // гибридная ель (tools/blender/kit_hybrid_spruce.py)
  };
  const kitTexCache = {};
  const kitTex = (file, srgb = true) => {
    if (kitTexCache[file]) return kitTexCache[file];
    const t = new THREE.TextureLoader().load(`${kitTreesUrl}${file}.webp?v=9`);
    t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return (kitTexCache[file] = t);
  };
  if (kitTreesUrl) {
    const loader = new GLTFLoader();
    const models = {};       // 'Pine_3' -> [{ geo, mat }] (геометрия приведена к высоте 1, основание в 0)
    const needed = new Set();
    for (const [name, [model, vars]] of Object.entries(KIT_SPECIES)) if (byName[name]) for (const v of vars) needed.add(v ? `${model}_${v}` : model);
    await Promise.all([...needed].map(async id => {
      const g = await loader.loadAsync(kitLodUrl ? `${kitLodUrl}${id}.glb?v=28` : `${kitTreesUrl}${id}.gltf`).catch(e => { console.warn('kit tree', id, e); return null; });
      if (!g) return;
      g.scene.updateMatrixWorld(true);
      const parts = [];
      g.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material }); });
      const box = new THREE.Box3();
      for (const pt of parts) { pt.geo.computeBoundingBox(); box.union(pt.geo.boundingBox); }
      const k = 1 / (box.max.y - box.min.y), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      for (const pt of parts) pt.geo.translate(-cx, -box.min.y, -cz).scale(k, k, k);
      models[id] = parts;
    }));
    // материалы: Ламберт (дешевле Standard), листва — альфа-срез + A2C + ветер, нормаль не переворачивается
    const kitMats = new Map();
    const kitMat = (src, leafVar) => {
      const key = src.name + '/' + (leafVar ?? '');
      if (kitMats.has(key)) return kitMats.get(key);
      const leaf = src.name.startsWith('Leaves');
      // своя текстура (перекраска листвы, рисованные хвоя/кора) или родная по имени материала
      const file = leaf && leafVar ? leafVar : KIT_PAINTED[src.name] ?? KIT_TEX[src.name]?.[0];
      const map = file ? kitTex(file) : src.map;
      const normalFile = KIT_TEX[src.name]?.[1];
      const m = new THREE.MeshLambertMaterial({
        map, normalMap: leaf ? null : normalFile ? kitTex(normalFile, false) : src.normalMap, side: leaf ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: leaf ? 0.5 : 0, alphaToCoverage: leaf,
        vertexColors: src.name === 'Leaves_PineCards',          // запечённая глубина кроны гибридной ели
      });
      const out = leaf ? addWind(m, 0.03, src.name === 'Leaves_PineCards' ? 1.6 : 1) : m;
      kitMats.set(key, out);
      return out;
    };
    const groups = new Map();        // модель/материал -> { geo, mat, list: [[matrix, color]] }
    const kitAll = [];
    for (const [name, [model, vars, tint, leafVar]] of Object.entries(KIT_SPECIES)) {
      const spots = byName[name];
      if (!spots) continue;
      const [h0, h1] = TREE_H[name] ?? [PINE_MIN, PINE_MAX];
      for (const [x, z, mul] of spots) {
        const v = vars[Math.floor(r() * vars.length)];
        const id = v ? `${model}_${v}` : model;
        const parts = models[id];
        if (!parts) continue;
        const h = (h0 + r() * (h1 - h0)) * mul * 1.1;
        // у ели карточки развёрнуты к камере (kit_hybrid_spruce.py) — поворот только ±23°, иначе встанут ребром
        q.setFromAxisAngle(up, model === 'Pine' ? (r() - 0.5) * 0.8 : r() * Math.PI * 2);
        const m = m4.compose(p.set(x, groundY(x, z) - 0.05, z), q, s.set(h * (0.92 + r() * 0.16), h, h * (0.92 + r() * 0.16))).clone();
        const t = (0.86 + r() * 0.28) * (biomeAt(x, z) === 'dark' ? 0.82 : 1);
        // у каждого дерева свой тон: от тёмного сине-зелёного до светлого жёлто-зелёного
        const warm = r() - 0.5, lt = 0.62 + r() * 0.62;
        const jit = [lt * (1 + warm * 0.9), lt * (1 + warm * 0.25), lt * (1 - warm * 1.1)];
        for (const pt of parts) {
          const leaf = pt.mat.name.startsWith('Leaves');
          const c = leaf ? (tint ?? [1, 1, 1]).map((v, k) => v * jit[k]) : [1, 1, 1];
          const key = id + '/' + pt.mat.name + '/' + (leaf ? leafVar ?? '' : '');
          if (!groups.has(key)) groups.set(key, { geo: pt.geo, mat: kitMat(pt.mat, leaf ? leafVar : null), list: [] });
          groups.get(key).list.push([m, [t * c[0] * (0.96 + r() * 0.08), t * c[1] * (0.95 + r() * 0.1), t * c[2]]]);
        }
        kitAll.push({ x, y: groundY(x, z), z, h });
      }
      delete byName[name];
    }
    for (const g of groups.values()) {
      const mesh = new THREE.InstancedMesh(g.geo, g.mat, g.list.length);
      g.list.forEach(([m, c], i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, color.setRGB(...c)); });
      mesh.castShadow = true;
      trees.add(mesh);
    }
    addBlobs(kitAll);
    T.kitTrees = kitAll.length;
    T.kitDraws = groups.size;
  }
  // «Гиблиевские» деревья всех видов (tools/blender/ghibli_trees.py): ствол + крона из листовых
  // карточек с альфа-срезом и alpha-to-coverage — непрозрачные, пишут глубину, сортировка не нужна.
  const treesGltf = treesUrl ? await new GLTFLoader().loadAsync(treesUrl).catch(e => { console.warn('trees', e); return null; }) : null;
  if (treesGltf) {
    const leafTex = await loadTex(leafAtlasUrl);
    leafTex.wrapS = leafTex.wrapT = THREE.ClampToEdgeWrapping;
    // UV в Blender заданы «v от верха картинки»; экспорт glTF переворачивает v, flipY=true возвращает обратно
    leafTex.anisotropy = 4;
    const part = name => treesGltf.scene.getObjectByName(name)?.geometry;
    const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const leafMats = {};
    const leafMat = (wind, glow) => leafMats[wind + '/' + glow] ??= addWind(new THREE.MeshLambertMaterial({
      map: leafTex, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
      ...(glow ? { emissive: 0xffffff, emissiveMap: leafTex, emissiveIntensity: glow } : {}),
    }), wind);
    // вид -> [объект ствола, объект кроны, сила ветра, свечение, оттенок]
    const SPECIES = {
      tree_spruce: ['spruce_trunk', 'spruce_leaves', 0.02],
      tree_spruce_dark: ['spruce_dark_trunk', 'spruce_dark_leaves', 0.02],
      tree_pine: ['pine_trunk', 'pine_leaves', 0.025],
      tree_birch: ['birch_trunk', 'birch_leaves', 0.04],
      tree_willow: ['willow_trunk', 'willow_leaves', 0.05],
      tree_bush: [null, 'bush_leaves', 0.015],
      tree_snag: ['dead_trunk', null, 0], tree_oak_green: ['oak_trunk', 'oak_leaves', 0.035],
      tree_dead: ['dead_trunk', null, 0],
      tree_autumn_orange: ['oak_orange_trunk', 'oak_orange_leaves', 0.035],
      tree_autumn_red: ['oak_orange_trunk', 'oak_orange_leaves', 0.035, 0, [1.0, 0.78, 0.74]],
      tree_autumn_yellow: ['oak_yellow_trunk', 'oak_yellow_leaves', 0.035],
      tree_fairy_pink: ['fairy_trunk', 'fairy_leaves_pink', 0.03, 0.35],
      tree_fairy_violet: ['fairy_trunk', 'fairy_leaves_violet', 0.03, 0.35],
      tree_fairy_teal: ['fairy_trunk', 'fairy_leaves_teal', 0.03, 0.35],
      tree_fairy_gold: ['fairy_trunk', 'fairy_leaves_gold', 0.03, 0.35],
    };
    const all = [];
    for (const [name, spots] of Object.entries(byName)) {
      const sp = SPECIES[name];
      if (!sp) continue;
      const [h0, h1] = TREE_H[name] ?? [PINE_MIN, PINE_MAX];
      for (const [x, z, mul] of spots) {
        // разброс тона у каждого дерева; в тёмном лесу — темнее
        const t = (0.84 + r() * 0.3) * (biomeAt(x, z) === 'dark' ? 0.8 : 1);
        const tint = sp[4] ?? [1, 1, 1];
        all.push({ name, x, y: groundY(x, z), z, h: (h0 + r() * (h1 - h0)) * mul * 1.1,
          tone: [t * tint[0] * (0.96 + r() * 0.08), t * tint[1] * (0.95 + r() * 0.1), t * tint[2] * (0.9 + r() * 0.12)] });
      }
      delete byName[name];
    }
    // густота рощи: в гуще темнее, на опушке светлее
    const cellOf = new Map(), key = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    for (const t of all) { const k = key(t.x, t.z); if (!cellOf.has(k)) cellOf.set(k, []); cellOf.get(k).push(t); }
    for (const t of all) {
      let n = 0;
      const cx = Math.floor(t.x / 2), cz = Math.floor(t.z / 2);
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1)
        for (const o of cellOf.get(`${cx + i},${cz + j}`) ?? []) if (o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 2.2) n += 1;
      const k = 1.08 - Math.min(n, 8) * 0.04;
      t.tone = t.tone.map(v => v * k);
      q.setFromAxisAngle(up, (r() - 0.5) * 0.8);          // карточки развёрнуты к камере — поворачиваем чуть-чуть
      t.m = m4.compose(p.set(t.x, t.y - 0.05, t.z), q, s.set(t.h * (0.93 + r() * 0.14), t.h, t.h * (0.93 + r() * 0.14))).clone();
    }
    // меши по объектам: один InstancedMesh на объект glb (стволы сказочных общие на 4 цвета)
    const groups = {};
    for (const t of all) {
      const [trunk, leaves, wind, glow] = SPECIES[t.name];
      if (trunk) (groups['T:' + trunk] ??= { geo: trunk, mat: trunkMat, list: [] }).list.push(t);
      if (leaves) (groups['L:' + leaves] ??= { geo: leaves, mat: leafMat(wind, glow ?? 0), list: [] }).list.push(t);
    }
    for (const g of Object.values(groups)) {
      const geo = part(g.geo);
      if (!geo) { console.warn('нет объекта дерева', g.geo); continue; }
      const mesh = new THREE.InstancedMesh(geo, g.mat, g.list.length);
      g.list.forEach((t, i) => { mesh.setMatrixAt(i, t.m); mesh.setColorAt(i, color.setRGB(...t.tone)); });
      mesh.castShadow = true;
      mesh.userData.species = g.geo;
      trees.add(mesh);
    }
    addBlobs(all);
    T.treeCount = all.length;
  }
  // Насколько высоким может быть дерево в (x, z), чтобы не закрыть клетки поля за собой.
  // Камера спереди-сверху (+z к зрителю), наклон ~55° от вертикали: верх дерева высоты h ложится на
  // экране поверх земли на h·tan(55°) дальше от камеры. Клетка за деревом (меньше z) в этой полосе
  // и в пределах ширины кроны — закрыта.
  const CELL_R = (() => {
    let d = Infinity;
    for (let i = 0; i < Math.min(cells.length, 60); i += 1) for (const c of cells) {
      if (c === cells[i]) continue;
      d = Math.min(d, Math.hypot(c.x - cells[i].x, c.z - cells[i].z));
    }
    return d / 2;
  })();
  const TAN_V = Math.tan(THREE.MathUtils.degToRad(55));
  const coverLimit = (x, z, halfW) => {
    let lim = Infinity;
    for (const c of cells) {
      const dz = z - c.z;
      if (dz <= 0 || Math.abs(c.x - x) > halfW + CELL_R * 0.7) continue;
      const hMax = (dz - CELL_R * 0.4) / TAN_V;
      if (hMax < lim) lim = hMax;
    }
    return lim;
  };
  if (sprites && !treesGltf) {
    const list = [];
    const addSprites = (srcByName, r) => { for (const [name, spots] of Object.entries(srcByName)) {
      const [h0, h1] = TREE_H[name] ?? [PINE_MIN, PINE_MAX];
      for (const [x, z, mul] of spots) {
        // разброс тона у каждого дерева: [сдвиг оттенка, насыщенность, яркость]
        const darkB = biomeAt(x, z) === 'dark';
        const tone = [(r() - 0.5) * 0.018 + (darkB ? 0.03 : 0), 0.95 + r() * 0.15, (0.8 + r() * 0.32) * (darkB ? 0.78 : 1)];   // оттенок почти не сдвигаем — охра уходила в лосось; разнотонность — яркостью   // разнотонность — как было (возврат 20.10)
        let h = (h0 + r() * (h1 - h0)) * mul * (groundY(x, z) > 1.0 && r() < 0.25 ? 1.3 : 1.0), group = SPRITE_GROUP[name] ?? 'spruce';   // мельче — как на рефе v6b
        // дерево не закрывает клетки за собой: ниже до допустимой высоты, а если совсем низко — куст
        const lim = coverLimit(x, z, h * 0.35);
        if (h > lim) {
          if (lim >= 1.4) h = lim;
          else if (lim >= 0.55 && group !== 'snag') { group = 'bush'; h = Math.min(0.95, lim); }
          else continue;
        }
        // цвет по породе — с концепта v6b: хвойные тёмные сине-зелёные, берёзы золотые, осень насыщенная
        const gg = SPRITE_GRADE[group];
        if (gg) { tone[0] += gg[0]; tone[1] *= gg[1]; tone[2] *= gg[2]; }
        if (bridgeCells.some(c => Math.hypot(c.x - x, c.z - z) < 2.4)) continue;   // не на мост
        if (groundY(x, z) < -0.2) continue;   // не в русле (раструб у мостов, 22.10)
        list.push({ x, y: groundY(x, z), z, h, group, pick: Math.floor(r() * 99), tint: tone });
      }
    }
    };
    addSprites(byName, r);
    addSprites(extraByName, r2);      // добавочные деревья — своим генератором, прежние не сдвигаются
    // зона B рефа: у домика тёмного леса — 3 выразительных сухих дерева за домом и по бокам
    {
      const hc = cells.filter(c => c.deck === 'dark_forest').sort((a, b) => a.z - b.z)[0];   // домик у хребта (верхний)
      if (hc) {
        const [d0, d1] = TREE_H.tree_dead;
        for (const [dx, dz, k] of [[2.0, -1.6, 1.35], [-2.0, -1.2, 0.9], [0.9, -2.4, 1.1]]) {
          const x = hc.x + dx, z = hc.z + dz;
          if (nearest(x, z) < 0.7) continue;
          T.hutDead = (T.hutDead ?? 0) + 1;
          list.push({ x, y: groundY(x, z), z, h: (d0 + d1) / 2 * k * 1.2, group: 'dead', pick: Math.floor(r() * 99), tint: [0, 0.9, 0.85] });
        }
      }
    }
    // зона E рефа: ивы кольцом по берегу озера (обычная посадка берег отсекает — там перепад высоты)
    {
      const lakeCells = cells.filter(c => c.deck === 'lake');
      const shore = [];
      for (let z = groundZ0 + 2; z < groundZ0 + groundH - 2; z += 0.5) for (let x = groundX0 + 2; x < groundX0 + groundW - 2; x += 0.5) {
        // озеро — по клеткам колоды «озеро» (у центрального озера ближайший биом — луг)
        if (!lakeCells.some(c => Math.hypot(c.x - x, c.z - z) < 7) || groundY(x, z) < -0.45) continue;   // можно и на мелководье у кромки
        if (![[1.0, 0], [-1.0, 0], [0, 1.0], [0, -1.0]].some(([dx, dz]) => groundY(x + dx, z + dz) < -0.25)) continue;
        if (nearest(x, z) < 0.6 || nearHouse(x, z, 1.4)) continue;
        if (shore.some(o => Math.hypot(o[0] - x, o[1] - z) < 1.15)) continue;
        shore.push([x, z]);
      }
      T.shoreWillows = shore.length;
      const [w0, w1] = TREE_H.tree_willow;
      for (const [x, z] of shore) {
        list.push({ x, y: Math.max(groundY(x, z), -0.25), z, h: (w0 + r() * (w1 - w0)), group: r() < 0.8 ? 'willow' : 'bush', pick: Math.floor(r() * 99),
          tint: [(r() - 0.5) * 0.04, 0.85 + r() * 0.25, 0.85 + r() * 0.25] });
      }
    }
    {
      const lakeC = cells.filter(c => c.deck === 'lake');
      for (const t of list) {
        if (!['spruce', 'pine', 'dark'].includes(t.group)) continue;
        if (!lakeC.some(c => Math.hypot(c.x - t.x, c.z - t.z) < 6)) continue;
        const nearLake = [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([dx, dz]) => groundY(t.x + dx, t.z + dz) < -0.25);
        if (!nearLake) continue;
        if (r() < 0.6) { t.group = 'bush'; t.h = 0.7 + r() * 0.3; } else { t.group = 'willow'; t.h = 3.2 + r() * 0.8; }
      }
    }
    // 24.10 зона D рефа: левая ЗОЛОТАЯ роща одной массой — вокруг клеток колоды «смешанный лес» слева: ели → берёзы,
    // свободные места дозасаживаются берёзами (плотно, кроны внахлёст), клетки/тропы/дома/вода — нет
    {
      const mixC = cells.filter(c => c.deck === 'mixed' && c.x < groundX0 + groundW * 0.45);
      const nearMix = (x, z) => mixC.some(c => Math.hypot(c.x - x, c.z - z) < 10);
      for (const t of list) if (['spruce', 'pine', 'oak_green', 'autumn_red', 'autumn_orange'].includes(t.group) && nearMix(t.x, t.z) && r() < 0.75) { t.group = 'birch'; t.tint = [0, 0.88, 0.92]; }
      const rg = rng(20261024); let add = 0;
      for (const c of mixC) for (let k = 0; k < 260; k += 1) {
        const a = rg() * Math.PI * 2, d = 2.0 + rg() * 8.0, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        if (nearest(x, z) < 1.25 || nearHouse(x, z, 2.2) || groundY(x, z) < -0.1 || groundY(x, z) > 2.2 || sample(x, z).water > 0.2) continue;
        if (list.some(t => Math.abs(t.x - x) < 0.75 && Math.abs(t.z - z) < 0.75)) continue;
        list.push({ x, y: groundY(x, z), z, h: 2.6 + rg() * 1.1, group: 'birch', pick: Math.floor(rg() * 99), tint: [0, 0.82 + rg() * 0.12, 0.86 + rg() * 0.12] }); add += 1;
      }
      T.goldGrove = add;
    }
    // не кучей: между кронами зазор (сказочные — шире); на уступах хребта рощи плотнее
    {
      const cellOf2 = new Map(), k2 = (x, z) => `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
      const keep = [];
      for (const t of list) {
        const gap = t.group.startsWith('fairy') ? 0.55 : 0;          // остальным — только не в одной точке (ниже)
        const cx = Math.floor(t.x / 3), cz = Math.floor(t.z / 3);
        let ok = true;
        for (let i = -1; i <= 1 && ok; i += 1) for (let j = -1; j <= 1 && ok; j += 1)
          for (const o of cellOf2.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(o.x - t.x, o.z - t.z) < Math.max(0.35, (o.h + t.h) * gap)) { ok = false; break; }
        if (!ok) continue;
        keep.push(t);
        const kk = k2(t.x, t.z); if (!cellOf2.has(kk)) cellOf2.set(kk, []); cellOf2.get(kk).push(t);
      }
      list.length = 0; list.push(...keep);
    }
    // 21.10 «тут прям каша — разнести»: высокие деревья РАЗНЫХ пород (и ивы между собой) не сливаются кронами —
    // позднее дерево отодвигаем от раннего на зазор ~0.28·(h1+h2), на допустимое место; некуда — убираем.
    // Однопородные рощи (ельник) не трогаем — там плотность задумана.
    {
      const fam = g => (g === 'spruce' || g === 'dark' || g === 'pine') ? 'conifer' : g;
      const tall = t => t.h > 2.0 && !t.group.startsWith('fairy');
      const clash = (a, b) => tall(a) && tall(b) && (fam(a.group) !== fam(b.group) || a.group === 'willow' && b.group === 'willow');
      const need = (a, b) => 0.28 * (a.h + b.h);   // ~ширина кроны: 0.2 оставлял перекрытие на половину
      const okSpot = (x, z, y0) => nearest(x, z) > 0.8 && !nearHouse(x, z, 1.2) && !bridgeCells.some(c => Math.hypot(c.x - x, c.z - z) < 2.4)
        && Math.abs(groundY(x, z) - y0) < 0.3 && groundY(x, z) > -0.15;
      const placed = [];
      let moved = 0, dropped = 0, shrunk = 0;
      for (const t of list) {
        let bad = placed.find(o => clash(o, t) && Math.hypot(o.x - t.x, o.z - t.z) < need(o, t));
        if (bad) {
          let done = false;
          const a0 = Math.atan2(t.z - bad.z, t.x - bad.x) || r() * 6.28;
          for (const da of [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0]) {
            const d = need(bad, t) + 0.05, nx = bad.x + Math.cos(a0 + da) * d, nz = bad.z + Math.sin(a0 + da) * d;
            if (Math.hypot(nx - t.x, nz - t.z) > 1.6 || !okSpot(nx, nz, t.y) || coverLimit(nx, nz, t.h * 0.35) < t.h) continue;
            const tt = { ...t, x: nx, z: nz, y: groundY(nx, nz) };
            if (placed.some(o => clash(o, tt) && Math.hypot(o.x - nx, o.z - nz) < need(o, tt))) continue;
            Object.assign(t, tt); done = true; moved += 1; break;
          }
          if (!done) {   // некуда отодвинуть — ниже ростом, чтобы кроны разошлись (цвет рощи сохраняется); совсем мало — убираем
            const hs = Math.min(...placed.filter(o => clash(o, t)).map(o => Math.hypot(o.x - t.x, o.z - t.z) / 0.28 - o.h));
            if (hs >= 1.6) { t.h = hs; shrunk += 1; } else { dropped += 1; continue; }
          }
        }
        placed.push(t);
      }
      list.length = 0; list.push(...placed);
      T.treesSpread = [moved, shrunk, dropped];
    }
    // 22.10: домики-модели не прячем в лесу — на пятне дома (с крышей) и перед фасадом к камере (+z) деревьев нет,
    // по бокам/сзади — только невысокие (не выше карниза)
    {
      const hm = houses.children.filter(h => !h.userData.isGate && h.userData.cell && h.userData.houseModel);
      const keep = list.filter(t => !hm.some(h => {
        const dx = Math.abs(t.x - h.position.x), dz = t.z - h.position.z;
        if (dx < 1.9 && dz > -1.9 && dz < 2.0 + 1.1 * t.h) return true;     // пятно и вид спереди: высокое дерево закрывает дальше
        if (t.h > 0.6 && onJetty(t.x, t.z)) return true;
        return dx < 3.0 && Math.abs(dz) < 3.0 && t.h > 1.8;                 // рядом — только низкое
      }));
      T.houseClear = list.length - keep.length; list.length = 0; list.push(...keep);
    }
    for (const t of list) if (t.group === 'pine') t.group = 'spruce';   // 22.10: широкая зонтичная сосна при вращении камеры «крестом» — узкая ель
    window.__treeList = list;   // отладка: посадка деревьев-спрайтов (x, z, h, group)
    // дальние — сначала: альфа-срез и так корректен по глубине, но так меньше перерисовки
    // густота рощи: сколько деревьев рядом — в гуще темнее, на опушке светлее
    const cellOf = new Map(), key = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    for (const t of list) { const k = key(t.x, t.z); if (!cellOf.has(k)) cellOf.set(k, []); cellOf.get(k).push(t); }
    for (const t of list) {
      let n = 0;
      const cx = Math.floor(t.x / 2), cz = Math.floor(t.z / 2);
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1)
        for (const o of cellOf.get(`${cx + i},${cz + j}`) ?? []) if (o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 2.2) n += 1;
      t.shade = 1.08 - Math.min(n, 8) * 0.045;
    }
    for (let i = list.length - 1; i >= 0; i -= 1) if (onBridge(list[i].x, list[i].z)) list.splice(i, 1);   // ивы, кусты — не на мосту
    const bb = billboardTrees(list, sprites.tex, sprites.frames);
    trees.add(bb);
    billboards.push(bb);
    treeBillboard = { list, mesh: bb };
    addBlobs(list);
  }
  function addBlobs(list) {
    // тени-пятна под деревьями (на земле, одним вызовом)
    const blobC = document.createElement('canvas'); blobC.width = blobC.height = 64;
    const bg2 = blobC.getContext('2d'), grd = bg2.createRadialGradient(32, 32, 3, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    bg2.fillStyle = grd; bg2.fillRect(0, 0, 64, 64);
    const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blobC), transparent: true, depthWrite: false }), list.length);
    list.forEach((t, i) => {
      const d = t.h * 0.55;
      m4.compose(p.set(t.x + 0.25, t.y + 0.03, t.z + 0.15), q.identity(), s.set(d, 1, d * 0.8));
      blobs.setMatrixAt(i, m4);
    });
    blobs.renderOrder = 1;
    trees.add(blobs);
  }
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const fairyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x2a1238 });
  for (const [name, list] of Object.entries(sprites || treesGltf ? {} : byName)) {
    const geo = kit?.[name] ?? pineGeometry();
    const mesh = new THREE.InstancedMesh(geo, name.startsWith('tree_fairy') ? fairyMat : treeMat, list.length);
    const [h0, h1] = TREE_H[name] ?? [PINE_MIN, PINE_MAX];
    list.forEach(([x, z, mul], i) => {
      const k = (h0 + r() * (h1 - h0)) * mul;
      q.setFromAxisAngle(up, r() * Math.PI * 2);
      m4.compose(p.set(x, groundY(x, z), z), q, s.set(k * (0.9 + r() * 0.2), k, k * (0.9 + r() * 0.2)));
      mesh.setMatrixAt(i, m4);
      const t = 0.88 + r() * 0.24;
      mesh.setColorAt(i, color.setRGB(t * (0.95 + r() * 0.1), t, t * (0.92 + r() * 0.12)));
    });
    mesh.castShadow = true;
    mesh.userData.species = name;
    trees.add(mesh);
  }
  const fairy = new THREE.Group();     // сказочные деревья теперь в общем наборе

  // ── Мелочь биома (этап 5): папоротник, грибы, пни, брёвна, цветы, камыш, кувшинки, ограды, овцы ──
  const props = new THREE.Group();
  const propKit = propKitUrl ? await loadKitGeos(propKitUrl).catch(() => null) : null;
  const propCounts = {};
  if (propKit) {
    const items = {};                       // имя -> [[x, y, z, scale, rotY]]
    const add = (name, x, y, z, k, ry = r() * Math.PI * 2) => (items[name] ??= []).push([x, y, z, k, ry]);

    const STEP = 0.6;
    for (let z = groundZ0; z < groundZ0 + groundH; z += STEP) {
      for (let x = groundX0; x < groundX0 + groundW; x += STEP) {
        const jx = x + (r() - 0.5) * STEP, jz = z + (r() - 0.5) * STEP;
        const dC = nearest(jx, jz);
        if (dC < 1.05 || nearHouse(jx, jz, 2.2)) continue;
        if (blocked(jx, jz)) continue;
        const gy = groundY(jx, jz);
        if (gy > 1.0) continue;                                    // хребет — отдельная история
        const m = sample(jx, jz), biome = biomeAt(jx, jz);
        const waterNear = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].some(([ox, oz]) => sample(jx + ox, jz + oz).water > 0.5);
        if (m.water > 0.5) {
          // кувшинки — у берегов озера
          if (biome === 'lake' && [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]].some(([ox, oz]) => sample(jx + ox, jz + oz).water < 0.3) && r() < 0.35)
            add('prop_lily', jx, WATER_LEVEL + 0.01, jz, 1 + r() * 0.6);
          continue;
        }
        if (waterNear && gy > -0.25) continue;                     // мокрый берег — камыш, отдельный проход ниже
        if (m.forest > 0.5) {
          if (biome === 'dark') {
            if (r() < 0.07) { /* синие светящиеся грибы убраны (21.10) — вызов r() сохранён, посадка не сдвигается */ }
            else if (r() < 0.14) add('prop_fern', jx, gy, jz, 1.1 + r() * 0.6);
          } else if (r() < (zoneOf(jx, jz) === 'G' ? 0.03 : 0.13)) add('prop_fern', jx, gy, jz, 1 + r() * 0.7);   // на лугу G папоротников почти нет (реф)
          else if (r() < 0.02) add('prop_stump', jx, gy, jz, 0.9 + r() * 0.4);
        } else if (dC < 2.2) {
          // опушка у тропы
          if (r() < 0.06) add('prop_fern', jx, gy, jz, 0.9 + r() * 0.5);
          else if (r() < 0.02) add('prop_stump', jx, gy, jz, 0.9 + r() * 0.3);
        }
        // 3D-цветочки убраны (20.10: «не нужны») — цветы на земле дают текстуры луга
      }
    }
    // ── Камыш: правила по тому, как растут тростник/рогоз ──
    // 1) только узкая полоса у кромки: мелководье до 0.25 от берега и мокрый низкий берег до 0.6
    //    (посреди русла и на глубине не растёт);
    // 2) тихая вода: берег озера, внутренние изгибы реки (намыв ила); на внешнем изгибе (подмыв),
    //    у крутых/высоких берегов и скал, у водопада — нет;
    // 3) растёт корневищами — плотные куртины вдоль берега с промежутками, в середине куртины выше.
    {
      const planEarly = planUrl ? await (await fetch(planUrl)).json().catch(() => null) : null;
      const wfp = planEarly?.waterfall;
      const pool = wfp ? [groundX0 + ((wfp.poolX[0] + wfp.poolX[1]) / 2 / 4096) * groundW, groundZ0 + (wfp.poolY / 3072) * groundH] : null;
      const isWet = (x, z) => sample(x, z).water > 0.5 && groundY(x, z) < WATER_LEVEL;
      const D8 = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
      const D16 = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
      const shoreDist = (x, z, wet) => {
        for (const d of [0.15, 0.3, 0.45, 0.6]) for (const [dx, dz] of D8) if (isWet(x + dx * d, z + dz * d) !== wet) return d;
        return Infinity;
      };
      const RS = 0.32;
      let reedN = 0;
      for (let z = groundZ0; z < groundZ0 + groundH; z += RS) {
        for (let x = groundX0; x < groundX0 + groundW; x += RS) {
          const jx = x + (r() - 0.5) * RS, jz = z + (r() - 0.5) * RS;
          const wet = isWet(jx, jz);
          const d = shoreDist(jx, jz, wet);
          if (d > (wet ? 0.25 : 0.6)) continue;                         // не у кромки
          if (nearest(jx, jz) < 1.05 || nearHouse(jx, jz, 2.2)) continue;
          if (pool && Math.hypot(jx - pool[0], jz - pool[1]) < 4.5) continue;   // у водопада — бурлит
          const gy = groundY(jx, jz);
          if (!wet && gy > WATER_LEVEL + 0.4) continue;                  // высокий сухой берег
          if (D8.some(([dx, dz]) => groundY(jx + dx * 1.3, jz + dz * 1.3) > WATER_LEVEL + 0.9)) continue;   // крутой берег/скала
          // тихая вода: доля воды вокруг. Озеро/заводь — много воды; мыс внутреннего изгиба — вода
          // с нескольких сторон; узкая прямая протока — мало (редкие куртины); внешний изгиб — нет
          let wc = 0;
          for (const [dx, dz] of D16) wc += isWet(jx + dx * 1.1, jz + dz * 1.1) + isWet(jx + dx * 2.2, jz + dz * 2.2);
          const frac = wc / 32;
          const lake = biomeAt(jx, jz) === 'lake' || frac > 0.65;
          const habitat = lake ? 1 : Math.max(0, Math.min(1, (frac - 0.25) / 0.3)) * 0.8;
          if (habitat <= 0.05) continue;
          const col = valueNoise2(jx * 0.5 + 17.3, jz * 0.5 + 3.1);     // куртины ~2 ед.
          const thr = 1 - 0.44 * habitat;                                // озеро — куртины с промежутками, не сплошь
          if (col < thr || r() > 0.6) continue;
          const core = Math.min(1, (col - thr) / 0.15);                  // к краю куртины — ниже
          add('prop_reeds', jx, wet ? WATER_LEVEL - 0.05 : gy, jz, (0.7 + 0.5 * core + r() * 0.2) * (wet ? 0.85 : 1));
          reedN += 1;
        }
      }
      propCounts.reeds_planted = reedN;
    }
    // овцы и ограды — у клеток колоды «овцы»
    for (const zn of zones.filter(zz => zz.biome === 'meadow')) {
      let sheepN = 0;
      for (let k = 0; k < 60 && sheepN < 3; k += 1) {
        const a = r() * Math.PI * 2, d = 1.6 + r() * 2;
        const x = zn.x + Math.cos(a) * d, z = zn.z + Math.sin(a) * d;
        if (nearest(x, z) < 1.1 || nearHouse(x, z, 2) || sample(x, z).water > 0.2 || sample(x, z).forest > 0.6 || Math.abs(groundY(x, z)) > 0.3) continue;
        add('prop_sheep', x, groundY(x, z), z, 0.9 + r() * 0.2); sheepN += 1;
        sheepSpots.push({ x, z, cx: zn.x, cz: zn.z });   // 23.10: живые овцы (board3d.js) — статичную не ставим
      }
      let fenceN = 0;
      for (let k = 0; k < 40 && fenceN < 2; k += 1) {
        const a = r() * Math.PI * 2, d = 2.4 + r() * 0.8;
        const x = zn.x + Math.cos(a) * d, z = zn.z + Math.sin(a) * d;
        if (nearest(x, z) < 1.4 || nearHouse(x, z, 2) || sample(x, z).water > 0.2 || Math.abs(groundY(x, z)) > 0.3) continue;
        add('prop_fence', x, groundY(x, z), z, 1, -a);    // вдоль окружности вокруг клетки
        fenceN += 1;
      }
    }
    // плоский режим: папоротники — картинками из атласа деревьев (группа fern), как деревья
    if (sprites && !treesGltf && sprites.frames.some(f => f.group === 'fern') && items.prop_fern) {
      // не под кроной дерева: плоский папоротник не может быть «под ветками» — только перед или за деревом
      const treeL = treeBillboard ? treeBillboard.list : [];
      const grid = new Map(), gk = (x, z) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
      for (const t of treeL) if (t.h > 1.2) { const k = gk(t.x, t.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
      const underCrown = (x, z) => {
        for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1)
          for (const t of grid.get(`${Math.floor(x / 2) + i},${Math.floor(z / 2) + j}`) ?? [])
            if (Math.hypot(t.x - x, t.z - z) < 0.35 * t.h + 0.3) return true;
        return false;
      };
      items.prop_fern = items.prop_fern.filter(([x, , z]) => !underCrown(x, z) && !onBridge(x, z));
      const ferns = items.prop_fern.map(([x, y, z, k]) => ({ x, y, z, h: 0.55 * k, group: 'fern', pick: Math.floor(r() * 99),
        tint: [(r() - 0.5) * 0.04, 0.6 + r() * 0.2, 0.62 + r() * 0.2] }));   // тусклее (21.10: «не такие яркие»)
      // в ОДИН отсортированный список с деревьями — иначе две сетки сравниваются по глубине от камеры
      // и папоротник с деревом меняются местами при движении
      if (treeBillboard) {
        const all = treeBillboard.list.concat(ferns);
        const nb = billboardTrees(all, sprites.tex, sprites.frames);
        trees.remove(treeBillboard.mesh);
        billboards.splice(billboards.indexOf(treeBillboard.mesh), 1);
        trees.add(nb);
        billboards.push(nb);
        treeBillboard = { list: all, mesh: nb };
      } else {
        const fb = billboardTrees(ferns, sprites.tex, sprites.frames, { writeDepth: true });
        props.add(fb);
        billboards.push(fb);
      }
      propCounts.fern_sprites = ferns.length;
      delete items.prop_fern;
    }
    // плоский режим: камыш — картинками атласа (группа reeds), сортируется вместе с деревьями
    if (sprites && treeBillboard && sprites.frames.some(f => f.group === 'reeds') && items.prop_reeds) {
      const reeds = items.prop_reeds.filter(([x, , z]) => !onBridge(x, z) && !onJetty(x, z)).map(([x, y, z, k]) => ({ x, y, z, h: 1.05 * k, group: 'reeds', pick: Math.floor(r() * 99), tint: [0, 0.9 + r() * 0.2, 0.85 + r() * 0.3] }));
      const all = treeBillboard.list.concat(reeds);
      const nb = billboardTrees(all, sprites.tex, sprites.frames);
      trees.remove(treeBillboard.mesh); billboards.splice(billboards.indexOf(treeBillboard.mesh), 1);
      trees.add(nb); billboards.push(nb);
      treeBillboard = { list: all, mesh: nb };
      propCounts.reed_sprites = reeds.length;
      delete items.prop_reeds;
    }
    // плоский режим: кувшинки — плоские картинки на воде (без толщины), из того же атласа (группа lily)
    if (sprites && sprites.frames.some(f => f.group === 'lily') && items.prop_lily) {
      // не пересекаются (зазор по размеру), и все «головой вверх»: картинка нарисована с наклоном,
      // поэтому поворот только ±15°; каждая на своей высоте над водой — без мерцания
      const lilyList = [];
      for (const [x, y, z, k] of items.prop_lily) {
        if (inJetty(x, z)) continue;   // не под мостками
        const size = 0.55 * k;
        if (lilyList.some(o => Math.hypot(o.x - x, o.z - z) < (o.size + size) * 0.55)) continue;
        lilyList.push({ x, y: y + 0.004 + lilyList.length * 0.0006, z, size, rot: (r() - 0.5) * 0.5, pick: Math.floor(r() * 99) });
      }
      const lilies = flatDecals(lilyList,
        sprites.tex, sprites.frames.filter(f => f.group === 'lily'));
      props.add(lilies);
      propCounts.lily_decals = lilyList.length;
      delete items.prop_lily;
    }
    const propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const glowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x6a3cff, emissiveIntensity: 0.6 });
    // бревно в наборе стоит вертикально (выглядело как столб) — кладём на землю
    if (propKit.prop_log && !propKit.prop_log.userData.laid) {
      const g = propKit.prop_log;
      g.computeBoundingBox();
      if (g.boundingBox.max.y - g.boundingBox.min.y > g.boundingBox.max.x - g.boundingBox.min.x) {
        g.rotateZ(Math.PI / 2); g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0);
      }
      g.userData.laid = true;
    }
    if (items.prop_log) items.prop_log = items.prop_log.filter(([x, , z]) => nearest(x, z) > 1.3);   // брёвна не на клетках
    delete items.prop_sheep;
    for (const [name, list] of Object.entries(items)) {
      if (!propKit[name]) continue;
      const mesh = new THREE.InstancedMesh(propKit[name], name === 'prop_mush_glow' ? glowMat : propMat, list.length);
      list.forEach(([x, y, z, k, ry], i) => {
        q.setFromAxisAngle(up, ry);
        m4.compose(p.set(x, y, z), q, s.set(k, k, k));
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = name === 'prop_sheep' || name === 'prop_fence' || name === 'prop_log';
      props.add(mesh);
      propCounts[name] = list.length;
    }
    group.add(props);
  }

  // ── Шпили (этап 4): мало и точечно — вертикальный ритм как в цели-арте ──
  const spires = new THREE.Group();
  const spireKit = spireKitUrl ? await loadKitGeos(spireKitUrl).catch(() => null) : null;
  if (spireKit) {
    const freeAt = (x, z, rr) => nearest(x, z) > rr && !nearHouse(x, z, 3) && sample(x, z).water < 0.2 && Math.abs(groundY(x, z)) < 0.4;
    const findSpot = (cx, cz, r0, r1, pred = () => true) => {
      for (let k = 0; k < 400; k += 1) {
        const a = r() * Math.PI * 2, d = r0 + r() * (r1 - r0);
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (freeAt(x, z, 1.6) && pred(x, z)) return [x, z];
      }
      return null;
    };
    const place = []; // [name, x, z, height, color?]
    // 1) тёмные шпили у тёмного леса (2–3), со стороны хребта
    const darkZone = zones.find(zn => zn.biome === 'dark');
    if (darkZone) for (let i = 0; i < 3; i += 1) {
      const sp = findSpot(darkZone.x, darkZone.z, 2.5, 6, (x, z) => groundY(x, z - 3) > 1 || r() < 0.3);
      if (sp) place.push(['spire_dark', ...sp, i === 0 ? 5.2 : 3.2 + r() * 1.2]);
    }
    // 2) группа каменных шпилей у подножия хребта слева
    let foot = null;
    for (let k = 0; k < 2000 && !foot; k += 1) {
      const x = groundX0 + 6 + r() * (groundW * 0.4), z = groundZ0 + 8 + r() * 14;
      if (freeAt(x, z, 2) && groundY(x, z - 2.5) > 1.5) foot = [x, z];
    }
    if (foot) for (let i = 0; i < 3; i += 1) {
      const sp = i ? findSpot(foot[0], foot[1], 0.9, 1.8) : foot;
      if (sp) place.push([i % 2 ? 'spire_stone_b' : 'spire_stone', ...sp, i === 0 ? 4.6 : 2.6 + r() * 1.2]);
    }
    // 3) одиночный «палец» в лесу слева от центра — дальше всего от клеток
    let finger = null, fd = 0;
    for (let k = 0; k < 1500; k += 1) {
      const x = -22 + r() * 16, z = -2 + r() * 14;
      const d = nearest(x, z);
      if (d > fd && freeAt(x, z, 2) && sample(x, z).forest > 0.5) { fd = d; finger = [x, z]; }
    }
    if (finger) place.push(['spire_stone', ...finger, 4.2]);
    // 4) кристаллы на сказочной поляне (3)
    const glade = zones.find(zn => zn.biome === 'fairy');
    const CRYSTAL = [0xff7ad0, 0xa47bff, 0x5fe8d8];
    if (glade) for (let i = 0; i < 3; i += 1) {
      const sp = findSpot(glade.x, glade.z, 2.0, 3.5);
      if (sp) place.push(['crystal_cluster', ...sp, 1.0 + r() * 0.5, CRYSTAL[i]]);
    }
    const byS = {};
    for (const it of place) if (it[0] === 'crystal_cluster') (byS[it[0]] ??= []).push(it);   // шпили убраны (20.10), кристаллы оставлены
    const spireMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const crystalMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x3a2050, transparent: true, opacity: 0.92 });
    for (const [name, list] of Object.entries(byS)) {
      const mesh = new THREE.InstancedMesh(spireKit[name], name === 'crystal_cluster' ? crystalMat : spireMat, list.length);
      list.forEach(([, x, z, h, col], i) => {
        q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.12, r() * Math.PI * 2, (r() - 0.5) * 0.12));
        const w = name === 'crystal_cluster' ? h : h * 0.32;
        m4.compose(p.set(x, groundY(x, z) - 0.15, z), q, s.set(w, h, w));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, col ? color.setHex(col) : color.setRGB(1, 1, 1));
      });
      mesh.castShadow = true;
      spires.add(mesh);
    }
    group.add(spires);
    // деревья, попавшие в шпили, убираем
    const tmpM2 = new THREE.Matrix4(), tmpP2 = new THREE.Vector3(), zero2 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of trees.children) {
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, tmpM2); tmpP2.setFromMatrixPosition(tmpM2);
        if (place.some(([, x, z]) => Math.hypot(tmpP2.x - x, tmpP2.z - z) < 1.2)) mesh.setMatrixAt(i, zero2);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Россыпь валунов у подножия скал и обрывов (сами скалы — поднятая земля, см. heightAt).
  const rockGeos = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  const rockSpots = [[], [], []];
  const ROCK_STEP = 0.7;
  for (let z = groundZ0; z < groundZ0 + groundH; z += ROCK_STEP) {
    for (let x = groundX0; x < groundX0 + groundW; x += ROCK_STEP) {
      const jx = x + (r() - 0.5) * ROCK_STEP * 0.9, jz = z + (r() - 0.5) * ROCK_STEP * 0.9;
      const m = sample(jx, jz);
      if (m.rock < 0.2 || m.rock > 0.45 || r() > 0.55) continue;      // только кромка скального пятна
      if (nearest(jx, jz) < CELL_CLEAR) continue;
      if (nearHouse(jx, jz, 1.9)) continue;
      const size = 0.22 + r() * 0.3;
      const gy = groundY(jx, jz);
      if (gy > 0.3 || gy < -0.5) continue;      // россыпь только у подножия, не на скале и не в глубокой воде
      if (underRock(jx, jz)) continue;
      rockSpots[0].push([jx, gy, jz, size * 2]);
    }
  }
  mark('rockSpots');
  // старые камни-многогранники убраны: россыпь ставится камнями из набора Blender (ниже)
  const rocks = new THREE.Group();

  const gate = houses.children.find(h => h.userData.isGate) ?? null;
  const terraces = new THREE.Group();
  let monolithMat = null;
  {
    const geos = STONE_KIT.map((kit, i) => kitGeos?.[i] ?? stoneBlockGeometry(kit));
    const lists = STONE_KIT.map(() => []);
    if (rockStyle === 'monolith') {
      const mat = rockMaterial(rockTopTex, rockSideTex, { blocks: true });
      mat.customProgramCacheKey = () => 'rock-blocks';
      monolithMat = rockMaterial(rockTopTex, rockSideTex);   // для отдельных камней — без атрибута тона блока
      // все скалы — одной сеткой: один вызов отрисовки
      const parts = [];
      rockData.forEach((rk, i) => rockMonolith(rk, toWorldXZ, 900 + i, mat).children.forEach(m => parts.push(m.geometry)));
      // ворота v4 (22.10): скала вокруг — тем же генератором блоков, что и скалы поля: по бокам буквой П, над аркой и
      // туннелем — нависающая «крышка» (низ выше ромба замка). Контуры — в осях модели (X вправо, Y в гору), м × k.
      if (gate?.userData.v4) {
        gate.traverse(o => { if (o.isMesh && o.material.name === 'gate_rock') o.material = monolithMat; });   // заполнение за аркой — тем же камнем
        const k = gate.children[0].scale.x, ry = gate.rotation.y, gx0 = gate.position.x, gz0 = gate.position.z;
        const W = ([X, Y]) => { const lx = X * k, lz = -Y * k; return [gx0 + lx * Math.cos(ry) + lz * Math.sin(ry), gz0 - lx * Math.sin(ry) + lz * Math.cos(ry)]; };
        const side = sg => [[2.45, 1.15], [3.85, 0.85], [4.40, 2.45], [4.05, 4.90], [1.52, 4.90], [1.52, 3.24], [2.45, 3.24]].map(([X, Y]) => [sg * X, Y]);
        const inner = sg => [[2.45, 1.70], [3.30, 1.60], [3.40, 4.30], [1.52, 4.30], [1.52, 3.24], [2.45, 3.24]].map(([X, Y]) => [sg * X, Y]);
        const gateRocks = [
          ...[-1, 1].map(sg => ({ x: gx0 + sg * 7, y: gz0, levels: [{ top: 3.7 * k, pts: side(sg).map(W) }, { top: 4.55 * k, pts: inner(sg).map(W) }] })),
          { x: gx0, y: gz0 + 7, base: 4.24 * k, levels: [{ top: 4.75 * k, pts: [[-2.5, 2.0], [2.5, 2.0], [2.5, 3.26], [1.54, 3.26], [1.54, 5.7], [-1.54, 5.7], [-1.54, 3.26], [-2.5, 3.26]].map(W) }] },
        ];
        const id = (x, z) => [x, z];
        // 23.10: глыбы вокруг ворот теперь в самой модели (по развёртке Codex, без навеса) — генератор сцены здесь выключен
        if (false) gateRocks.forEach((rk, i) => rockMonolith(rk, id, 1900 + i, mat).children.forEach(m => parts.push(m.geometry)));
      }
      if (parts.length) {
        const merged = new THREE.Mesh(mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g))), mat);
        merged.castShadow = merged.receiveShadow = true;
        terraces.add(merged);
      }
    } else {
      rockData.forEach((rk, i) => terraceStones(rk, toWorldXZ, 900 + i).forEach(st => lists[st[8]].push(st)));
    }
    // отдельные камни: свои у каждой скалы и все мелкие пятна плана
    const allStones = modeledRocks === 'all' ? rocksJson.stones : rockData.flatMap(rk => {
      const [cx, cz] = toWorldXZ(rk.x, rk.y);
      return rocksJson.stones.filter(st => { const [x, z] = toWorldXZ(st.x, st.y); return Math.hypot(x - cx, z - cz) < 7; });
    });
    for (const st of [...rockData.flatMap(rk => rk.stones ?? []), ...allStones]) {
      const [sx, sz] = toWorldXZ(st.x, st.y);
      if (nearest(sx, sz) < 1.25 || nearHouse(sx, sz, 1.6)) continue;     // не на клетках и не у домов
      const one = looseStone(st, toWorldXZ, groundY, r); lists[one[8]].push(one);
    }
    // 22.10 разбор п.9: осыпь группами у подножия каждой скалы — на каждые ~3.5 единицы наружного периметра одна группа
    // (1 крупный обломок + 2–4 малых), центры в 0.20–0.75 от стены, утоплены на 20–35%; максимум 5 групп на скалу
    {
      const sr = rng(20261025);
      const placed = [];
      for (const rk of rockData) {
        const poly = rk.levels[0].pts.map(([px, py]) => toWorldXZ(px, py));
        let per = 0; for (let i = 0; i < poly.length; i += 1) per += Math.hypot(poly[(i + 1) % poly.length][0] - poly[i][0], poly[(i + 1) % poly.length][1] - poly[i][1]);
        const nG = Math.min(5, Math.floor(per / 3.5));
        let cxm = 0, czm = 0; poly.forEach(([x, z]) => { cxm += x / poly.length; czm += z / poly.length; });
        for (let g = 0; g < nG; g += 1) {
          // точка на контуре по доле периметра + нормаль наружу (от центра)
          let t = (g + sr() * 0.6) / nG * per, i = 0;
          for (; i < poly.length; i += 1) { const L = Math.hypot(poly[(i + 1) % poly.length][0] - poly[i][0], poly[(i + 1) % poly.length][1] - poly[i][1]); if (t <= L) break; t -= L; }
          const [ax, az] = poly[i % poly.length], [bx, bz] = poly[(i + 1) % poly.length];
          const L = Math.hypot(bx - ax, bz - az) || 1, ex = ax + (bx - ax) * t / L, ez = az + (bz - az) * t / L;
          let nx = -(bz - az) / L, nz = (bx - ax) / L; if ((ex - cxm) * nx + (ez - czm) * nz < 0) { nx = -nx; nz = -nz; }
          const members = [[0.70 + sr() * 0.45, 0.20 + sr() * 0.25]];
          for (let k = 0, n = 2 + Math.floor(sr() * 3); k < n; k += 1) members.push([0.20 + sr() * 0.28, 0.35 + sr() * 0.45]);
          const grp = [];
          let ok = true;
          for (const [d, off] of members) {
            const side = (sr() - 0.5) * 1.2;
            const x = ex + nx * (off + d * 0.4) - nz * side, z = ez + nz * (off + d * 0.4) + nx * side;
            const gy = groundY(x, z);
            if (nearest(x, z) < 1.25 + d * 0.5 || nearHouse(x, z, 1.9) || sample(x, z).water > 0.2 || gy < -0.25 || onBridge(x, z)) { if (d > 0.6) { ok = false; break; } continue; }
            if (placed.some(([px, pz, pd]) => Math.hypot(px - x, pz - z) < 0.40 * (pd + d))) continue;
            grp.push([x, z, d, gy]);
          }
          if (!ok) continue;
          for (const [x, z, d, gy] of grp) {
            const kit = d > 0.6 ? [3, 1, 4][Math.floor(sr() * 3)] : (d < 0.32 ? 5 : 3), ks = STONE_KIT[kit].size;
            const h = d * (0.55 + sr() * 0.25), bury = 0.20 + sr() * 0.15;
            lists[kit].push([x, gy + h * (0.5 - bury), z, d / ks[0], h / ks[1], d * (0.85 + sr() * 0.2) / ks[2], sr() * 6.28, 0.84 + sr() * 0.2, kit]);
            placed.push([x, z, d]);
          }
        }
      }
      T.scree = placed.length;
    }
    // россыпь у подножия скал (кромка скальных пятен маски) — камешки и мелкие валуны
    for (const [x, gy, z, d] of rockSpots[0]) {
      const kit = d < 0.7 ? 5 : 3, ks = STONE_KIT[kit].size, h = d * 0.6;
      lists[kit].push([x, gy + h * (0.5 - 0.25), z, d / ks[0], h / ks[1], d * 0.9 / ks[2], r() * 6.28, 0.84 + r() * 0.15, kit]);   // утоплен на четверть
    }
    // ── Камни в руслах и маска порогов (разбор воды Codex, шаг 2) ──
    // группы частично погружённых валунов в реках (не в озере), мокрые — темнее; у каждого — пятно белой воды,
    // вытянутое вдоль русла. Озеро спокойное. Свой генератор — остальная посадка не сдвигается.
    {
      const rq = rng(20261023);
      const lakeCs = cells.filter(c => c.deck === 'lake');
      const RES = 512, RZ = Math.round(RES * groundH / groundW), rap = new Float32Array(RES * RZ);
      const blob = (cx, cz, ax, az, rl, rw, amp) => {      // эллипс вдоль (ax,az): длина rl, ширина rw
        const R = Math.max(rl, rw), i0 = Math.floor((cx - R - groundX0) / groundW * RES), i1 = Math.ceil((cx + R - groundX0) / groundW * RES);
        const j0 = Math.floor((cz - R - groundZ0) / groundH * RZ), j1 = Math.ceil((cz + R - groundZ0) / groundH * RZ);
        for (let j = Math.max(0, j0); j <= Math.min(RZ - 1, j1); j += 1) for (let i = Math.max(0, i0); i <= Math.min(RES - 1, i1); i += 1) {
          const x = groundX0 + (i + 0.5) / RES * groundW - cx, z = groundZ0 + (j + 0.5) / RZ * groundH - cz;
          const u = (x * ax + z * az) / rl, v = (-x * az + z * ax) / rw;
          rap[j * RES + i] = Math.max(rap[j * RES + i], amp * Math.exp(-(u * u + v * v) * 1.6));
        }
      };
      const flowImg = await loadMask('./data/water-flow.png?v=4').catch(() => null);
      const flowAt = (x, z) => {
        if (!flowImg) return null;
        const i = Math.min(flowImg.w - 1, Math.max(0, Math.floor((x - groundX0) / groundW * flowImg.w)));
        const j = Math.min(flowImg.h - 1, Math.max(0, Math.floor((z - groundZ0) / groundH * flowImg.h)));
        const o = (j * flowImg.w + i) * 4;
        return [flowImg.data[o] / 127.5 - 1, flowImg.data[o + 1] / 127.5 - 1];
      };
      const riverAxis = (x, z) => {   // направление русла: где вдоль линии больше воды
        let best = 0, bw = -1;
        for (let a = 0; a < 180; a += 15) { const ux = Math.cos(a * Math.PI / 180), uz = Math.sin(a * Math.PI / 180); let w = 0;
          for (let t = -2; t <= 2; t += 0.4) w += sampleMask(x + ux * t, z + uz * t).water; if (w > bw) { bw = w; best = a; } }
        return [Math.cos(best * Math.PI / 180), Math.sin(best * Math.PI / 180)];
      };
      let nr = 0;
      for (let z = groundZ0; z < groundZ0 + groundH; z += 0.9) for (let x = groundX0; x < groundX0 + groundW; x += 0.9) {
        const jx = x + (rq() - 0.5) * 0.9, jz = z + (rq() - 0.5) * 0.9;
        if (sampleMask(jx, jz).water < 0.72 || heightAt(jx, jz) > -0.32) continue;   // только в самом русле, не на песке
        if (lakeCs.some(c => Math.hypot(c.x - jx, c.z - jz) < 7.0) || onBridge(jx, jz) || nearest(jx, jz) < 1.1) continue;
        if (valueNoise2(jx * 0.35 + 11.7, jz * 0.35 - 4.2) < 0.48 || rq() > 0.6) continue;   // группами, не россыпью
        const [ax, az] = riverAxis(jx, jz);
        const n = 1 + Math.floor(rq() * 3);
        for (let k = 0; k < n; k += 1) {
          const big = k === 0, d = big ? 0.35 + rq() * 0.35 : 0.12 + rq() * 0.15;
          const sx = jx + (rq() - 0.5) * 0.8, sz = jz + (rq() - 0.5) * 0.8;
          const kit = big ? 3 : 5, ks = STONE_KIT[kit].size, h = d * (0.55 + rq() * 0.3);
          if (sampleMask(sx, sz).water < 0.68) continue;
          lists[kit].push([sx, WATER_LEVEL - h * 0.32, sz, d / ks[0], h / ks[1], d * 0.9 / ks[2], rq() * 6.28, 0.5 + rq() * 0.12, kit]);   // мокрые — темнее
          const fv = flowAt(sx, sz);
          if (fv && Math.hypot(fv[0], fv[1]) > 0.3) {   // шлейф ниже по течению: пятно у камня + хвост
            const fn = Math.hypot(fv[0], fv[1]), fx2 = fv[0] / fn, fz2 = fv[1] / fn;
            blob(sx, sz, fx2, fz2, d * 0.9 + 0.12, d * 0.7 + 0.08, big ? 1.0 : 0.55);
            blob(sx + fx2 * (d * 1.4 + 0.3), sz + fz2 * (d * 1.4 + 0.3), fx2, fz2, d * 1.8 + 0.3, d * 0.55 + 0.06, big ? 0.75 : 0.4);
          } else blob(sx, sz, ax, az, d * 1.7 + 0.18, d * 0.75 + 0.08, big ? 1.0 : 0.55);
          nr += 1;
        }
      }
      const data = new Uint8Array(RES * RZ * 4);
      for (let k = 0; k < RES * RZ; k += 1) { data[k * 4] = Math.min(255, Math.round(rap[k] * 255)); data[k * 4 + 3] = 255; }
      const rt = new THREE.DataTexture(data, RES, RZ); rt.magFilter = rt.minFilter = THREE.LinearFilter; rt.needsUpdate = true;
      if (waterMat.uniforms?.rapids) waterMat.uniforms.rapids.value = rt;
      propCounts.riverRocks = nr;
      // ── карта отражений (разбор воды Codex, шаг 3): R — тёмные массы деревьев/домов/скал у воды, G — тёплые огни.
      // Отражение лежит от основания к зрителю (+z — камера всегда спереди), длина ~ высота предмета.
      const rf = new Float32Array(RES * RZ * 2);
      const paint = (cx, cz, len, w, amp, ch) => {
        const i0 = Math.floor((cx - w - groundX0) / groundW * RES), i1 = Math.ceil((cx + w - groundX0) / groundW * RES);
        const j0 = Math.floor((cz - groundZ0) / groundH * RZ), j1 = Math.ceil((cz + len - groundZ0) / groundH * RZ);
        for (let j = Math.max(0, j0); j <= Math.min(RZ - 1, j1); j += 1) for (let i = Math.max(0, i0); i <= Math.min(RES - 1, i1); i += 1) {
          const x = groundX0 + (i + 0.5) / RES * groundW - cx, z = groundZ0 + (j + 0.5) / RZ * groundH - cz;
          if (z < 0) continue;
          const t = z / len, ww = w * (1 - 0.35 * t);
          const v = amp * Math.max(0, 1 - Math.abs(x) / ww) * Math.max(0, 1 - t) ** 0.7;
          const k = (j * RES + i) * 2 + ch; rf[k] = Math.max(rf[k], v);
        }
      };
      const disc = (cx, cz, rad, amp, ch = 0) => {   // тень/отражение нависающей кроны — пятно вокруг основания
        const i0 = Math.floor((cx - rad - groundX0) / groundW * RES), i1 = Math.ceil((cx + rad - groundX0) / groundW * RES);
        const j0 = Math.floor((cz - rad - groundZ0) / groundH * RZ), j1 = Math.ceil((cz + rad - groundZ0) / groundH * RZ);
        for (let j = Math.max(0, j0); j <= Math.min(RZ - 1, j1); j += 1) for (let i = Math.max(0, i0); i <= Math.min(RES - 1, i1); i += 1) {
          const x = groundX0 + (i + 0.5) / RES * groundW - cx, z = groundZ0 + (j + 0.5) / RZ * groundH - cz;
          const v = amp * Math.max(0, 1 - Math.hypot(x, z) / rad) ** 0.8;
          const k = (j * RES + i) * 2 + ch; rf[k] = Math.max(rf[k], v);
        }
      };
      const nearWaterXZ = (x, z) => [0.8, 1.6, 2.6].some(dz => sampleMask(x, z + dz).water > 0.4);
      for (const t of treeBillboard?.list ?? []) {
        if (t.h < 1.2) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1], [1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([a, b]) => sampleMask(t.x + a * 1.2, t.z + b * 1.2).water > 0.4)) disc(t.x, t.z, 0.8 * t.h, 0.85);
        if (!nearWaterXZ(t.x, t.z)) continue;
        paint(t.x, t.z + 0.1, t.h * 1.1, Math.max(0.4, 0.42 * t.h * Math.min(1.2, t.aspect ?? 0.7)), t.group === 'willow' ? 1.0 : 0.85, 0); propCounts.refl = (propCounts.refl ?? 0) + 1;
      }
      houses.updateMatrixWorld(true);
      for (const h of houses.children) {
        const b = new THREE.Box3().setFromObject(h);
        const cx = (b.min.x + b.max.x) / 2;
        if (!nearWaterXZ(cx, b.max.z)) continue;
        paint(cx, b.max.z, (b.max.y - b.min.y) * 0.9, (b.max.x - b.min.x) / 2, 0.9, 0);
        h.traverse(o => { if (o.userData.torch || o.userData.firePoint) { const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); paint(p.x, b.max.z, 2.0, 0.3, 1.0, 1); } });
      }
      bridges.updateMatrixWorld(true);
      bridges.traverse(o => { if (o.userData.firePoint) { const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); paint(p.x, p.z + 0.2, 2.2, 0.28, 1.0, 1); disc(p.x, p.z, 1.8, 0.7, 1); } });   // отблеск факела на ближней воде
      const rd = new Uint8Array(RES * RZ * 4);
      for (let k = 0; k < RES * RZ; k += 1) { rd[k * 4] = Math.round(Math.min(1, rf[k * 2]) * 255); rd[k * 4 + 1] = Math.round(Math.min(1, rf[k * 2 + 1]) * 255); rd[k * 4 + 3] = 255; }
      const rtx = new THREE.DataTexture(rd, RES, RZ); rtx.magFilter = rtx.minFilter = THREE.LinearFilter; rtx.needsUpdate = true;
      if (waterMat.uniforms?.reflTex) waterMat.uniforms.reflTex.value = rtx;
    }
    // отдельные камни — тем же рисованным материалом, что и скала (единый стиль)
    const stoneMat = monolithMat ?? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    geos.forEach((geo, gi) => {
      const list = lists[gi];
      const mesh = new THREE.InstancedMesh(geo, stoneMat, Math.max(1, list.length));
      mesh.count = list.length;
      list.forEach(([x, y, z, sx, sy, sz, ry, shade], i) => {
        q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.12, ry, (r() - 0.5) * 0.12));
        m4.compose(p.set(x, y, z), q, s.set(sx, sy, sz));
        mesh.setMatrixAt(i, m4);
        mesh.setColorAt(i, color.setRGB(shade, shade * 0.98, shade * 0.95));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      terraces.add(mesh);
    });
  }
  group.add(trees, fairy, rocks, houses, terraces);

  // ── Река на плато и водопад (данные — data/plan.json → waterfall) ──
  const animated = [];
  const plan = planUrl ? await (await fetch(planUrl)).json() : null;
  const wf = plan?.waterfall;
  if (wf && waterMat.uniforms?.poolC) waterMat.uniforms.poolC.value.set(groundX0 + ((wf.poolX[0] + wf.poolX[1]) / 2 / 4096) * groundW, groundZ0 + (wf.poolY / 3072) * groundH);
  if (wf) {
    const toW = (px, py, y = 0) => new THREE.Vector3(groundX0 + (px / 4096) * groundW, y, groundZ0 + (py / 3072) * groundH);
    if (upperRiverUrl) {
      const alpha = await new THREE.TextureLoader().loadAsync(upperRiverUrl);
      const lipW0 = toW(wf.lipX[0], wf.lipY + 10), lipW1 = toW(wf.lipX[1], wf.lipY + 10);
      // река на плато — та же вода, что внизу (глубина, рябь Вороного, пена у берега); расстояние
      // до берега — по маске реки: доля «воды» в кольцах выборок вокруг точки
      let upperMat;
      if (waterDist) {
        const fs = waterMat.fragmentShader
          .replace('float d = texture2D(dist, vUv).r;', `float m = texture2D(dist, vUv).r;
        if (m < 0.02) discard;
        float acc = 0.0;
        for (int k = 0; k < 12; k++) { float an = float(k) * 0.5236;
          vec2 o = vec2(cos(an), sin(an)) / vec2(1024.0, 768.0);
          acc += texture2D(dist, vUv + o * 4.0).r + texture2D(dist, vUv + o * 9.0).r + texture2D(dist, vUv + o * 16.0).r; }
        float d = clamp((acc / 36.0 - 0.5) * 2.0, 0.0, 1.0);
        // у кромки водопада срез маски — не берег: без пены, вода уходит в струю
        float lipK = 1.0 - smoothstep(lipR * 0.6, lipR * 1.3, length(vPos.xz - lipC));
        d = max(d, lipK * 0.7);`)
          .replace('uniform float time;', 'uniform float time; uniform vec2 lipC; uniform float lipR;')
          .replace('gl_FragColor = vec4(col, a);', `// перед водопадом течение быстрое, вода светлее — переходит в цвет струи
        col = mix(col, vec3(0.42, 0.60, 0.65) + lines * 0.12, lipK * 0.9);
        a = mix(a, 0.85, lipK);
        gl_FragColor = vec4(col, a * smoothstep(0.02, 0.5, m));`);
        upperMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { time: { value: 0 }, dist: { value: alpha }, lakeC: waterMat.uniforms.lakeC, lakeR: waterMat.uniforms.lakeR, poolC: { value: new THREE.Vector2(9999, 9999) }, rapids: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) }, rbox: waterMat.uniforms.rbox, impactC: { value: new THREE.Vector2(9999, 9999) }, impactR: { value: 1 }, flowTex: { value: new THREE.DataTexture(new Uint8Array([128, 128, 0, 255]), 1, 1) }, reflTex: waterMat.uniforms.reflTex, bridgeC: waterMat.uniforms.bridgeC, carveTex: waterMat.uniforms.carveTex, cbox: waterMat.uniforms.cbox,
            lipC: { value: new THREE.Vector2((lipW0.x + lipW1.x) / 2, (lipW0.z + lipW1.z) / 2) }, lipR: { value: lipW0.distanceTo(lipW1) * 0.75 } },
          vertexShader: waterMat.vertexShader, fragmentShader: fs });
        animated.push(upperMat);
      } else {
        upperMat = new THREE.MeshLambertMaterial({ color: 0x35c6d6, transparent: true, opacity: 0.6, alphaMap: alpha, depthWrite: false });
      }
      const upper = new THREE.Mesh(
        new THREE.PlaneGeometry(groundW, groundH).rotateX(-Math.PI / 2).translate(groundX0 + groundW / 2, wf.topH + 0.12, groundZ0 + groundH / 2),
        upperMat,
      );
      upper.renderOrder = 1;
      group.add(upper);
    }
    // верх струи — под концом воды плато (она теперь доходит до края на 14 px дальше)
    const fall = waterfallMesh(toW(wf.lipX[0], wf.lipY + 10), toW(wf.lipX[1], wf.lipY + 10),
      toW((wf.poolX[0] + wf.poolX[1]) / 2, wf.poolY), wf.topH + 0.12, WATER_LEVEL);
    const poolCenter = fall.geometry.attributes.position;
    const last = poolCenter.count - 1;
    const foam = foamRing(new THREE.Vector3((poolCenter.getX(last) + poolCenter.getX(last - 1)) / 2, WATER_LEVEL + 0.02,
      (poolCenter.getZ(last) + poolCenter.getZ(last - 1)) / 2), 1.6);
    group.add(fall, foam);
    if (waterMat.uniforms?.impactC) { waterMat.uniforms.impactC.value.set(foam.position.x, foam.position.z); waterMat.uniforms.impactR.value = 2.6; }
    foam.visible = false;   // ровное кольцо заменено ядром белой воды в шейдере
    animated.push(fall.material, foam.material);
    // туман и брызги у подножия водопада: мягкие белые частицы поднимаются и тают
    const mistTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const N = 140;
    const mp = new Float32Array(N * 3), seeds = new Float32Array(N);
    for (let i = 0; i < N; i += 1) seeds[i] = Math.random();
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mistGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    const fc = foam.position;
    const mistMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { time: { value: 0 }, tex: { value: mistTex }, base: { value: fc.clone() } },
      vertexShader: `uniform float time; uniform vec3 base; attribute float seed; varying float vA;
        void main(){
          float t = fract(time * (0.18 + seed * 0.12) + seed);
          float ang = seed * 40.0;
          vec3 p = base + vec3(cos(ang) * (0.4 + t * 1.6), t * (1.2 + seed * 1.8), sin(ang) * (0.3 + t * 1.2));
          vA = sin(t * 3.14159) * (0.7 + 0.3 * seed);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_PointSize = (700.0 + 900.0 * t) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D tex; varying float vA;
        void main(){ vec4 c = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); }`,
    });
    // у заводи водопада деревья не растут — чтобы водопад и туман не закрывались
    const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of trees.children) {
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, tmpM);
        tmpP.setFromMatrixPosition(tmpM);
        if (Math.hypot(tmpP.x - fc.x, tmpP.z - fc.z) < 3.4) mesh.setMatrixAt(i, zero);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    const mist = new THREE.Points(mistGeo, mistMat);
    mist.frustumCulled = false;
    mist.renderOrder = 3;
    group.add(mist);
    animated.push(mistMat);
  }
  if (waterDist) animated.push(waterMat);
  // створки ворот: клик открывает/закрывает (board3d.js → gate.userData.toggle), плавный поворот на петлях
  const gateLeaves = [];
  gate?.traverse(o => { if (o.name === 'door_l' || o.name === 'door_r') gateLeaves.push({ o, dir: o.name === 'door_l' ? -1 : 1 }); });
  let gateT = 0, gateOpen = false;
  if (gate) { gate.userData.toggle = () => { gateOpen = !gateOpen; return gateOpen; }; gate.userData.isOpen = () => gateOpen; }
  // Сухостой и сушняк (21.10: «нет сухостоя, должен быть сушняк»): отдельный проход со своим генератором —
  // посадка остального леса не сдвигается. Сухостой — часть деревьев внутри групп (не одиночки на лугу);
  // сушняк — у оснований деревьев в группах и на опушке, вне клеток, троп, мостов и воды.
  // 22.10: сухостой (sheet6b-snagwood) — битая альфа после кеинга; выключен до перерисовки Codex с прозрачностью
  const DEADSTAND_OK = false;   // 22.10: «такие коряги вообще не нужны» — сухостой убран совсем
  if (treeBillboard && sprites?.frames.some(f => f.group === 'deadstand')) {
    const rr = rng(20261021);
    const list = treeBillboard.list;
    const adults = list.filter(t => t.h >= 1.8 && t.y < 1.0 && /spruce|birch|autumn|pine|oak|willow|dark/.test(t.group));
    const grid = new Map(), gk = (x, z) => `${Math.floor(x / 2.5)},${Math.floor(z / 2.5)}`;
    for (const t of adults) { const k = gk(t.x, t.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
    const neigh = t => { let n = 0; for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1)
      for (const o of grid.get(`${Math.floor(t.x / 2.5) + i},${Math.floor(t.z / 2.5) + j}`) ?? []) if (o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 2.6) n += 1; return n; };
    let dead = 0, brush = 0;
    const extra = [], deadPts = [];
    for (const t of adults) {
      const n = neigh(t);
      const nearBr = [0, 0.8, 1.6, 2.4, 3.2].some(d => onBridge(t.x, t.z - d) || onBridge(t.x - d * 0.6, t.z) || onBridge(t.x + d * 0.6, t.z));
      const nearDead = deadPts.some(([dx, dz]) => Math.hypot(dx - t.x, dz - t.z) < 3.5);   // сухостой не парами: ≥3.5 м друг от друга
      if (DEADSTAND_OK && !nearBr && !nearDead && n >= 3 && rr() < (t.group === 'dark' ? 0.22 : 0.10)) {   // в группе — сухостой; наклонный — не у моста
        t.group = 'deadstand'; t.h *= 0.8 + rr() * 0.15; deadPts.push([t.x, t.z]);   // не выше соседей t.pick = Math.floor(rr() * 99); t.tint = [0, 0.85 + rr() * 0.2, 0.85 + rr() * 0.25]; dead += 1;
      }
      if (n >= 2 && rr() < 0.32) {                                                  // сушняк у основания
        const a = rr() * Math.PI * 2, d = 0.7 + rr() * 1.1, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        const gy = groundY(x, z);
        if (nearest(x, z) < 1.6 || onBridge(x, z) || gy < -0.2 || gy > 1.0 || sample(x, z).water > 0.3) continue;   // спрайт широкий — дальше от клеток
        extra.push({ x, y: gy, z, h: 0.32 + rr() * 0.16, group: 'brush', pick: Math.floor(rr() * 99), tint: [0, 0.85 + rr() * 0.2, 0.8 + rr() * 0.25] });
        brush += 1;
      }
    }
    // цветы/лопухи/иван-чай/крапива (21.10: «должны быть ещё цветы всякие») — куртинами по 2–5 на опушках и
    // у троп; шум решает, где пятно, чтобы не было ровного газона в цветочек
    let forbs = 0;
    if (sprites.frames.some(f => f.group === 'forb')) {
      for (let z = groundZ0; z < groundZ0 + groundH; z += 1.4) for (let x = groundX0; x < groundX0 + groundW; x += 1.4) {
        const jx = x + (rr() - 0.5) * 1.4, jz = z + (rr() - 0.5) * 1.4;
        if (valueNoise2(jx * 0.3 - 3.3, jz * 0.3 + 8.1) < 0.5 || rr() > 0.7) continue;
        const gy = groundY(jx, jz);
        if (gy < -0.15 || gy > 1.0 || sample(jx, jz).water > 0.2 || onBridge(jx, jz) || nearHouse(jx, jz, 1.8)) continue;
        const dc = nearest(jx, jz);
        if (dc < 1.25) continue;
        const nearTrees = grid.get(gk(jx, jz))?.some(t => Math.hypot(t.x - jx, t.z - jz) < 3.0) ?? false;
        if (!nearTrees && dc > 2.6) continue;                    // опушка или у троп/клеток, не посреди пустоты
        const kind = Math.floor(rr() * 4), n = 2 + Math.floor(rr() * 4);
        for (let k = 0; k < n; k += 1) {
          const fx = jx + (rr() - 0.5) * 0.9, fz = jz + (rr() - 0.5) * 0.9;
          if (nearest(fx, fz) < 1.2 || sample(fx, fz).water > 0.2) continue;
          extra.push({ x: fx, y: groundY(fx, fz), z: fz, h: 0.55 + rr() * 0.3, group: 'forb', pick: kind + 4 * Math.floor(rr() * 2), tint: [0, 0.8 + rr() * 0.15, 0.78 + rr() * 0.2] });
          forbs += 1;
        }
      }
    }
    propCounts.forbs = forbs;
    // опушка (разбор «парка» п.1): у крайних деревьев группы, со стороны открытого места — низкий подлесок,
    // чтобы лес не обрывался «газоном» под кронами
    let edge = 0;
    for (const t of adults) {
      const n = neigh(t);
      if (n < 1 || rr() > 0.7) continue;
      let ox = 0, oz = 0;
      for (let i = -1; i <= 1; i += 1) for (let j = -1; j <= 1; j += 1)
        for (const o of grid.get(`${Math.floor(t.x / 2.5) + i},${Math.floor(t.z / 2.5) + j}`) ?? []) if (o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 3.5) { ox += t.x - o.x; oz += t.z - o.z; }
      const ol = Math.hypot(ox, oz); if (ol < 0.8) continue;          // в глубине группы соседи со всех сторон — не край
      ox /= ol; oz /= ol;                                          // наружу из группы
      for (let k = 0; k < 3; k += 1) {
        const d = 0.5 + rr() * 1.1, sx = t.x + ox * d + (rr() - 0.5) * 0.7, sz = t.z + oz * d + (rr() - 0.5) * 0.7;
        const gy = groundY(sx, sz);
        if (nearest(sx, sz) < 1.35 || onBridge(sx, sz) || gy < -0.15 || gy > 1.0 || sample(sx, sz).water > 0.2) continue;
        const g2 = rr() < 0.45 ? 'shrub' : rr() < 0.6 ? 'forb' : 'brush';
        extra.push({ x: sx, y: gy, z: sz, h: g2 === 'shrub' ? 0.6 + rr() * 0.3 : g2 === 'forb' ? 0.5 + rr() * 0.3 : 0.32 + rr() * 0.15, group: g2, pick: Math.floor(rr() * 99), tint: [0, 0.72 + rr() * 0.15, 0.75 + rr() * 0.15], shrubScaled: true });
        edge += 1;
      }
    }
    propCounts.edgeUnder = edge;
    let all = list.concat(extra);
    if (wf) {   // у заводи водопада деревьев нет (их обнулили выше) — при пересборке не возвращать
      const px = groundX0 + ((wf.poolX[0] + wf.poolX[1]) / 2 / 4096) * groundW, pz = groundZ0 + (wf.poolY / 3072) * groundH;
      all = all.filter(t => Math.hypot(t.x - px, t.z - pz) > 3.6);
    }
    const nb = billboardTrees(all, sprites.tex, sprites.frames);
    trees.remove(treeBillboard.mesh); billboards.splice(billboards.indexOf(treeBillboard.mesh), 1);
    trees.add(nb); billboards.push(nb);
    treeBillboard = { list: all, mesh: nb };
    propCounts.deadstand = dead; propCounts.brushwood = brush;
  }
  // Нижний предел размера (21.10: «ёлки не должны быть меньше определённого значения… и иву измельчил»):
  // взрослое дерево не бывает уменьшенной копией. Ниже 85% своего минимума — либо молодняк (свои спрайты
  // young_*), либо убираем. Кусты, коряги, сушняк, папоротники, камыш — не трогаем.
  if (treeBillboard) {
    const FLOOR = {};
    for (const [nm, [h0]] of Object.entries(TREE_H)) if (h0 >= 1.8) FLOOR[SPRITE_GROUP[nm]] = h0 * 0.85;
    FLOOR.deadstand = 2.2 * 0.85;
    const YOUNG = { spruce: 'young_spruce', dark: 'young_spruce', pine: 'young_spruce', birch: 'young_birch', willow: 'young_willow',
      autumn_red: 'young_birch', autumn_orange: 'young_birch', autumn_yellow: 'young_birch', oak_green: 'young_birch' };
    const hasYoung = g => sprites?.frames.some(f => f.group === g);
    let young = 0, cut = 0;
    const kept = [];
    const rr2 = rng(20261022);
    const gv4 = houses.children.find(h => h.userData.isGate && h.userData.v4);
    const gateBox = (x, z) => {
      if (!gv4) return false;
      const k = gv4.children[0].scale.x, c = Math.cos(gv4.rotation.y), s = Math.sin(gv4.rotation.y);
      const dx = x - gv4.position.x, dz = z - gv4.position.z;
      const X = (dx * c - dz * s) / k, Y = -(dx * s + dz * c) / k;
      return X > -5.0 && X < 6.8 && Y > -0.5 && Y < 6.0;
    };
    for (const t of treeBillboard.list) {
      if (t.group !== 'lily' && onJetty(t.x, t.z, t.h)) { cut += 1; continue; }
      // перед домиком не заслонять (в т.ч. ивы, которые этот проход доращивает до взрослых ниже)
      // сухостой (наклонные коряги) — не у домиков вовсе: ложился поперёк фасада (22.10)
      if (t.group === 'deadstand' && houses.children.some(h => !h.userData.isGate && h.userData.cell && Math.hypot(t.x - h.position.x, t.z - h.position.z) < 4.5)) { cut += 1; continue; }
      // ворота v4 (23.10): ничего не растёт внутри ворот и их скалы (ёлка торчала в щели за столбом)
      if (gateBox(t.x, t.z)) { cut += 1; continue; }
      if (t.group !== 'lily' && t.h > 0.9 && houses.children.some(h => !h.userData.isGate && h.userData.cell && Math.abs(t.x - h.position.x) < 1.9 && t.z - h.position.z > -1.9 && t.z - h.position.z < 2.0 + 1.1 * Math.max(t.h, 3.2))) { cut += 1; continue; }
      if (t.h > 1.5 && [0.3, 0.9, 1.5, 2.1].some(d => d < 0.9 * t.h && onBridge(t.x, t.z - d))) { cut += 1; continue; }   // высокое прямо перед мостом (к камере) закрывает арку   // на мостках ничего не растёт (последний проход посадки)
      const fl = FLOOR[t.group];
      if (fl && t.h < fl) {
        const yg = YOUNG[t.group];
        if (t.group === 'willow' && nearest(t.x, t.z) > 0.42 * TREE_H.tree_willow[0] + 0.9) {   // иву — до взрослой, если клетки не закроет
          t.h = TREE_H.tree_willow[0] * (1 + rr2() * 0.2); kept.push(t); continue;
        }
        if (yg && hasYoung(yg)) { t.group = yg; t.h = Math.min(Math.max(t.h, 1.0), 1.7); young += 1; kept.push(t); }
        else cut += 1;
        continue;
      }
      kept.push(t);
    }
    if (young || cut) {
      kept.sorted = false;
      const nb = billboardTrees(kept, sprites.tex, sprites.frames);
      trees.remove(treeBillboard.mesh); billboards.splice(billboards.indexOf(treeBillboard.mesh), 1);
      trees.add(nb); billboards.push(nb);
      treeBillboard = { list: kept, mesh: nb };
    }
    propCounts.young = young; propCounts.tooSmallRemoved = cut;
  }
  // маска полога: плотность крон взрослых деревьев (гауссово пятно на каждое), порог — только группа
  // даёт сплошное основание, одиночка почти нет; вне клеток, на суше ниже хребта
  if (treeBillboard) {
    const RES = 512, RZ = Math.round(RES * groundH / groundW), dens = new Float32Array(RES * RZ);
    const NO = new Set(['fern', 'reeds', 'bush', 'dry_bush', 'lily', 'mushroom', 'brush', 'shrub', 'forb', 'young_spruce', 'young_birch', 'young_willow']);
    for (const t of treeBillboard.list) {
      if (NO.has(t.group) || t.h < 1.4 || t.y > 1.0) continue;
      const rad = 0.42 * t.h, ci = (t.x - groundX0) / groundW * RES, cj = (t.z - groundZ0) / groundH * RZ;
      const ri = rad / groundW * RES * 2, rj = rad / groundH * RZ * 2;
      for (let j = Math.max(0, Math.floor(cj - rj)); j <= Math.min(RZ - 1, Math.ceil(cj + rj)); j += 1)
        for (let i = Math.max(0, Math.floor(ci - ri)); i <= Math.min(RES - 1, Math.ceil(ci + ri)); i += 1) {
          const dx = (i - ci) / (ri / 2), dz = (j - cj) / (rj / 2);
          dens[j * RES + i] += Math.exp(-(dx * dx + dz * dz) * 0.9);
        }
    }
    const data = new Uint8Array(RES * RZ * 4);
    for (let j = 0; j < RZ; j += 1) for (let i = 0; i < RES; i += 1) {
      const x = groundX0 + (i + 0.5) / RES * groundW, z = groundZ0 + (j + 0.5) / RZ * groundH;
      let v = THREE.MathUtils.smoothstep(dens[j * RES + i], 0.6, 1.8);           // одиночка ~1 — слабо, группа — полностью
      if (v > 0) v *= THREE.MathUtils.smoothstep(nearest(x, z), 0.95, 1.45) * (onBridge(x, z) ? 0 : 1);      // клетки и мосты чистые
      if (v > 0) { const h = heightAt(x, z); v *= THREE.MathUtils.smoothstep(h, -0.35, -0.1) * (1 - THREE.MathUtils.smoothstep(h, 0.9, 1.4)); }
      data[(j * RES + i) * 4] = Math.round(255 * v); data[(j * RES + i) * 4 + 3] = 255;
    }
    const ct = new THREE.DataTexture(data, RES, RZ);
    ct.magFilter = ct.minFilter = THREE.LinearFilter; ct.needsUpdate = true;
    canopyU.tex.value = ct;
  }
  const update = (dt, camera) => {
    windUniform.value += dt;
    if (gateLeaves.length) {
      // инженерка: створки открываются НАРУЖУ и по очереди — сначала правая (с нащельником), потом левая;
      // закрываются в обратном порядке. gateT: 0…1 — ход правой, 1…2 — ход левой
      const target = gateOpen ? 2 : 0;
      if (gateT !== target) {
        gateT = THREE.MathUtils.clamp(gateT + Math.sign(target - gateT) * dt / 1.3, 0, 2);
        const ease = t => t * t * (3 - 2 * t);               // тяжёлые створки: медленный старт и доводка
        for (const { o, dir } of gateLeaves) {
          const t = dir > 0 ? THREE.MathUtils.clamp(gateT, 0, 1) : THREE.MathUtils.clamp(gateT - 1, 0, 1);
          o.rotation.y = dir * ease(t) * THREE.MathUtils.degToRad(85);
        }
      }
    }
    for (const m of animated) m.uniforms.time.value += dt;
    for (const m of foamMats) m.uniforms.time.value += dt;
    if (camera) for (const bb of billboards) bb.userData.resort(camera);
  };
  return {
    group, trees, fairy, rocks, bridges, bridgeIds, heightAt: groundY, gate, houses, update, terraces, cliffs, props, water, ground, sheepSpots,
    blobShadowTexture,
    stats: { timings: T, props: propCounts, trees: treeSpots.length, species: Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, v.length])), rocks: rockSpots.reduce((a, l) => a + l.length, 0), bridges: bridgeIds.size },
  };
}
