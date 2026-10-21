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

// Туман частицами — как стандартный дым Unreal (Niagara/Cascade, M_smoke_subUV): спрайты к камере с текстурой
// клуба дыма (атлас 2×2, data/smoke-atlas.webp от Codex); у каждой частицы жизнь: появляется, растёт, дрейфует,
// медленно вращается и гаснет, потом рождается заново (цикл в шейдере — без CPU). «Depth fade» (мягкий стык с
// землёй) упрощён: низ клуба растворяется у высоты земли под точкой рождения. Всё — один InstancedMesh, один вызов.
function smokeField({ spots, tex, color = 0xb6c4ca, opacity = 1.05 }) {
  const n = spots.length;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const spawn = new Float32Array(n * 4), par = new Float32Array(n * 4);
  spots.forEach((sp, i) => {
    spawn.set([sp.x, sp.y, sp.z, sp.ground], i * 4);
    // seed, жизнь (с), размер, кадр атласа
    par.set([Math.random(), 18 + Math.random() * 14, sp.size * (0.8 + Math.random() * 0.5), Math.random() < 0.8 ? (Math.random() < 0.5 ? 1 : 3) : (Math.random() < 0.5 ? 0 : 2)], i * 4);
  });
  geo.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawn, 4));
  geo.setAttribute('aPar', new THREE.InstancedBufferAttribute(par, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, tex: { value: tex }, col: { value: new THREE.Color(color) }, k: { value: opacity }, wind: { value: new THREE.Vector2(0.06, 0.025) } },
    vertexShader: `uniform float time; uniform vec2 wind; attribute vec4 aSpawn; attribute vec4 aPar;
      varying vec2 vUv; varying float vA; varying float vWY; varying float vG; varying float vCell; varying float vCam; varying float vT; varying float vSeed;
      void main(){
        float life = aPar.y, t = fract(time / life + aPar.x);              // возраст 0..1
        float size = aPar.z * mix(0.65, 1.25, t);                          // растёт за жизнь
        vec3 c = aSpawn.xyz + vec3(wind.x, 0.0, wind.y) * life * t + vec3(0.0, 0.35 * t, 0.0);   // дрейф + подъём
        float ang = aPar.x * 6.2831 + time * (0.02 + 0.03 * aPar.x) * (aPar.x > 0.5 ? 1.0 : -1.0); // медленное вращение
        vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * position.xy * size;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = c + right * q.x + up * q.y * 0.38;                        // пелена приплюснута — стелется
        vUv = uv; vA = sin(3.14159 * t); vT = time; vSeed = aPar.x; vWY = w.y; vG = aSpawn.w; vCell = aPar.w;
        vec4 mv = viewMatrix * vec4(w, 1.0); vCam = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D tex; uniform vec3 col; uniform float k;
      varying vec2 vUv; varying float vA; varying float vWY; varying float vG; varying float vCell; varying float vCam; varying float vT; varying float vSeed;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        // рисунок внутри клуба медленно течёт (вместо раскадровки Unreal): UV искривлены бегущим шумом
        vec2 fl = vec2(n2(vUv * 3.0 + vec2(vT * 0.05, vSeed * 9.0)), n2(vUv * 3.0 + vec2(vSeed * 7.0, -vT * 0.04))) - 0.5;
        vec2 uv = clamp(vUv + fl * 0.18, 0.02, 0.98);
        vec2 cell = vec2(mod(vCell, 2.0), floor(vCell / 2.0)) * 0.5;
        float d = texture2D(tex, cell + uv * 0.5).r;
        d = pow(d, 1.15) * (1.0 - smoothstep(0.36, 0.5, length(vUv - 0.5)));   // мягче, края растворяются полностью
        float soft = smoothstep(vG - 0.1, vG + 0.7, vWY);                  // мягкий стык с землёй (упрощённый depth fade)
        float near = smoothstep(4.0, 12.0, vCam);                          // не застилает камеру вблизи
        float a = d * vA * soft * near * k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * (0.9 + 0.2 * d), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 19;
  mesh.userData.mat = mat;
  return mesh;
}

export function buildAtmosphere({ terrain, cells, groundX0, groundZ0, groundW, groundH, fog = false }) {
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
  // 5) эксперимент: туман частицами как дым Unreal (?fog=1) — над водой и у подножия хребта, как на рефе v6b
  if (fog) {
    const tex = new THREE.TextureLoader().load('./data/smoke-atlas.webp?v=1');
    const spots = [];
    for (let z = groundZ0; z < groundZ0 + groundH; z += 1.2) for (let x = groundX0; x < groundX0 + groundW; x += 1.2) {
      const jx = x + (Math.random() - 0.5) * 1.2, jz = z + (Math.random() - 0.5) * 1.2;
      const h = hAt(jx, jz);
      const water = h < -0.2;
      const footOfRidge = h < 1.0 && [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]].some(([dx, dz]) => hAt(jx + dx, jz + dz) > 2.5);
      if (!(water ? Math.random() < 0.6 : footOfRidge && Math.random() < 0.55)) continue;
      const g = Math.max(h, -0.3);
      spots.push({ x: jx, y: g + 0.55, z: jz, ground: g, size: water ? 6.5 : 7.5 });
    }
    const smoke = smokeField({ spots, tex });
    group.add(smoke);
    anim.push(smoke.userData.mat);
  }
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
    s.position.set(p.x, base + (big ? 0.55 * sc : -0.03), p.z);   // свечение над огнём, а не поверх чаши
    s.scale.setScalar(big ? 1.3 * sc : 1.6);
    s.renderOrder = 22;
    // язычок пламени над чашей (реф: факелы на углах мостов), мерцает
    const f = new THREE.Sprite(flameMat);
    f.position.set(p.x, base, p.z);
    f.center.set(0.5, 0.05);
    f.userData.w = big ? 0.36 * sc : 0.32; f.userData.h = big ? 0.7 * sc : 0.5;     // огонь чаши: высота ~0.55–0.65 м (инженерка §6)
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
