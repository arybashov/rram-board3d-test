// Прототип 3D-поля (этап 1, см. Doc/board-3d-plan.md).
// Отдельная страница: игровой клиент и сервер не трогает. Сетка клеток берётся
// из того же board-map.json и пересчитывается так же, как в game.js
// (центры из editorSource.centers, viewBox 1000×N, радиус гекса из RRAM_MAP_LAYOUT).
// 1 единица мира = радиус гекса.
import * as THREE from 'three';
import { MapControls } from './map-controls.js?v=5';
import { GLTFLoader } from './vendor/three/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from './vendor/three/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from './vendor/three/jsm/utils/BufferGeometryUtils.js';
import { buildAtmosphere } from './atmosphere.js?v=1792797075';
import { buildTerrain } from './terrain.js?v=1792797075';

const t0 = 0;   // считаем от начала навигации: HTML, three.js, карта, модели
const MOVE_RANGE = 6;          // как сумма кубиков в обычном ходу
const WALK_SPEED = 3.2;        // клеток в секунду
const TILE_TOP = 0.05;          // клетки — тонкая плашка на уровне земли
const FIGURE_HEIGHT = 1.53;    // фигурка без подставки (−15% по замечанию 20.10)

// ─── Сцена ────────────────────────────────────────────────────────────────
const stage = document.getElementById('stage');
// на телефонах (Adreno 610: 12→15 FPS от 1.5→1) — чёткость 1, на компьютере 1.5
// деревья по умолчанию плоские (на телефоне 49 FPS против 31 у 3D); ?3d=1 — 3D-деревья
const FLAT_TREES = !new URLSearchParams(location.search).has('3d');
let pixelRatioCap = matchMedia('(pointer: coarse)').matches ? 1 : 1.5;
// MSAA включён всегда: нужен для мягких краёв деревьев (alpha-to-coverage); на тайловых GPU телефонов дёшев
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// этап 0 (концепт v6b): тёмный холодный фон и дымка вдали
const BG = new THREE.Color('#151a1e');
scene.background = BG;
scene.fog = new THREE.Fog(new THREE.Color('#2b3236'), 55, 140);

// Узкий угол обзора (24°): перспектива мягче, вертикали почти не сходятся — ближе к виду цели-арта
const FOV_K = 40 / 24;   // во сколько раз камера дальше, чем при прежних 40°
const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 4, 500);   // ближняя плоскость дальше — точнее глубина

const hemi = new THREE.HemisphereLight(0xa9bccb, 0x1e2124, 1.2);   // 24.10 призрачнее: холоднее и чуть темнее   // небо холодное, земля тёмная
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd29a, 2.25);   // тёплый луч сверху-слева
// Живые тени дороги для телефонов (замер: 60 → 42–49 FPS), там — только пятна под фигурками.
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;
sun.castShadow = !IS_TOUCH;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 120 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-30, 55, 25);

// Управление «как в картах», см. map-controls.js. Наклон 18–62° от вертикали.
const controls = new MapControls(camera, renderer.domElement);

// ─── Карта ────────────────────────────────────────────────────────────────
// заставка: этапы постройки поля (terrain.js сообщает через window.__loadStage) + число загруженных файлов three
const ldFill = document.getElementById('ld-fill'), ldStage = document.getElementById('ld-stage');
const STAGES = { masks: ['Карта и рельеф', 10], bridges: ['Мосты', 18], ground: ['Земля', 28], treeSpots: ['Лес', 55], rockSpots: ['Скалы', 70], props: ['Кусты и травы', 80], done: ['Персонажи', 92] };
let ldPct = 2, ldFiles = 0;
const ldSet = (pct, text) => { ldPct = Math.max(ldPct, pct); if (ldFill) ldFill.style.width = ldPct + '%'; if (text && ldStage) ldStage.textContent = text === 'Готово' ? text : text + '…'; };
window.__loadStage = name => { const st = STAGES[name]; if (st) ldSet(st[1], st[0]); };
THREE.DefaultLoadingManager.onProgress = () => { ldFiles += 1; ldSet(Math.min(ldPct + 0.6, 90)); };
ldSet(3, 'Загрузка поля');
const boardMap = await (await fetch('../assets/board-map.json')).json();
const { width: VBW, height: VBH, radius: HEX_R } = mapGeometry(boardMap);
const art = boardMap.art || {};
const centers = boardMap.editorSource?.centers ?? {};

const cells = [];
const cellById = new Map();
for (const c of boardMap.cells) {
  const ctr = centers[c.id] ?? c.center;
  if (!ctr) continue;
  const cell = {
    ...c,
    x: (ctr.u * VBW - VBW / 2) / HEX_R,
    z: (ctr.v * VBH - VBH / 2) / HEX_R,
    index: cells.length,
  };
  cells.push(cell);
  cellById.set(c.id, cell);
}

// Копия RRAM_MAP_LAYOUT.geometry() из map-layout.js (там глобальный скрипт, не модуль).
function mapGeometry(data) {
  const pos = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const dims = (a, b) => ({ width: pos(a?.width) || pos(b?.width), height: pos(a?.height) || pos(b?.height) });
  const target = dims(data.layout?.target, data.targetImage || data.art);
  const source = dims(data.layout?.source, data.sourceImage || data.editorSource?.art || target);
  const aspect = source.width && source.height ? source.height / source.width : 0.75;
  return {
    width: 1000,
    height: Math.round(1000 * aspect),
    radius: (data.hex?.radius ?? 0.012) * Math.max(target.width || 1, target.height || 1) / (source.width || target.width || 1) * 1000,
  };
}

