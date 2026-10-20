// Управление камерой «как в картах» (Google Maps / Mapbox) вместо OrbitControls.
//
// Телефон:
//   один палец            — карта «прилипает» к пальцу и тянется за ним, с инерцией;
//   два пальца: щипок     — зум к точке между пальцами;
//              вращение   — поворот вокруг точки между пальцами;
//              оба вверх/вниз параллельно — наклон камеры.
// Мышь: левая — тянуть карту, правая — поворот (влево/вправо) и наклон (вверх/вниз),
//       колесо — зум к курсору.
//
// Камера всегда смотрит на точку target на плоскости поля (y = 0);
// положение задаётся расстоянием, наклоном (polar, от вертикали) и азимутом.
import * as THREE from 'three';

const PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const TAP_SLOP = 8;          // пикселей: меньше — это нажатие, а не жест
const TILT_GESTURE_SLOP = 10;

export class MapControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this.distance = 60;
    this.azimuth = 0;
    this.polar = THREE.MathUtils.degToRad(42);
    this.minDistance = 12;
    this.maxDistance = 95;
    this.minPolar = THREE.MathUtils.degToRad(18);
    this.maxPolar = THREE.MathUtils.degToRad(62);
    // Поле смотрим только спереди (решение 20.10: сзади смотреть нечего) — поворот лишь чуть-чуть.
    this.maxAzimuth = THREE.MathUtils.degToRad(15);
    this.bounds = null;               // THREE.Box3 по x/z для target
    this.autoRotate = false;
    this.autoRotateSpeed = 2;         // как в OrbitControls: 2 = оборот за 30 с
    this.hadGesture = false;          // текущее касание было жестом, а не нажатием

    this._pointers = new Map();       // pointerId → {x, y, startX, startY, button}
    this._mode = null;                // 'pan' | 'rotate' | 'pinch' | 'tilt' | 'two'
    this._grab = null;                // точка поля, «прилипшая» к пальцу/курсору
    this._prev = null;                // прошлое состояние двух пальцев
    this._velocity = new THREE.Vector2();
    this._lastMoveTime = 0;
    this._rotateLeft = 0;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._tmp = new THREE.Vector3();

    dom.addEventListener('pointerdown', e => this._onDown(e));
    dom.addEventListener('pointermove', e => this._onMove(e));
    dom.addEventListener('pointerup', e => this._onUp(e));
    dom.addEventListener('pointercancel', e => this._onUp(e));
    dom.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    this.apply();
  }

  setView({ target, azimuth, polar, distance }) {
    this.target.copy(target);
    this.azimuth = azimuth;
    this.polar = polar;
    this.distance = distance;
    this._velocity.set(0, 0);
    this._rotateLeft = 0;
    this.apply();
  }

  // Плавный поворот на угол (кнопки ⟲ ⟳).
  rotateBy(angle) {
    this._rotateLeft += angle;
  }

  update(dt) {
    if (this._rotateLeft) {
      const step = Math.sign(this._rotateLeft) * Math.min(Math.abs(this._rotateLeft), Math.PI * 1.4 * dt);
      this.azimuth += step;
      this._rotateLeft -= step;
      if (Math.abs(this._rotateLeft) < 1e-4) this._rotateLeft = 0;
    }
    if (this.autoRotate) this.azimuth += (this.autoRotateSpeed * Math.PI * 2 / 60) * dt;
    // Инерция после того, как палец отпустил карту.
    if (!this._pointers.size && this._velocity.lengthSq() > 1e-4) {
      this.target.x += this._velocity.x * dt;
      this.target.z += this._velocity.y * dt;
      this._velocity.multiplyScalar(Math.exp(-dt * 4.5));
    }
    this.apply();
  }

  apply() {
    this.azimuth = THREE.MathUtils.clamp(this.azimuth, -this.maxAzimuth, this.maxAzimuth);
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
    this.polar = THREE.MathUtils.clamp(this.polar, this.minPolar, this.maxPolar);
    if (this.bounds) {
      this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.min.x, this.bounds.max.x);
      this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.min.z, this.bounds.max.z);
    }
    this.target.y = 0;
    this.camera.position.setFromSphericalCoords(this.distance, this.polar, this.azimuth).add(this.target);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // Точка поля под экранной точкой (или null, если луч ушёл выше горизонта).
  groundAt(clientX, clientY, out = new THREE.Vector3()) {
    const r = this.dom.getBoundingClientRect();
    this._ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._raycaster.setFromCamera(this._ndc, this.camera);
    return this._raycaster.ray.intersectPlane(PLANE, out);
  }

  // Сдвигаем target так, чтобы точка поля grab снова оказалась под экранной точкой.
  _stickTo(grab, clientX, clientY) {
    const now = this.groundAt(clientX, clientY, this._tmp);
    if (!grab || !now) return;
    this.target.x += grab.x - now.x;
    this.target.z += grab.z - now.z;
    this.apply();
  }

  _twoFingers() {
    // Копии координат: сами объекты указателей меняются при каждом движении.
    const [a, b] = [...this._pointers.values()].map(p => ({ x: p.x, y: p.y }));
    return {
      a, b,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  _startGesture() {
    const n = this._pointers.size;
    this._velocity.set(0, 0);
    if (n === 1) {
      const p = [...this._pointers.values()][0];
      this._mode = p.button === 2 || (p.button === 0 && p.ctrl) ? 'rotate' : 'pan';
      this._grab = this.groundAt(p.x, p.y);
      this._prev = { x: p.x, y: p.y };
    } else if (n === 2) {
      const t = this._twoFingers();
      this._mode = 'two';             // щипок/поворот или наклон — решим по первому движению
      this._grab = this.groundAt(t.midX, t.midY);
      this._prev = t;
      this._twoStart = t;
    } else {
      this._mode = null;
    }
  }

  _onDown(e) {
    if (!this._pointers.size) this.hadGesture = false;
    if (this._pointers.size >= 2) return;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* синтетические события в тестах */ }
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, ctrl: e.ctrlKey || e.metaKey });
    if (this._pointers.size === 2) this.hadGesture = true;
    this._startGesture();
  }

  _onMove(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP) this.hadGesture = true;

    if (this._mode === 'pan') {
      const before = this.target.clone();
      this._stickTo(this._grab, p.x, p.y);
      // Скорость для инерции — сглаженная по последним движениям.
      const now = performance.now();
      const dt = Math.max(1, now - this._lastMoveTime) / 1000;
      this._lastMoveTime = now;
      const vx = (this.target.x - before.x) / dt, vz = (this.target.z - before.z) / dt;
      this._velocity.lerp(new THREE.Vector2(vx, vz), 0.5);
    } else if (this._mode === 'rotate') {
      const h = this.dom.clientHeight || 1;
      this.azimuth -= ((p.x - this._prev.x) / h) * Math.PI;
      this.polar -= ((p.y - this._prev.y) / h) * Math.PI * 0.6;
      this._prev = { x: p.x, y: p.y };
      this.apply();
    } else if (this._mode === 'two' || this._mode === 'pinch' || this._mode === 'tilt') {
      if (this._pointers.size !== 2) return;
      const t = this._twoFingers();
      if (this._mode === 'two') this._mode = this._classifyTwo(t) ?? 'two';
      if (this._mode === 'tilt') {
        const h = this.dom.clientHeight || 1;
        this.polar -= ((t.midY - this._prev.midY) / h) * Math.PI * 0.8;
        this.apply();
      } else if (this._mode === 'pinch') {
        if (t.dist > 0 && this._prev.dist > 0) this.distance *= this._prev.dist / t.dist;
        let dAngle = t.angle - this._prev.angle;
        dAngle = Math.atan2(Math.sin(dAngle), Math.cos(dAngle));
        this.azimuth += dAngle;
        this.apply();
        this._stickTo(this._grab, t.midX, t.midY);
      }
      this._prev = t;
    }
  }

  // Два пальца сдвинулись вместе по вертикали, держась примерно на одной высоте —
  // это наклон. Любое другое заметное движение — щипок/поворот/сдвиг.
  _classifyTwo(t) {
    const s = this._twoStart;
    const dy1 = t.a.y - s.a.y, dy2 = t.b.y - s.b.y;
    const dx1 = t.a.x - s.a.x, dx2 = t.b.x - s.b.x;
    const moved = Math.max(Math.hypot(dx1, dy1), Math.hypot(dx2, dy2));
    if (moved < TILT_GESTURE_SLOP) return null;
    const sameVertical = Math.sign(dy1) === Math.sign(dy2)
      && Math.abs(dy1) > Math.abs(dx1) * 1.5 && Math.abs(dy2) > Math.abs(dx2) * 1.5;
    const sideBySide = Math.abs(Math.sin(s.angle)) < 0.6;
    const pinchChange = Math.abs(t.dist - s.dist);
    if (sameVertical && sideBySide && pinchChange < moved * 0.5) return 'tilt';
    return 'pinch';
  }

  _onUp(e) {
    if (!this._pointers.delete(e.pointerId)) return;
    // Если между последним движением и отпусканием прошла пауза — инерции нет.
    if (performance.now() - this._lastMoveTime > 80) this._velocity.set(0, 0);
    if (this._pointers.size) {
      // Остался один палец: «перехватываем» карту под ним, без скачка.
      const rest = [...this._pointers.values()][0];
      rest.startX = rest.x;
      rest.startY = rest.y;
      this._startGesture();
      this._velocity.set(0, 0);
    } else {
      this._mode = null;
      this._grab = null;
      if (this._velocity.length() > 60) this._velocity.setLength(60);
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const grab = this.groundAt(e.clientX, e.clientY);
    this.distance *= Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));   // ctrlKey — щипок на тачпаде
    this.apply();
    this._stickTo(grab, e.clientX, e.clientY);
  }
}
