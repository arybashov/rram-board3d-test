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
function godRays({ origin, count = 6, length = 70, spread = 0.5 }) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main(){
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;           // мягкие края полосы
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float flick = 0.85 + 0.15 * sin(time * 0.4 + vUv.y * 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.92, 0.75), pow(across, 1.3) * along * 0.24 * flick);
      }`,
  });
  // веер из ОДНОЙ точки (солнце за краем): у всех полос общая вершина, расходятся вниз-вправо
  for (let i = 0; i < count; i += 1) {
    const w = 4 + Math.random() * 5;
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(w, length).translate(0, -length / 2, 0), mat);
    ray.position.copy(origin);
    const t = count > 1 ? i / (count - 1) : 0.5;
    ray.rotation.set(-0.5, 0, 0.35 + t * spread);
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
  const rays = godRays({ origin: new THREE.Vector3(groundX0 + 6, 34, groundZ0 - 2), count: 6, length: 75, spread: 0.6 });
  group.add(rays);
  anim.push(rays.userData.mat);
  // 4) тёплые огни: по краям мостов (факелы)
  const glowTex = warmGlow();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const lights = [];
  terrain.bridges?.traverse(o => { if (o.isMesh && o.geometry?.type === 'BoxGeometry' && o.geometry.parameters?.height > 0.6) lights.push(o); });
  for (const post of lights) {
    const s = new THREE.Sprite(glowMat);
    post.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(post.matrixWorld);
    s.position.set(p.x, p.y + 0.55, p.z);
    s.scale.setScalar(1.1);
    s.renderOrder = 22;
    group.add(s);
  }
  const update = dt => { for (const m of anim) m.uniforms.time.value += dt; };
  return { group, update, torches: lights.length };
}