// ─── Местность (terrain.js): клетки на одном уровне, вода ниже, мосты, ёлки, скалы ─
const groundW = VBW * (art.scaleX ?? 1) / HEX_R;
const groundH = VBH * (art.scaleY ?? 1) / HEX_R;
const groundX0 = -VBW / 2 / HEX_R;
const groundZ0 = -VBH / 2 / HEX_R;
// Земля — пока нейтральная схема по зонам (tools/board3d_plan.py --ground), без нарисованной карты.
const groundTex = new THREE.TextureLoader().load('./data/ground-plain.png?v=2');
groundTex.colorSpace = THREE.SRGBColorSpace;
groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const tTerrain = performance.now();
const terrain = await buildTerrain({
  cells, cellById, groundX0, groundZ0, groundW, groundH, groundTex,
  maskUrl: './data/terrain-mask.png?v=5',
  cliffUrl: './data/terrain-cliff.png?v=2',
  heightUrl: './data/terrain-height.png?v=13',
  planUrl: './data/plan.json?v=2',
  gateModelUrl: './models/dwarf-gate-v4.glb?v=29',   // ворота дварфов v4 — врезаны в скалу (tools/blender/dwarf_gate_v4.py)
  upperRiverUrl: './data/upper-river.png?v=4',
  rocksUrl: './data/rocks.json?v=4',
  stoneKitUrl: './models/stone-kit.glb?v=4',   // гексовые камни из Blender (tools/blender/stone_kit.py)
  modeledRocks: 'all',   // все скалы плана (раньше — одна у моста)
  cliffKitUrl: './models/cliff-kit.glb?v=2',   // модули обрыва хребта (tools/blender/cliff_kit.py)
  grassUrl: './data/tex-grass.webp?v=1',
  treeKitUrl: './models/tree-kit.glb?v=1',
  // ?flat=1 — для сравнения FPS: вместо 3D-деревьев прежние плоские картинки (data/tree-sprites)
  ...(FLAT_TREES ? { treeSpritesUrl: './data/tree-sprites3' }   /* атлас v3: tools/board3d_tree_atlas3.py */ : { kitTreesUrl: './models/megakit/', kitLodUrl: './models/megakit-lod/',   // упрощённые для телефона (tools/blender/kit_decimate.py); готовые деревья Quaternius (CC0)
  treesUrl: './models/trees.glb?v=9', leafAtlasUrl: './data/leaf-atlas.webp?v=2' }),   // «гиблиевские» деревья (tools/blender/ghibli_trees.py)
  groundTextures: {   // этап 2: рисованные текстуры земли (Codex) + карты смешивания (tools/board3d_splat.py)
    grass: './data/tex-grass.webp?v=1', path: './data/tex-path.webp?v=1', forest: './data/tex-forest.webp?v=1',
    beach: './data/tex-beach.webp?v=1', meadow: './data/tex-meadow.webp?v=1', dark: './data/tex-darkforest.webp?v=1',
    splatA: './data/splat-a.png?v=7', splatB: './data/splat-b.png?v=7',
  },
  waterDistUrl: './data/water-dist.png?v=2',   // этап 3: расстояние до берега для шейдера воды
  spireKitUrl: './models/spire-kit.glb?v=1',   // набор шпилей и кристаллов: шпили выключены (20.10), кристаллы сказочной поляны — нужны
  propKitUrl: './models/prop-kit.glb?v=1',   // этап 5: мелочь биома (tools/blender/prop_kit.py)
  cliffTexUrl: './data/tex-rockside-v12.webp?v=1',   // концепт v6b: холодный тёмный камень блоками   // нерегулярная скала (Codex) для стен хребта
  rockStyle: 'monolith',   // цельная скала + рисованные текстуры Codex (tex-rock-top/side)
  rockTopUrl: './data/tex-rocktop-v12.webp?v=1',
  rockSideUrl: './data/tex-rockside-v12.webp?v=1',   // пока одна скала — у моста (как в концепте), точка в пикселях арта
});
scene.add(terrain.group);
const atmo = buildAtmosphere({ terrain, cells, groundX0, groundZ0, groundW, groundH, fog: !new URLSearchParams(location.search).has('nofog') });   // туман частицами как дым Unreal (?nofog — выключить)
scene.add(atmo.group);
// Туман — отдельным проходом: сцена рисуется в буфер с текстурой глубины, затем на экран, и поверх — туман,
// который читает глубину сцены (мягкий стык с любой поверхностью, Depth Fade). Без тумана — как раньше.
const fogPass = atmo.fogMesh ? (() => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  // буфер ведёт себя как экран (флаг XR в three: вывод в цветовом пространстве буфера, без sRGB-хранения) —
  // и стандартные материалы, и самописные шейдеры пишут те же байты, что на канвас; копия на экран — один в один
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.isXRRenderTarget = true;
  rt.texture.internalFormat = 'RGBA8';                    // хранение — обычные байты (как у сглаживающего буфера)
  const fogScene = new THREE.Scene();
  fogScene.add(atmo.fogMesh);
  atmo.fogMesh.material.depthTest = false;                 // перекрытие считает сам шейдер по глубине сцены
  const u = atmo.fogMesh.material.uniforms;
  u.depthTex.value = rt.depthTexture;
  const blitScene = new THREE.Scene(), blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // 24.10 блум (свой, WebGL): яркое (окна, фонари, огонь, руны) → ¼ разрешения → размытие 2×2 прохода → сложение.
  // Плюс общее приглушение к рефу v6b: всё темнее и контрастнее, а светящееся остаётся (и светит через блум).
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const qs = () => new THREE.WebGLRenderTarget(Math.max(1, size.x >> 2), Math.max(1, size.y >> 2), { type: THREE.HalfFloatType });
  const bA = qs(), bB = qs(); window.__bloomRT = [bA, bB];
  const quad = mat => { const sc = new THREE.Scene(); sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); return sc; };
  // канал свечения: только объекты слоя 1 в свой полноразмерный буфер со своей глубиной; затем маска по глубине
  // основной сцены (то, что загорожено, не светит) → ¼ разрешения → размытие
  const eRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(size.x, size.y) }); window.__eRT = eRT;
  const brightMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { map: { value: eRT.texture }, eDepth: { value: eRT.depthTexture }, sDepth: { value: rt.depthTexture }, px: { value: new THREE.Vector2(1, 1) } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D map, eDepth, sDepth; uniform vec2 px; varying vec2 vUv;
      // ¼ разрешения: блок 4×4 исходных пикселей — среднее + максимум (мелкие огоньки не теряются)
      void main(){ vec3 sum = vec3(0.0), mx = vec3(0.0);
        for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
          vec2 uv = vUv + (vec2(float(i), float(j)) - 1.5) * px;
          vec3 c = texture2D(map, uv).rgb; float de = texture2D(eDepth, uv).r, ds = texture2D(sDepth, uv).r;
          float vis = (ds <= 0.0 || de >= 0.99999) ? 1.0 : step(de, ds + 0.0004);   // огонь-спрайты глубину не пишут — их не маскируем
          c = min(c, vec3(4.0)) * vis; sum += c; mx = max(mx, c); }
        gl_FragColor = vec4(sum / 16.0 * 0.5 + mx * 0.5, 1.0); }` });
  const blurMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: { map: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D map; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(map, vUv).rgb * 0.227;
        c += (texture2D(map, vUv + dir * 1.385).rgb + texture2D(map, vUv - dir * 1.385).rgb) * 0.316;
        c += (texture2D(map, vUv + dir * 3.231).rgb + texture2D(map, vUv - dir * 3.231).rgb) * 0.070;
        gl_FragColor = vec4(c, 1.0); }` });
  const brightScene = quad(brightMat), blurScene = quad(blurMat);
  const bloomOn = !new URLSearchParams(location.search).has('nobloom');
  blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: { map: { value: rt.texture }, bloom: { value: bA.texture }, bk: { value: bloomOn ? 3.5 : 0.0 }, depthTex: { value: rt.depthTexture }, cN: { value: 1 }, cF: { value: 500 } },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D map, bloom, depthTex; uniform float bk, cN, cF; varying vec2 vUv;
      void main(){ vec3 c = texture2D(map, vUv).rgb;
        // 24.10 призрачная дымка (реф v6b): по глубине — холодный серо-голубой воздух, вверху кадра гуще (горы в тумане)
        float zb = texture2D(depthTex, vUv).r;
        float vz = (cN * cF) / (cF - zb * (cF - cN));
        float near = vz - cN;
        float haze = clamp(1.0 - exp(-max(0.0, vz - 115.0) * 0.015), 0.0, 0.40);
        haze = max(haze, smoothstep(0.68, 1.0, vUv.y) * 0.32 * step(zb, 0.9999));
        c = mix(c, vec3(0.42, 0.48, 0.52), haze);
        float l = max(c.r, max(c.g, c.b));
        vec3 dim = pow(c, vec3(1.18)) * 0.86;                        // приглушить к рефу (тени глубже)
        c = mix(dim, c, smoothstep(0.80, 0.97, l));                  // светящееся — как есть
        c += texture2D(bloom, vUv).rgb * bk;
        gl_FragColor = vec4(c, 1.0); }`,
  })));
  // 24.10 канал свечения: блум только от светящихся объектов (слой 1): окна, фонари, огонь, руны, кристаллы.
  // Остальная сцена пишется в этот буфер только глубиной (перекрывает свет), без цвета — кувшинки и вода не светятся.
  const BLOOM_LAYER = 1;
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  let bloomTagged = 0;
  const tagBloom = () => {
    let n = 0;
    scene.traverse(o => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      const em = m.emissive && (m.emissiveIntensity ?? 1) > 0.05 && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05;
      const add = (o.isSprite || o.isPoints) && m.blending === THREE.AdditiveBlending;
      if (em || add || o.userData.bloom) { o.layers.enable(BLOOM_LAYER); n += 1; }
    });
    return n;
  };
  const bloomPass = () => {
    if (!bloomOn) return;
    const w = Math.max(1, size.x >> 2), h = Math.max(1, size.y >> 2);
    if (bA.width !== w || bA.height !== h) { bA.setSize(w, h); bB.setSize(w, h); }
    if (bloomTagged < 3) bloomTagged += tagBloom() > 0 ? 1 : 0;   // модели догружаются — пометить несколько раз
    if (eRT.width !== size.x || eRT.height !== size.y) eRT.setSize(size.x, size.y);
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null;
    renderer.setRenderTarget(eRT); renderer.setClearColor(0x000000, 1); renderer.clear();
    camera.layers.set(BLOOM_LAYER); renderer.render(scene, camera); camera.layers.set(0);
    scene.background = bg; scene.fog = fog;
    brightMat.uniforms.px.value.set(1 / eRT.width, 1 / eRT.height);
    renderer.setRenderTarget(bA); renderer.render(brightScene, blitCam);
    for (let i = 0; i < 3; i += 1) {   // 3 прохода, шаг растёт — ореол
      const st = 1 + 0.5 * i;
      blurMat.uniforms.map.value = bA.texture; blurMat.uniforms.dir.value.set(st / w, 0); renderer.setRenderTarget(bB); renderer.render(blurScene, blitCam);
      blurMat.uniforms.map.value = bB.texture; blurMat.uniforms.dir.value.set(0, st / h); renderer.setRenderTarget(bA); renderer.render(blurScene, blitCam);
    }
  };
  return () => {
    renderer.getDrawingBufferSize(size);
    if (rt.width !== size.x || rt.height !== size.y) rt.setSize(size.x, size.y);
    u.res.value.copy(size); u.camNear.value = camera.near; u.camFar.value = camera.far;
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    bloomPass();
    renderer.setRenderTarget(null);
    blitScene.children[0].material.uniforms.cN.value = camera.near; blitScene.children[0].material.uniforms.cF.value = camera.far;
    renderer.render(blitScene, blitCam);
    renderer.autoClear = false;
    renderer.render(fogScene, camera);
    renderer.autoClear = true;
  };
})() : null;
terrain.stats.buildMs = Math.round(performance.now() - tTerrain);

// ─── Клетки: тонкие гексы (один InstancedMesh) + общий контур ─────────────
const palette = boardMap.display?.colors ?? {};
// Обычная клетка тропы — только тонкий контур (как в концепте); заливка — у особых
// клеток (колоды, бой, телепорт, старт) и у подсвеченных.
const isPlainCell = c => c.terrain === 'path' && !c.pointClass && !c.deck;
function baseCellColor(c) {
  const hex = palette.points?.[c.pointClass] || palette.decks?.[c.deck] || palette.terrain?.[c.terrain] || '#dbe8f7';
  return new THREE.Color(hex);
}
// Клетки на мостах (22.10): настил закрывает плоскую заливку и контур на земле — для таких клеток строим их
// по поверхности настила: точки гекса опускаем лучом сверху на модель моста (перила, столбы, крышки бортов
// отсекаем — берём только пологие грани ниже 0.45), щели между досками закрываем выборкой по соседству.
const deckRay = new THREE.Raycaster(), deckDown = new THREE.Vector3(0, -1, 0), deckFrom = new THREE.Vector3();
const deckMeshes = [];
terrain.bridges?.traverse(o => { if (o.isMesh) deckMeshes.push(o); });
terrain.bridges?.updateMatrixWorld(true);
const deckAt1 = (x, z) => {
  deckFrom.set(x, 5, z); deckRay.set(deckFrom, deckDown);
  for (const h of deckRay.intersectObjects(deckMeshes, false)) {
    let kind = null; for (let p = h.object; p && !kind; p = p.parent) kind = p.userData.kind;
    if (h.point.y > (kind === 'stone' ? 1.0 : 0.45)) continue;   // горбатый каменный — настил до +0.9
    if (kind === 'stone' && h.object.material?.name !== 'cobble') continue;   // только настил: не на столбы и бортики (22.10)
    if (kind === 'log' && !/deck|walls|endgrain/.test(h.object.material?.name ?? '') ) continue;   // бревенчатый: только настил (не перила/верёвки)
    const n = h.face?.normal.clone().transformDirection(h.object.matrixWorld);
    if (n && Math.abs(n.y) < 0.6) continue;
    return h.point.y;
  }
  return null;
};
const deckAt = (x, z) => {
  let best = deckAt1(x, z);
  if (best !== null) return best;
  for (const [dx, dz] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12], [0.2, 0.2], [-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2]]) {
    const v = deckAt1(x + dx, z + dz); if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
};
const DECK_K = 6;                                   // точек на сторону гекса
const deckCells = new Map();                        // id клетки → высоты по сетке гекса
for (const c of cells) {
  if (!deckMeshes.length) break;
  const probe = [[0, 0], ...Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3 + Math.PI / 6) * 0.7, Math.sin(i * Math.PI / 3 + Math.PI / 6) * 0.7])];
  if (!probe.some(([dx, dz]) => deckAt1(c.x + dx, c.z + dz) !== null)) continue;
  deckCells.set(c.id, true);
}
const groundTop = TILE_TOP + 0.02;
// высота, на которой стоит фигурка (22.10): на мосту — по настилу (горбатый каменный выше земли), иначе плашка клетки
const deckBoxes = [];
terrain.bridges?.children.forEach(o => deckBoxes.push(new THREE.Box3().setFromObject(o)));
const standY = (x, z) => {
  if (!deckBoxes.some(b => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z)) return TILE_TOP;
  const v = deckAt(x, z);
  return v === null ? TILE_TOP : Math.max(TILE_TOP, v);
};
const deckY = (x, z) => { const v = deckAt(x, z); return v === null ? groundTop : Math.max(groundTop, v + 0.03); };
// контур гекса радиуса R по точкам (плоский верх: вершины на углах kπ/3)
const hexRing = (c, R) => {
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a1 = (Math.PI / 3) * i, a2 = (Math.PI / 3) * (i + 1);
    for (let k = 0; k < DECK_K; k += 1) {
      const t = k / DECK_K;
      pts.push([c.x + R * (Math.cos(a1) * (1 - t) + Math.cos(a2) * t), c.z + R * (Math.sin(a1) * (1 - t) + Math.sin(a2) * t)]);
    }
  }
  return pts;
};
// заливка по настилу: кольца R = .31/.62/.93, веер от центра
function deckTileGeo(c) {
  const rings = [0.31, 0.62, 0.93].map(R => hexRing(c, R).map(([x, z]) => [x, deckY(x, z), z]));
  const pos = [c.x, deckY(c.x, c.z), c.z];
  for (const r of rings) for (const p of r) pos.push(...p);
  const N = 6 * DECK_K, idx = [];
  for (let j = 0; j < N; j += 1) idx.push(0, 1 + (j + 1) % N, 1 + j);
  for (let r = 0; r < 2; r += 1) for (let j = 0; j < N; j += 1) {
    const a = 1 + r * N + j, b = 1 + r * N + (j + 1) % N, a2 = a + N, b2 = b + N;
    idx.push(a, b, b2, a, b2, a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
const deckTiles = new Map();
const deckTileGroup = new THREE.Group(); deckTileGroup.renderOrder = 1;
scene.add(deckTileGroup);

const hexGeo = new THREE.CylinderGeometry(0.93, 0.93, TILE_TOP, 6);
hexGeo.rotateY(Math.PI / 2);   // вершина на +X: гекс с плоским верхом, как в SVG
hexGeo.translate(0, TILE_TOP / 2, 0);
const tileMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.32, depthWrite: false });   // 22.10: прозрачнее (было 0.5)
const tiles = new THREE.InstancedMesh(hexGeo, tileMat, cells.length);
tiles.renderOrder = 1;
scene.add(tiles);
let tileCells = [];              // какая клетка в каком инстансе заливки
// Невидимые гексы всех клеток — только для клика.
const pickTiles = new THREE.InstancedMesh(hexGeo, new THREE.MeshBasicMaterial({ visible: false }), cells.length);
const m4 = new THREE.Matrix4();
for (const c of cells) {
  m4.makeTranslation(c.x, deckCells.has(c.id) ? deckY(c.x, c.z) - TILE_TOP : 0.01, c.z);   // на мосту — клик по настилу
  pickTiles.setMatrixAt(c.index, m4);
}
scene.add(pickTiles);

{
  const pts = [];
  for (const c of cells) {
    if (deckCells.has(c.id)) {                     // по настилу моста
      const ring = hexRing(c, 1).map(([x, z]) => [x, deckY(x, z) + 0.005, z]);
      for (let j = 0; j < ring.length; j += 1) pts.push(...ring[j], ...ring[(j + 1) % ring.length]);
      continue;
    }
    for (let i = 0; i < 6; i += 1) {
      const a1 = (Math.PI / 3) * i, a2 = (Math.PI / 3) * (i + 1);
      pts.push(c.x + Math.cos(a1), TILE_TOP + 0.02, c.z + Math.sin(a1), c.x + Math.cos(a2), TILE_TOP + 0.02, c.z + Math.sin(a2));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const outline = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff6e0, transparent: true, opacity: 0.3 }));
  outline.renderOrder = 2;
  scene.add(outline);
}

// Ёлки из terrain.js; кнопка «Ёлки» и автотест FPS включают/выключают их.
const forest = terrain.trees;   // (автотест выключает части сцены сам — BENCH_PARTS)

// ─── Фигурки ──────────────────────────────────────────────────────────────
const SIDE_COLORS = { green: 0x35c77b, red: 0xef554f, beast: 0xb07a3c };
const loader = new GLTFLoader();
window.__loadStage('done');
const [robotGltf, foxGltf] = await Promise.all([
  loader.loadAsync('./models/RobotExpressive.glb'),
  loader.loadAsync('./models/Fox.glb'),
]);

// Робот-заглушка — 19 частей (жёсткие куски на костях + скин-кисти), MeshStandard: на 10 фигур это
// 190 вызовов отрисовки. Склеиваем в одну скин-сетку: жёсткий кусок — вес 1 на свою кость,
// цвет материала — в цвет вершин, материал Ламберт. Итог: 1 вызов на фигурку.
function mergeSkinnedModel(root) {
  root.updateMatrixWorld(true);
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  const boneIdx = new Map(bones.map((b, i) => [b, i]));
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const geos = [], parts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    const n = src.attributes.position.count;
    g.setAttribute('position', src.attributes.position.clone());
    g.setAttribute('normal', src.attributes.normal.clone());
    g.setIndex(src.index ? Array.from(src.index.array) : null);
    const c = o.material.color ?? new THREE.Color(1, 1, 1);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    if (o.isSkinnedMesh) {
      const a = src.attributes.skinIndex, w = src.attributes.skinWeight;
      for (let i = 0; i < n; i += 1) for (let k = 0; k < 4; k += 1) {
        const b = o.skeleton.bones[a.getComponent(i, k)];
        si[i * 4 + k] = (b && byName.get(b.name)) ?? 0;
        sw[i * 4 + k] = w.getComponent(i, k);
      }
    } else {
      let p = o.parent;
      while (p && !p.isBone) p = p.parent;
      const bi = p ? boneIdx.get(p) : 0;
      for (let i = 0; i < n; i += 1) { si[i * 4] = bi; sw[i * 4] = 1; }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.applyMatrix4(o.matrixWorld);
    geos.push(g);
    parts.push(o);
  });
  for (const o of parts) o.removeFromParent();
  const merged = new THREE.SkinnedMesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true }));
  merged.name = 'figure';
  root.add(merged);
  root.updateMatrixWorld(true);
  merged.bind(new THREE.Skeleton(bones), merged.matrixWorld);
  return root;
}
// склейка ломала анимацию (руки в исходной позе) — робот временная заглушка, оставляем части,
// только меняем Standard на общий Ламберт по цвету (дешевле на телефоне)
{
  const lam = new Map();
  robotGltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const k = o.material.color.getHexString();
    if (!lam.has(k)) lam.set(k, new THREE.MeshLambertMaterial({ color: o.material.color }));
    o.material = lam.get(k);
  });
}

function makeBase(side) {
  const base = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.74, 0.16, 28),
    new THREE.MeshLambertMaterial({ color: 0x241c15 }),
  );
  disc.position.y = 0.08;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.71, 0.05, 6, 32),
    new THREE.MeshBasicMaterial({ color: SIDE_COLORS[side] }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.16;
  disc.castShadow = rim.castShadow = true;
  base.add(disc, rim);
  return base;
}

// Нормализуем модель: ставим на подставку и приводим к нужной высоте/длине.
function fitModel(model, { height, length }) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);   // precise: учитывает скиннинг
  const size = box.getSize(new THREE.Vector3());
  const k = height ? height / size.y : length / Math.max(size.x, size.z);
  model.scale.setScalar(k);
  model.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(model, true);
  model.position.y -= box2.min.y;
}

const units = [];
const pickables = [];
const blobMat = new THREE.MeshBasicMaterial({ map: terrain.blobShadowTexture(), transparent: true, depthWrite: false });

function addUnit({ kind, side, cellId, gltf, clips }) {
  const cell = cellById.get(cellId);
  if (!cell) return null;
  const root = new THREE.Group();
  // подставки под фигурками убраны (20.10) — остаётся тень-пятно
  const model = SkeletonUtils.clone(gltf.scene);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  if (kind === 'fox') fitModel(model, { length: 1.87 });
  else fitModel(model, { height: FIGURE_HEIGHT });
  // Тень-пятно: на телефонах живых теней нет, а фигурка не должна «висеть».
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), blobMat);
  blob.position.y = 0.012;
  blob.renderOrder = 2;
  root.add(blob, model);
  root.position.set(cell.x, standY(cell.x, cell.z), cell.z);
  root.rotation.y = Math.atan2(-cell.x, -cell.z);   // лицом к центру поля
  scene.add(root);

  // Невидимый цилиндр для клика по фигурке (скин-меши кликаются неточно).
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, FIGURE_HEIGHT, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = FIGURE_HEIGHT / 2;
  root.add(hit);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [name, clipName] of Object.entries(clips)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
    if (clip) actions[name] = mixer.clipAction(clip);
  }
  for (const once of ['attack', 'hit']) {
    if (!actions[once]) continue;
    actions[once].setLoop(THREE.LoopOnce, 1);
    actions[once].clampWhenFinished = true;
  }
  const unit = { id: `${kind}-${units.length}`, kind, side, cell: cellId, root, mixer, actions, current: null, path: null, busy: false };
  hit.userData.unit = unit;
  pickables.push(hit);
  units.push(unit);
  play(unit, 'idle', 0);
  unit.mixer.update(Math.random() * 3);   // чтобы фигурки не дышали в унисон
  return unit;
}

function play(unit, name, fade = 0.25) {
  const next = unit.actions[name];
  if (!next || unit.current === next) return next;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (unit.current) unit.current.fadeOut(fade);
  unit.current = next;
  return next;
}

const ROBOT_CLIPS = { idle: 'Idle', walk: 'Walking', attack: 'Punch', hit: 'No' };
const FOX_CLIPS = { idle: 'Survey', walk: 'Walk', attack: 'Run', hit: 'Survey' };
for (const side of ['green', 'red']) {
  for (const cellId of Object.values(boardMap.starts?.[side] ?? {})) {
    addUnit({ kind: 'robot', side, cellId, gltf: robotGltf, clips: ROBOT_CLIPS });
  }
}
// Звери — на клетках боя у старта зелёных и красных.
const battleCells = cells.filter(c => c.pointClass === 'battle');
for (const c of [battleCells[0], battleCells[battleCells.length - 1]]) {
  if (c) addUnit({ kind: 'fox', side: 'beast', cellId: c.id, gltf: foxGltf, clips: FOX_CLIPS });
}

// ─── 2D-фигурки для сравнения (нынешние картинки, развёрнутые к камере) ───
const sprites = new THREE.Group();
sprites.visible = false;
{
  const ROLE_ART = { K: 'warrior', P: 'assistant', V: 'hunter', O: 'blacksmith', S: 'shaman' };
  const texLoader = new THREE.TextureLoader();
  for (const side of ['green', 'red']) {
    for (const [role, cellId] of Object.entries(boardMap.starts?.[side] ?? {})) {
      const cell = cellById.get(cellId);
      const name = ROLE_ART[role];
      if (!cell || !name) continue;
      const file = side === 'green' && name === 'warrior' ? 'warrior-figure-v3.webp' : `${name}-figure-v${side === 'red' && name === 'shaman' ? 1 : 2}.webp`;
      const tex = texLoader.load(`../assets/tokens/${side}/${file}`, t => {
        const aspect = t.image.width / t.image.height;
        sprite.scale.set(FIGURE_HEIGHT * 1.15 * aspect, FIGURE_HEIGHT * 1.15, 1);
      });
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.1 }));
      sprite.center.set(0.5, 0.02);
      sprite.position.set(cell.x + 1.6, TILE_TOP, cell.z);
      sprites.add(sprite);
    }
  }
}
scene.add(sprites);

// ─── Выбор, достижимые клетки, путь ───────────────────────────────────────
let selected = null;
let reachable = new Map();      // cellId → предыдущая клетка пути
let attackable = new Set();
let hoveredCell = null;

const unitAt = id => units.find(u => u.cell === id && !u.path);
const occupied = id => units.some(u => u.cell === id);

function bfs(fromId, range) {
  const prev = new Map([[fromId, null]]);
  let frontier = [fromId];
  for (let step = 0; step < range; step += 1) {
    const next = [];
    for (const id of frontier) {
      for (const nId of cellById.get(id)?.neighbors ?? []) {
        const n = cellById.get(nId);
        if (!n || prev.has(nId) || n.walkable === false || occupied(nId)) continue;
        prev.set(nId, id);
        next.push(nId);
      }
    }
    frontier = next;
  }
  prev.delete(fromId);
  return prev;
}

function pathTo(targetId) {
  const out = [];
  for (let id = targetId; id && reachable.has(id); id = reachable.get(id)) out.unshift(id);
  return out;
}

const COLOR_VALID = new THREE.Color('#ffe066');
const COLOR_ATTACK = new THREE.Color('#ff4d3d');
const COLOR_SELECTED = new THREE.Color('#ffffff');
const COLOR_HOVER = new THREE.Color('#9ff7ff');
function refreshTiles() {
  tileCells = [];
  for (const c of cells) {
    let col = isPlainCell(c) ? null : baseCellColor(c);
    if (selected && c.id === selected.cell) col = COLOR_SELECTED;
    else if (attackable.has(c.id)) col = COLOR_ATTACK;
    else if (reachable.has(c.id)) col = COLOR_VALID;
    if (c.id === hoveredCell && (reachable.has(c.id) || attackable.has(c.id))) col = COLOR_HOVER;
    if (deckCells.has(c.id)) {                      // клетка на мосту — заливка по настилу
      let dt = deckTiles.get(c.id);
      if (!dt) {
        dt = new THREE.Mesh(deckTileGeo(c), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        dt.renderOrder = 1; deckTiles.set(c.id, dt); deckTileGroup.add(dt);
      }
      dt.visible = !!col;
      if (col) { dt.material.color.copy(col); dt.material.opacity = selected ? 0.45 : 0.32; }
      continue;
    }
    if (!col) continue;
    m4.makeTranslation(c.x, 0.01, c.z);
    tiles.setMatrixAt(tileCells.length, m4);
    tiles.setColorAt(tileCells.length, col);
    tileCells.push(c);
  }
  tiles.count = tileCells.length;
  tiles.instanceMatrix.needsUpdate = true;
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
  tileMat.opacity = selected ? 0.45 : 0.32;
}
refreshTiles();

function select(unit) {
  selected = unit && !unit.busy ? unit : null;
  reachable = selected ? bfs(selected.cell, MOVE_RANGE) : new Map();
  attackable = new Set(selected
    ? (cellById.get(selected.cell)?.neighbors ?? []).filter(id => units.some(u => u.cell === id && u !== selected))
    : []);
  refreshTiles();
}

function moveSelected(targetId) {
  const unit = selected;
  const path = pathTo(targetId).map(id => cellById.get(id));
  if (!unit || !path.length) return;
  unit.path = path;
  unit.busy = true;
  unit.cell = targetId;   // клетка занята сразу, как это сделал бы сервер
  play(unit, 'walk');
  select(null);
}

function attack(attacker, targetCellId) {
  const target = units.find(u => u.cell === targetCellId);
  if (!target) return;
  const c = cellById.get(targetCellId);
  attacker.root.rotation.y = Math.atan2(c.x - attacker.root.position.x, c.z - attacker.root.position.z);
  target.root.rotation.y = attacker.root.rotation.y + Math.PI;
  attacker.busy = true;
  select(null);
  const a = play(attacker, 'attack', 0.15);
  const back = () => { attacker.busy = false; play(attacker, 'idle'); };
  if (a && attacker.actions.attack !== attacker.actions.idle) {
    setTimeout(() => { play(target, 'hit', 0.1); setTimeout(() => play(target, 'idle'), 1100); }, 350);
    setTimeout(back, a.getClip().duration * 1000);
  } else back();
}

function stepAlongPath(unit, dt) {
  const target = unit.path[0];
  const pos = unit.root.position;
  const dx = target.x - pos.x, dz = target.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const step = WALK_SPEED * dt;
  if (dist > 1e-4) {
    const want = Math.atan2(dx, dz);
    let diff = want - unit.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    unit.root.rotation.y += diff * Math.min(1, dt * 12);
  }
  if (dist <= step) {
    pos.set(target.x, standY(target.x, target.z), target.z);
    unit.path.shift();
    if (!unit.path.length) {
      unit.path = null;
      unit.busy = false;
      play(unit, 'idle');
    }
  } else {
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    pos.y = standY(pos.x, pos.z);
  }
}

// ─── Ввод: клик отличаем от перетаскивания ────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let down = null;

function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const u = raycaster.intersectObjects(pickables, false)[0];
  const t = raycaster.intersectObject(pickTiles, false)[0];
  return {
    unit: u?.object.userData.unit ?? null,
    unitDist: u?.distance ?? Infinity,
    cellId: t ? cells[t.instanceId].id : null,
    cellDist: t?.distance ?? Infinity,
  };
}

renderer.domElement.addEventListener('pointerdown', ev => { down = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; });
renderer.domElement.addEventListener('pointerup', ev => {
  if (!down || down.id !== ev.pointerId) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
  down = null;
  if (moved > 8 || ev.button === 2 || controls.hadGesture) return;
  const hit = pick(ev);
  // клик по воротам дварфов — открыть/закрыть створки (если ворота ближе клетки под курсором)
  if (terrain.gate?.userData.toggle) {
    const g = raycaster.intersectObject(terrain.gate, true)[0];
    if (g && g.distance < Math.min(hit.cellDist, hit.unitDist)) { terrain.gate.userData.toggle(); return; }
  }
  const cellId = hit.cellId;
  if (selected && cellId && attackable.has(cellId)) return attack(selected, cellId);
  if (selected && cellId && reachable.has(cellId)) return moveSelected(cellId);
  const unit = hit.unit && hit.unitDist <= hit.cellDist + 2 ? hit.unit : (cellId ? unitAt(cellId) : null);
  select(unit && unit !== selected ? unit : null);
});
renderer.domElement.addEventListener('pointermove', ev => {
  if (ev.pointerType !== 'mouse' || !selected) return;
  const id = pick(ev).cellId;
  if (id !== hoveredCell) { hoveredCell = id; refreshTiles(); }
});

// ─── Камера: стартовый вид, ограничение сдвига, повороты кнопками ─────────
// В портретной ориентации поле должно влезать по ширине, поэтому камера дальше.
const homeDistance = () => 70 * FOV_K / Math.min(1, camera.aspect * 1.25);
const HOME = { target: new THREE.Vector3(0, 0, 4), azimuth: 0, polar: THREE.MathUtils.degToRad(42), distance: homeDistance() };
function fitViewLimits() {
  HOME.distance = homeDistance();
  controls.maxDistance = Math.max(95 * FOV_K, HOME.distance + 10);
  controls.minDistance = 12 * FOV_K;
  scene.fog.near = HOME.distance + 20;
  scene.fog.far = HOME.distance + 120;
}
fitViewLimits();
const setView = view => controls.setView(view);
// Участок из концепта: мост у большой скалы (правый нижний угол карты, кроп 2300–3700 × 1800–2850 пикс.).
const BRIDGE_VIEW = (() => {
  const tx = groundX0 + (3000 / 4096) * groundW, tz = groundZ0 + (2325 / 3072) * groundH;
  return { target: new THREE.Vector3(tx, 0, tz), azimuth: -0.35, polar: THREE.MathUtils.degToRad(50), distance: 26 * FOV_K };
})();
controls.bounds = new THREE.Box3(
  new THREE.Vector3(groundX0 + 4, 0, groundZ0 + 4),
  new THREE.Vector3(groundX0 + groundW - 4, 0, groundZ0 + groundH - 4),
);
setView(HOME);

document.querySelector('[data-act="shadows"]').setAttribute('aria-pressed', String(sun.castShadow));
document.getElementById('toolbar').addEventListener('click', ev => {
  const btn = ev.target.closest('button');
  if (!btn) return;
  const act = btn.dataset.act;
  const toggle = (obj, key) => { obj[key] = !obj[key]; btn.setAttribute('aria-pressed', String(obj[key])); };
  if (act === 'rotl') controls.rotateBy(Math.PI / 4);
  else if (act === 'rotr') controls.rotateBy(-Math.PI / 4);
  else if (act === 'reset') setView(HOME);
  else if (act === 'bridge') setView(BRIDGE_VIEW);
  else if (act === 'bench') { if (!benchRunning) runBench(); }
  else if (act === 'forest') toggle(forest, 'visible');
  else if (act === 'sprites') toggle(sprites, 'visible');
  else if (act === 'shadows') {
    sun.castShadow = !sun.castShadow;
    btn.setAttribute('aria-pressed', String(sun.castShadow));
  } else if (act === 'quality') {
    const steps = [1, 1.5, 2];
    pixelRatioCap = steps[(steps.indexOf(pixelRatioCap) + 1) % steps.length];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
    renderer.setSize(innerWidth, innerHeight);
    btn.textContent = `Чёткость: ${pixelRatioCap}`;
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  fitViewLimits();
});

// ─── Цикл ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
const callsEl = document.getElementById('calls');
const trisEl = document.getElementById('tris');
let frames = 0, fpsTime = 0;
let benchFrames = null;   // длительности кадров во время автотеста (?bench=1)

// Овцы (23.10): Quaternius Farm Animals (CC0) + свои Walk/Eat (tools/blender/sheep_anim.py). Бродят вокруг клеток колоды
// «овцы»: щиплют траву / стоят 2–6 с, потом идут к новой точке в радиусе 2.6 от центра зоны.
const sheep = []; window.__sheep = sheep;
// шерсть овцы (23.10): у модели нет развёртки — текстура Codex трипланарно по координатам модели; белое — руно, чёрное — морда/ноги
const _sheepTex = {};
const sheepTex = n => _sheepTex[n] ??= (() => { const t = new THREE.TextureLoader().load(`./data/${n}.webp?v=1`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
function sheepSkin(m) {
  const wool = /white/i.test(m.name), tex = sheepTex(wool ? 'sheep-wool' : 'sheep-face'), sc = wool ? 0.55 : 1.2;
  m.color.set(0xffffff);
  m.onBeforeCompile = sh => {
    sh.uniforms.skinTex = { value: tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSP; varying vec3 vSN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSP = position; vSN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D skinTex; varying vec3 vSP; varying vec3 vSN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec3 w = pow(abs(normalize(vSN)), vec3(4.0)); w /= (w.x + w.y + w.z);
        vec3 c = texture2D(skinTex, vSP.yz * ${sc.toFixed(2)}).rgb * w.x + texture2D(skinTex, vSP.xz * ${sc.toFixed(2)}).rgb * w.y + texture2D(skinTex, vSP.xy * ${sc.toFixed(2)}).rgb * w.z;
        diffuseColor.rgb *= c * ${wool ? '1.15' : '1.0'}; }`);
  };
  m.customProgramCacheKey = () => 'sheep' + (wool ? 'w' : 'f');
  m.needsUpdate = true;
}
loader.loadAsync('./models/sheep.glb?v=2').then(g => {
  for (const sp of terrain.sheepSpots ?? []) {
    const model = SkeletonUtils.clone(g.scene);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.material = o.material.clone(); o.material.opacity = 1; o.material.transparent = false; o.material.roughness = 0.9; o.material.metalness = 0; sheepSkin(o.material); } });   // в FBX opacity 0
    fitModel(model, { length: 1.15 });
    const root = new THREE.Group(); root.add(model);
    root.position.set(sp.x, terrain.heightAt(sp.x, sp.z), sp.z); root.rotation.y = Math.random() * Math.PI * 2;
    scene.add(root);
    const mixer = new THREE.AnimationMixer(model), act = {};
    for (const [k, n] of [['walk', 'Walk'], ['eat', 'Eat'], ['idle', 'Armature|Armature|Idle']]) { const c = THREE.AnimationClip.findByName(g.animations, n); if (c) act[k] = mixer.clipAction(c); }
    const s = { sp, root, mixer, act, cur: null, t: 1 + Math.random() * 4, target: null };
    const go = k => { const a = act[k]; if (!a || s.cur === a) return; a.reset().fadeIn(0.3).play(); if (s.cur) s.cur.fadeOut(0.3); s.cur = a; };
    s.go = go; go(Math.random() < 0.5 ? 'eat' : 'idle'); mixer.update(Math.random() * 3);
    sheep.push(s);
  }
}).catch(e => console.warn('sheep', e));
function updateSheep(dt) {
  for (const s of sheep) {
    s.mixer.update(dt);
    const p = s.root.position;
    if (s.target) {
      const dx = s.target[0] - p.x, dz = s.target[1] - p.z, d = Math.hypot(dx, dz);
      if (d < 0.05) { s.target = null; s.t = 2 + Math.random() * 4; s.go(Math.random() < 0.65 ? 'eat' : 'idle'); continue; }
      const want = Math.atan2(dx, dz); let df = want - s.root.rotation.y; df = Math.atan2(Math.sin(df), Math.cos(df));
      s.root.rotation.y += df * Math.min(1, dt * 4);
      const v = Math.min(d, 0.42 * dt * (Math.abs(df) < 0.8 ? 1 : 0.3));
      p.x += Math.sin(s.root.rotation.y) * v; p.z += Math.cos(s.root.rotation.y) * v;
      p.y = terrain.heightAt(p.x, p.z);
    } else if ((s.t -= dt) <= 0) {
      for (let k = 0; k < 8; k += 1) {
        const a = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 1.4;
        const x = s.sp.cx + Math.cos(a) * r, z = s.sp.cz + Math.sin(a) * r;
        if (Math.abs(terrain.heightAt(x, z)) < 0.3) { s.target = [x, z]; break; }
      }
      if (s.target) s.go('walk'); else s.t = 1;
    }
  }
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  controls.update(dt);
  terrain.update?.(dt, camera);
  atmo.update(dt);
  updateSheep(dt);
  for (const u of units) {
    if (u.path) stepAlongPath(u, dt);
    u.mixer.update(dt);
  }
  // Тень считается только вокруг того, куда смотрит камера.
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).add(SUN_OFFSET);
  if (fogPass) fogPass(); else renderer.render(scene, camera);
  if (benchFrames) benchFrames.push(dt);

  frames += 1;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsEl.textContent = Math.round(frames / fpsTime);
    callsEl.textContent = renderer.info.render.calls;
    trisEl.textContent = renderer.info.render.triangles.toLocaleString('ru-RU');
    frames = 0;
    fpsTime = 0;
  }
});

