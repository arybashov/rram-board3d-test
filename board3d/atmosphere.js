// Этап 0 переноса концепта v6b: туман над водой и у хребта, лучи света сверху-слева, тёплые огни.
// Всё дешёвое: несколько прозрачных плоскостей с шумом в шейдере, без постобработки.
import * as THREE from 'three';

const NOISE = `
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }`;

// Слой тумана: плоскость на высоте y, плотность = шум × маска (где туман уместен)
function mistLayer({ x0, z0, w, d, y, maskFn, res = 128, strength = 0.55, color = 0xc8d2d6, scale = 0.08, speed = 0.015 }) {
  // маска считается один раз на CPU в текстуру (низкое разрешение — мягко)
  const rz = Math.round(res * d / w);
  const data = new Uint8Array(res * rz);
  for (let j = 0; j < rz; j += 1) for (let i = 0; i < res; i += 1)
    data[j * res + i] = Math.round(255 * Math.max(0, Math.min(1, maskFn(x0 + (i + 0.5) / res * w, z0 + (j + 0.5) / rz * d))));
  const mask = new THREE.DataTexture(data, res, rz, THREE.RedFormat);
  mask.magFilter = mask.minFilter = THREE.LinearFilter;
  mask.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, mask: { value: mask }, col: { value: new THREE.Color(color) }, k: { value: strength } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
    fragmentShader: `uniform float time; uniform sampler2D mask; uniform vec3 col; uniform float k; varying vec2 vUv; varying vec3 vW;
      ${NOISE}
      void main(){
        float m = texture2D(mask, vec2(vUv.x, 1.0 - vUv.y)).r;
        if (m < 0.01) discard;
        float n = fbm(vW.xz * ${scale.toFixed(3)} + vec2(time * ${speed.toFixed(3)}, time * ${(speed * 0.6).toFixed(3)}));
        float a = smoothstep(0.2, 0.7, n) * m * k;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x0 + w / 2, y, z0 + d / 2), mat);
  mesh.renderOrder = 20;           // поверх деревьев-картинок
  return mesh;
}

// Лучи: длинные полупрозрачные полосы с градиентом, падают сверху-слева (аддитивно)
function godRays({ origin, targets }) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main(){
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;           // мягкие края полосы
        float along = smoothstep(0.0, 0.45, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        float flick = 0.85 + 0.15 * sin(time * 0.4 + vUv.y * 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.75), pow(across, 1.3) * along * 0.24 * flick);
      }`,
  });
  // веер из ОДНОЙ точки: каждый луч — клин от общей вершины (origin) к своей точке на поле (targets)
  for (const tg of targets) {
    const dir = new THREE.Vector3().subVectors(tg, origin);
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    const w0 = 0.4, w1 = 3 + Math.random() * 3.5;
    const a = origin.clone().addScaledVector(side, -w0), b = origin.clone().addScaledVector(side, w0);
    const c = tg.clone().addScaledVector(side, w1), d = tg.clone().addScaledVector(side, -w1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.toArray(), ...b.toArray(), ...c.toArray(), ...d.toArray()], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const ray = new THREE.Mesh(geo, mat);
    ray.frustumCulled = false;
    ray.renderOrder = 21;
    g.add(ray);
  }
  g.userData.mat = mat;
  return g;
}

// Тёплый огонёк: мягкое светящееся пятно (спрайт), мерцает
function warmGlow() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,220,150,1)'); gr.addColorStop(0.25, 'rgba(255,150,60,0.55)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildAtmosphere({ terrain, cells, groundX0, groundZ0, groundW, groundH }) {
  const group = new THREE.Group();
  const anim = [];
  const hAt = terrain.heightAt;
  // туман убран (20.10: «туман убери»); mistLayer оставлен в файле на будущее
  // 3) лучи сверху-слева над хребтом
  // вершина — над верхним левым углом поля, лучи падают на хребет и верх долины
  const O = new THREE.Vector3(groundX0 + groundW * 0.12, 38, groundZ0 - 10);
  const T = [[0.22, 0.12], [0.33, 0.18], [0.44, 0.24], [0.55, 0.20], [0.66, 0.28], [0.40, 0.38]]
    .map(([u, v]) => new THREE.Vector3(groundX0 + groundW * u, 1.5, groundZ0 + groundH * v));
  const rays = godRays({ origin: O, targets: T });
  group.add(rays);
  anim.push(rays.userData.mat);
  // 4) тёплые огни: по краям мостов (факелы)
  const glowTex = warmGlow();
  const flameTex = (() => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 46, 1, 16, 40, 22);
    gr.addColorStop(0, 'rgba(255,245,200,1)'); gr.addColorStop(0.35, 'rgba(255,170,50,0.95)'); gr.addColorStop(1, 'rgba(255,80,10,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(16, 2); g.quadraticCurveTo(30, 34, 24, 52); g.quadraticCurveTo(16, 64, 8, 52); g.quadraticCurveTo(2, 34, 16, 2); g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const flameMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const flames = [];
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const lights = [];
  for (const g of [terrain.bridges, terrain.houses]) g?.traverse(o => { if ((o.isMesh && o.userData.torch) || o.userData.firePoint) lights.push(o); });
  for (const post of lights) {
    const s = new THREE.Sprite(glowMat);
    post.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(post.matrixWorld);
    // точка огня чаши ворот — прямо на топливе (её начало), столб моста — над чашей на его верху
    const big = !!post.userData.firePoint;
    const sc = big ? new THREE.Vector3().setFromMatrixScale(post.matrixWorld).x : 1;
    const base = big ? p.y : p.y + 0.78;
    s.position.set(p.x, base + (big ? 0.35 * sc : -0.03), p.z);
    s.scale.setScalar(big ? 2.4 * sc : 1.6);
    s.renderOrder = 22;
    // язычок пламени над чашей (реф: факелы на углах мостов), мерцает
    const f = new THREE.Sprite(flameMat);
    f.position.set(p.x, base, p.z);
    f.center.set(0.5, 0.05);
    f.userData.w = big ? 0.55 * sc : 0.32; f.userData.h = big ? 0.75 * sc : 0.5;     // огонь чаши: высота ~0.55–0.65 м (инженерка §6)
    f.scale.set(f.userData.w, f.userData.h, 1);
    f.renderOrder = 23;
    f.userData.phase = Math.random() * 6.28;
    flames.push(f);
    group.add(s, f);
  }
  let tt = 0;
  const update = dt => {
    for (const m of anim) m.uniforms.time.value += dt;
    tt += dt;
    for (const f of flames) { const k = 1 + 0.15 * Math.sin(tt * 9 + f.userData.phase) + 0.08 * Math.sin(tt * 17 + f.userData.phase * 2); f.scale.set(f.userData.w * (2 - k), f.userData.h * k, 1); }
  };
  return { group, update, torches: lights.length };
}