ldSet(100, 'Готово');
setTimeout(() => { const el = document.getElementById('loading'); el.classList.add('done'); setTimeout(() => { el.hidden = true; }, 600); }, 150);
const loadSeconds = (performance.now() - t0) / 1000;
document.getElementById('loadtime').textContent = `${loadSeconds.toFixed(1)} с`;

// ─── Отчёты в лог dev-сервера ─────────────────────────────────────────────
// Простой python http.server POST не принимает, но пишет в лог каждую строку
// запроса — поэтому цифры уходят GET-запросом на несуществующий адрес (404).
function report(data) {
  fetch(`./report?${new URLSearchParams(data)}`, { cache: 'no-store' }).catch(() => {});
}
{
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  report({
    type: 'device',
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
    cores: navigator.hardwareConcurrency ?? '',
    mem: navigator.deviceMemory ?? '',
    load: loadSeconds.toFixed(2),
    ua: navigator.userAgent,
  });
}

// ─── Автотест FPS: ?bench=1 ───────────────────────────────────────────────
// Камера медленно вращается, по очереди перебираются настройки; каждая —
// 1 с прогрева и 5 с замера. Средний FPS и «худшие 5%» кадров уходят в лог.
const BENCH = [
  { name: 'всё как есть, чёткость 1.5', q: 1.5 },
  { name: 'чёткость 1', q: 1 },
  { name: 'чёткость 0.75', q: 0.75 },
  { name: 'без деревьев (1)', q: 1, off: ['trees'] },
  { name: 'без скал и обрывов (1)', q: 1, off: ['rocks', 'terraces', 'cliffs'] },
  { name: 'без мелочи: трава, грибы (1)', q: 1, off: ['props'] },
  { name: 'без воды (1)', q: 1, off: ['water'] },
  { name: 'только земля и клетки (1)', q: 1, off: ['trees', 'rocks', 'terraces', 'cliffs', 'props', 'water', 'houses'] },
];
const BENCH_PARTS = ['trees', 'rocks', 'terraces', 'cliffs', 'props', 'water', 'houses'];
function applySettings({ q, off = [], shadows = !IS_TOUCH }) {
  sun.castShadow = shadows;
  for (const k of BENCH_PARTS) if (terrain[k]) terrain[k].visible = !off.includes(k);
  pixelRatioCap = q;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap));
  renderer.setSize(innerWidth, innerHeight);
}
let benchRunning = false;
async function runBench() {
  benchRunning = true;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const panel = document.getElementById('hint');
  panel.style.display = 'block';
  const rows = [];
  controls.autoRotate = true;
  controls.autoRotateSpeed = 3;
  for (const [i, cfg] of BENCH.entries()) {
    panel.textContent = `Тест ${i + 1}/${BENCH.length}: ${cfg.name}… Не трогайте экран.`;
    applySettings(cfg);
    await wait(1500);
    benchFrames = [];
    await wait(5000);
    const dts = benchFrames.filter(d => d > 0).sort((a, b) => b - a);
    benchFrames = null;
    const avg = dts.length / dts.reduce((a, b) => a + b, 0);
    const worst = dts.slice(0, Math.max(1, Math.round(dts.length * 0.05)));
    const low = worst.length / worst.reduce((a, b) => a + b, 0);
    const row = { type: 'bench', cfg: cfg.name, avg: avg.toFixed(1), low5: low.toFixed(1), calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    rows.push(row);
    report(row);
  }
  controls.autoRotate = false;
  applySettings({ q: matchMedia('(pointer: coarse)').matches ? 1 : 1.5 });
  report({ type: 'bench-done' });
  benchRunning = false;
  const gpu = (() => { try { const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; } catch { return ''; } })();
  panel.innerHTML = `<b>Готово — пришлите скриншот.</b><br>${gpu} · экран ${innerWidth}×${innerHeight}×${devicePixelRatio}<br>` +
    rows.map(r => `${r.cfg}: <b>${Math.round(r.avg)}</b> FPS (худш. ${Math.round(r.low5)}) · ${r.calls} выз · ${Math.round(r.tris / 1000)}k тр`).join('<br>');
}
if (new URLSearchParams(location.search).has('bench')) runBench();
// Для проверки из консоли / автотестов.
window.__board3d = { THREE, terrain, scene, camera, controls, units, cells, select, moveSelected, attack, renderer, fog: atmo.fogMesh, render: () => (fogPass ? fogPass() : renderer.render(scene, camera)) };
