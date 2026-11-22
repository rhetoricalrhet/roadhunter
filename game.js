// RoadHunter prototype v0.1 — browser, Three.js, single player.
import * as THREE from 'three';
import { CREW } from './crew.js';
import { loadKit, buildCharacter, LOOKS } from './chars.js';
import { buildPickup, buildXterra } from './vehicles.js';
import { buildAnimal, animateAnimal } from './animals.js';
import { audio } from './audio.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const store = { get(k, d) { try { const v = localStorage.getItem('rh_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('rh_' + k, JSON.stringify(v)); } catch {} } };

// ---------------------------------------------------------------- data
// heightmaps ship as lossless PNGs: 16-bit value = R*256 + G
async function loadU16(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data, out = new Uint16Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1];
  return out;
}
let loadedN = 0; const LOAD_N = 7;
const track = (p) => p.then((v) => { loadedN++; const el = document.getElementById('loadbar'); if (el) el.style.width = Math.round(loadedN / LOAD_N * 100) + '%'; return v; });
const [meta, rawH, bmeta, rawB, aerialImg, kit, vec] = await Promise.all([
  track(fetch('assets/terrain.json').then((r) => r.json())),
  track(loadU16('assets/height.png')),
  track(fetch('assets/backdrop.json').then((r) => r.json())),
  track(loadU16('assets/backdrop.png')),
  track(new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'assets/aerial.jpg'; })),
  track(loadKit()),
  track(fetch('assets/vectors.json').then((r) => r.json())),
]).catch((err) => { document.getElementById('loading').textContent = "Couldn't load: " + (err && err.message || err); throw err; });
const G = meta.grid, S = meta.size_m, HALF = S / 2, BASE = meta.min_elev;
const H = new Float32Array(G * G);
{ const q = rawH; const r = meta.max_elev - meta.min_elev; for (let i = 0; i < q.length; i++) H[i] = (q[i] / 65535) * r; }

function heightAt(x, z) {
  const fx = clamp((x / S + 0.5) * (G - 1), 0, G - 1.001), fz = clamp((z / S + 0.5) * (G - 1), 0, G - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = H[j * G + i], b = H[j * G + i + 1], c = H[(j + 1) * G + i], d = H[(j + 1) * G + i + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
function slopeAt(x, z) { const e = 3; const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e), dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e); return Math.hypot(dx, dz); }

// aerial colour lookup for placing vegetation & wildlife
const CW = 1024; let colorData;
{ const c = document.createElement('canvas'); c.width = c.height = CW; const g = c.getContext('2d'); g.drawImage(aerialImg, 0, 0, CW, CW); colorData = g.getImageData(0, 0, CW, CW).data; }
function classify(x, z) {
  const px = clamp(Math.floor((x / S + 0.5) * CW), 0, CW - 1), pz = clamp(Math.floor((z / S + 0.5) * CW), 0, CW - 1);
  const k = (pz * CW + px) * 4, r = colorData[k], g = colorData[k + 1], b = colorData[k + 2], sum = r + g + b;
  if (sum < 230 && g >= r - 4 && g > b + 4) return 'tree';
  if (g > r + 6) return 'field';
  if (Math.abs(r - b) < 16 && Math.abs(r - g) < 10) return 'urban';
  return 'sage';
}

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xcfdbe6);
scene.fog = new THREE.Fog(HORIZON, 2500, 42000);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.2, 80000);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

{ // sky dome
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f86c6) }, hor: { value: HORIZON } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 p; void main(){ float t = clamp(p.y*2.2,0.,1.); gl_FragColor = vec4(mix(hor, top, pow(t,.7)),1.); }' });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70000, 32, 16), m); sky.renderOrder = -1; scene.add(sky);
  scene.userData.sky = sky;
}
const hemi = new THREE.HemisphereLight(0xe3ecf7, 0x8c7a5a, 0.95); scene.add(hemi);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35; // paint/glass reflections
const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xfff6ec, 0.8); scene.add(fill, fill.target); // camera-side fill so faces read
const SUN_DIR = new THREE.Vector3(-0.45, 0.75, 0.35).normalize();
// ---- time of day: hunting starts at sunrise; 1 game hour = 4 real minutes
let gameHour = 6.4;
const C = (h) => new THREE.Color(h);
const TOD = { sunDay: C(0xfff0d8), sunLow: C(0xffa860), topDay: C(0x4f86c6), topLow: C(0x5b78b0), horDay: C(0xcfdbe6), horLow: C(0xf3c69c) };
function applyTimeOfDay() {
  const t = clamp((gameHour - 5.8) / 13, 0, 1), el = Math.sin(t * Math.PI) * 1.05 + 0.04, az = Math.PI / 2 + t * Math.PI; // east -> south -> west
  SUN_DIR.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const w = 1 - clamp(el / 0.45, 0, 1); // 1 = golden hour
  sun.color.copy(TOD.sunDay).lerp(TOD.sunLow, w); sun.intensity = lerp(1.75, 1.25, w); hemi.intensity = lerp(0.95, 0.82, w);
  const sky = scene.userData.sky.material.uniforms; sky.top.value.copy(TOD.topDay).lerp(TOD.topLow, w); HORIZON.copy(TOD.horDay).lerp(TOD.horLow, w);
  scene.fog.color.copy(HORIZON); scene.fog.near = lerp(2500, 500, w); scene.fog.far = lerp(42000, 26000, w);
}

// ---------------------------------------------------------------- terrain
function gridGeometry(n, size, heights, x0, z0) {
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    pos[k * 3] = x0 + (i / (n - 1)) * size; pos[k * 3 + 1] = heights[k]; pos[k * 3 + 2] = z0 + (j / (n - 1)) * size;
    uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = 1 - j / (n - 1);
  }
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
const texLoader = new THREE.TextureLoader();
function loadTex(url) { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
const terrain = new THREE.Mesh(gridGeometry(G, S, H, -HALF, -HALF), new THREE.MeshLambertMaterial({ map: loadTex('assets/aerial.jpg') }));
terrain.receiveShadow = true; scene.add(terrain);
{ // far mountains backdrop, slightly lower so the detailed tile wins where they overlap
  const q = rawB, n = bmeta.grid, r = bmeta.max_elev - bmeta.min_elev, off = bmeta.min_elev - BASE;
  const bh = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = bmeta.x_min + (i / (n - 1)) * bmeta.size_m, z = bmeta.z_min + (j / (n - 1)) * bmeta.size_m;
    const inside = Math.abs(x) < HALF - 40 && Math.abs(z) < HALF - 40;
    bh[j * n + i] = (q[j * n + i] / 65535) * r + off - (inside ? 25 : 6);
  }
  const back = new THREE.Mesh(gridGeometry(n, bmeta.size_m, bh, bmeta.x_min, bmeta.z_min), new THREE.MeshLambertMaterial({ map: loadTex('assets/backdrop.jpg') }));
  scene.add(back);
}

// ---------------------------------------------------------------- vegetation
const sageGeo = new THREE.IcosahedronGeometry(0.55, 0); sageGeo.scale(1, 0.62, 1); sageGeo.translate(0, 0.25, 0);
const rockGeo = new THREE.DodecahedronGeometry(0.6, 0); rockGeo.scale(1, 0.6, 0.8);
const LOWSPEC = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const SAGE_PER = LOWSPEC ? 200 : 300, ROCK_PER = 10, GRASS_PER = LOWSPEC ? 60 : 140, CH = 90, CR = 4, NCH = (2 * CR + 1) ** 2;
function mergeGeos(list) { // tiny merge (position/normal only) for instanced props
  const pos = [], nor = [], idx = []; let off = 0;
  for (const g0 of list) { const g = g0.index ? g0.toNonIndexed() : g0; g.computeVertexNormals(); const p = g.attributes.position.array, n = g.attributes.normal.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } for (let i = 0; i < p.length / 3; i++) idx.push(off + i); off += p.length / 3; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx); return out;
}
const tuftGeo = (() => { const pos = []; for (let b = 0; b < 6; b++) { const a = (b / 6) * Math.PI * 2 + b, lean = 0.1 + (b % 3) * 0.05, h = 0.25 + (b % 2) * 0.12, w = 0.014, dx = Math.cos(a), dz = Math.sin(a), ox = dx * 0.035, oz = dz * 0.035; pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * lean, h, oz + dz * lean); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; })();
const grass = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), GRASS_PER * 25);
grass.frustumCulled = false;
const sage = new THREE.InstancedMesh(sageGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), SAGE_PER * NCH);
const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: 0x9a9184 }), ROCK_PER * NCH);
sage.frustumCulled = rocks.frustumCulled = false; rocks.castShadow = true; scene.add(sage, rocks, grass);
const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
let lastChunk = '';
function refillNear(px, pz) {
  const ci = Math.floor(px / CH), cj = Math.floor(pz / CH), key = ci + ',' + cj;
  if (key === lastChunk) return; lastChunk = key;
  let ns = 0, nr = 0;
  for (let j = cj - CR; j <= cj + CR; j++) for (let i = ci - CR; i <= ci + CR; i++) {
    const rng = mulberry32((i * 73856093) ^ (j * 19349663));
    for (let k = 0; k < SAGE_PER; k++) {
      const x = (i + rng()) * CH, z = (j + rng()) * CH, s = 0.5 + rng() * 0.8, hue = rng();
      if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5) continue;
      const cls = classify(x, z);
      if (cls !== 'sage' && !(cls === 'field' && rng() < 0.05)) continue;
      if (onRoad(x, z)) continue;
      dummy.position.set(x, heightAt(x, z) - 0.05, z); dummy.rotation.set(0, hue * 6.28, 0); dummy.scale.set(s, s * (0.8 + hue * 0.5), s); dummy.updateMatrix();
      sage.setMatrixAt(ns, dummy.matrix); sage.setColorAt(ns, tmpC.setHSL(0.16 + hue * 0.08, 0.2 + hue * 0.1, 0.27 + hue * 0.09)); ns++;
    }
    for (let k = 0; k < ROCK_PER; k++) {
      const x = (i + rng()) * CH, z = (j + rng()) * CH, s = 0.4 + rng() * rng() * 2.4;
      if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5 || slopeAt(x, z) < 0.25 || classify(x, z) === 'urban') continue;
      dummy.position.set(x, heightAt(x, z) - 0.15 * s, z); dummy.rotation.set(rng(), rng() * 6, rng()); dummy.scale.setScalar(s); dummy.updateMatrix();
      rocks.setMatrixAt(nr++, dummy.matrix);
    }
  }
  // grass tufts only in the 5x5 chunks around the player
  let ng = 0;
  for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
    const rng = mulberry32((i * 92821) ^ (j * 68917) ^ 7);
    for (let k = 0; k < GRASS_PER; k++) {
      const x = (i + rng()) * CH, z = (j + rng()) * CH, sc = 0.7 + rng() * 0.9, hue = rng();
      if (Math.abs(x) > HALF - 5 || Math.abs(z) > HALF - 5 || onRoad(x, z) || classify(x, z) === 'urban') continue;
      dummy.position.set(x, heightAt(x, z) - 0.02, z); dummy.rotation.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4); dummy.scale.setScalar(sc); dummy.updateMatrix();
      grass.setMatrixAt(ng, dummy.matrix); grass.setColorAt(ng++, tmpC.setHSL(0.13 + hue * 0.07, 0.35, 0.38 + hue * 0.14));
    }
  }
  grass.count = ng; grass.instanceMatrix.needsUpdate = true; if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  sage.count = ns; rocks.count = nr;
  sage.instanceMatrix.needsUpdate = rocks.instanceMatrix.needsUpdate = true; if (sage.instanceColor) sage.instanceColor.needsUpdate = true;
}
{ // cottonwoods & conifers wherever the aerial photo shows dark green (river corridor, draws)
  const MAX = 22000, trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 3, 5); trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 1); crownGeo.scale(1, 1.25, 1); crownGeo.translate(0, 5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), MAX);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), MAX);
  // conifers (Douglas fir / lodgepole) on the high slopes: stacked cones
  const firGeo = (() => { const parts = []; for (let k = 0; k < 4; k++) { const c = new THREE.ConeGeometry(2.4 - k * 0.5, 3.2, 7); c.translate(0, 2.4 + k * 1.9, 0); parts.push(c); } const tr = new THREE.CylinderGeometry(0.15, 0.25, 2.5, 5); tr.translate(0, 1.2, 0); parts.push(tr); return mergeGeos(parts); })();
  const firs = new THREE.InstancedMesh(firGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), MAX);
  let nf = 0;
  const rng = mulberry32(42); let n = 0;
  for (let t = 0; t < 900000 && n < MAX; t++) {
    const x = (rng() - 0.5) * (S - 20), z = (rng() - 0.5) * (S - 20);
    if (classify(x, z) !== 'tree') continue;
    const s = 0.7 + rng() * 0.9, h = heightAt(x, z);
    dummy.position.set(x, h - 0.2, z); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(s, s * (0.8 + rng() * 0.5), s); dummy.updateMatrix();
    if (h > 420 && nf < MAX) { firs.setMatrixAt(nf, dummy.matrix); firs.setColorAt(nf++, tmpC.setHSL(0.3 + rng() * 0.06, 0.32, 0.17 + rng() * 0.08)); continue; }
    trunks.setMatrixAt(n, dummy.matrix); crowns.setMatrixAt(n, dummy.matrix);
    crowns.setColorAt(n, tmpC.setHSL(0.2 + rng() * 0.08, 0.35, 0.22 + rng() * 0.1)); n++;
  }
  trunks.count = crowns.count = n; firs.count = nf; crowns.castShadow = firs.castShadow = true; scene.add(trunks, crowns, firs);
}

// ---------------------------------------------------------------- real roads, water, buildings (OpenStreetMap)
const ROADGRID = 10, RN = Math.ceil(S / ROADGRID), roadCells = new Uint8Array(RN * RN);
function roadAt(x, z) { const i = Math.floor((x + HALF) / ROADGRID), j = Math.floor((z + HALF) / ROADGRID); return i >= 0 && j >= 0 && i < RN && j < RN ? roadCells[j * RN + i] : 0; }
const onRoad = (x, z) => roadAt(x, z) >= 1, onPaved = (x, z) => roadAt(x, z) === 2;
const waterCells = new Uint8Array(RN * RN).fill(255); // distance to water in 2 m units (255 = far)
function waterDistAt(x, z) { const i = Math.floor((x + HALF) / ROADGRID), j = Math.floor((z + HALF) / ROADGRID); return i >= 0 && j >= 0 && i < RN && j < RN ? waterCells[j * RN + i] * 2 : 999; }
function ribbon(lines, lift, mat, renderOrder = 0) {
  const pos = [], idx = [];
  for (const L of lines) {
    const P = L.pts; if (P.length < 2) continue;
    const base = pos.length / 3;
    for (let k = 0; k < P.length; k++) {
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * L.w / 2, nz = dx * L.w / 2, [x, z] = P[k];
      pos.push(x + nx, heightAt(x + nx, z + nz) + lift, z + nz, x - nx, heightAt(x - nx, z - nz) + lift, z - nz);
      if (k) { const v = base + k * 2; idx.push(v - 2, v - 1, v, v - 1, v + 1, v); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.renderOrder = renderOrder; scene.add(m); return m;
}
{
  for (const w of vec.water) if (w.kind === 'river') w.w = 14; // Lemhi is ~12-16 m wide here
  const paved = vec.roads.filter((r) => ['motorway', 'trunk', 'primary', 'secondary'].includes(r.kind) || r.surface === 'asphalt' || r.surface === 'paved');
  const gravel = vec.roads.filter((r) => !paved.includes(r) && !['path', 'footway'].includes(r.kind));
  const po = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide };
  ribbon(paved, 0.25, new THREE.MeshLambertMaterial({ color: 0x4a4a4c, ...po }));
  { // dashed yellow centerline on the highway
    const dashes = [];
    for (const r of paved) for (let k = 0; k + 1 < r.pts.length; k += 3) dashes.push({ w: 0.22, pts: [r.pts[k], r.pts[k + 1]] });
    ribbon(dashes, 0.29, new THREE.MeshBasicMaterial({ color: 0xd9b43a, ...po }), 2);
  }
  ribbon(gravel, 0.22, new THREE.MeshLambertMaterial({ color: 0xa8977a, ...po }));
  ribbon(vec.water, 0.35, new THREE.MeshPhongMaterial({ color: 0x3f6f86, specular: 0x9fc7dd, shininess: 60, transparent: true, opacity: 0.85, ...po }), 1);
  for (const r of [...paved, ...gravel]) { // road lookup grid: trucks are faster on real roads
    const P = r.pts, rad = r.w / 2 + 2, isPaved = paved.includes(r);
    for (let k = 1; k < P.length; k++) {
      const [ax, az] = P[k - 1], [bx, bz] = P[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let t = 0; t <= n; t++) {
        const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n;
        for (let dz = -rad; dz <= rad; dz += ROADGRID / 2) for (let dx = -rad; dx <= rad; dx += ROADGRID / 2) {
          const i = Math.floor((x + dx + HALF) / ROADGRID), j = Math.floor((z + dz + HALF) / ROADGRID);
          if (i >= 0 && j >= 0 && i < RN && j < RN) roadCells[j * RN + i] = Math.max(roadCells[j * RN + i], isPaved ? 2 : 1);
        }
      }
    }
  }
  for (const w of vec.water) for (let k = 0; k < w.pts.length; k += 2) { // water distance grid (for river sound)
    const [x, z] = w.pts[k], ci = Math.floor((x + HALF) / ROADGRID), cj = Math.floor((z + HALF) / ROADGRID);
    for (let dj = -12; dj <= 12; dj++) for (let di = -12; di <= 12; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= RN || j >= RN) continue;
      const d = Math.min(254, Math.round(Math.hypot(di, dj) * ROADGRID / 2)); if (d < waterCells[j * RN + i]) waterCells[j * RN + i] = d;
    }
  }
  const wallM = new THREE.MeshLambertMaterial({ color: 0x9a8a74 }), roofM = new THREE.MeshLambertMaterial({ color: 0x4a4e55 });
  for (const b of vec.buildings) { // extrude real footprints
    const shape = new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const h = (parseInt(b.levels) || 1) * 3.4, geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
    const cx = b.pts.reduce((a, p) => a + p[0], 0) / b.pts.length, cz = b.pts.reduce((a, p) => a + p[1], 0) / b.pts.length;
    const m = new THREE.Mesh(geo, [roofM, wallM]); m.position.y = Math.min(...b.pts.map(([x, z]) => heightAt(x, z))) - 0.3; m.castShadow = m.receiveShadow = true; scene.add(m);
  }
}

// ---------------------------------------------------------------- crew HQ
const HQ = new THREE.Vector3(-3223, 0, 3564); HQ.y = heightAt(HQ.x, HQ.z);
function std(c, o = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o }); }
function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; return m; }
function textSprite(text, w = 512, h = 128, bg = '#2a1d12', fg = '#f4ecdc') {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = '#f08a24'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  g.fillStyle = fg; g.font = `700 ${h * 0.5}px Oswald, Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
{
  const hq = new THREE.Group(); hq.position.copy(HQ); hq.rotation.y = 1.2; scene.add(hq);
  let top = -Infinity; for (const [dx, dz] of [[-9, -6], [9, -6], [-9, 6], [9, 6]]) top = Math.max(top, heightAt(HQ.x + dx, HQ.z + dz));
  const lift = top - HQ.y;
  hq.add(box(14, 4 + lift, 10, std(0x7b5b3e), 0, (4 + lift) / 2 - 0.5, 0));
  hq.add(box(16, 1.2, 12, std(0x7a7a7a), 0, lift - 0.2, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 9.5, 3.2, 4, 1), std(0x3b3f45)); roof.rotation.y = Math.PI / 4; roof.scale.set(1.05, 1, 0.75); roof.position.y = 5.1 + lift; roof.castShadow = true; hq.add(roof);
  hq.add(box(1.6, 2.4, 0.2, std(0x3a2a1c), 0, lift + 1.2, 5.05));
  for (const x of [-4.5, 4.5]) hq.add(box(1.8, 1.3, 0.2, std(0x9ec3dd, { roughness: 0.2 }), x, lift + 2, 5.05));
  hq.add(box(14, 0.3, 3, std(0x8a6a48), 0, lift + 0.15, 6.5));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: textSprite('CREW HQ'), side: THREE.DoubleSide }));
  sign.position.set(-9, lift + 2.6, 10); hq.add(sign, box(0.15, 2.6, 0.15, std(0x5a4632), -10.7, lift + 1.1, 10), box(0.15, 2.6, 0.15, std(0x5a4632), -7.3, lift + 1.1, 10));
}

// ---------------------------------------------------------------- people
// Animated crew (Quaternius CC0 base + generated clothes, see chars.js)
const rifleMats = { wood: std(0x6b4527, { roughness: 0.6 }), metal: std(0x222326, { metalness: 0.8, roughness: 0.35 }) };
function buildRifle() { // built along +y, about 1.1 m long
  const g = new THREE.Group(), M2 = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  M2(new THREE.BoxGeometry(0.045, 0.34, 0.09), rifleMats.wood, 0, 0.17, -0.01);           // stock
  M2(new THREE.BoxGeometry(0.04, 0.28, 0.06), rifleMats.wood, 0, 0.48, 0);                  // forend
  M2(new THREE.BoxGeometry(0.045, 0.2, 0.05), rifleMats.metal, 0, 0.42, 0.01);             // receiver
  M2(new THREE.CylinderGeometry(0.011, 0.013, 0.55, 8), rifleMats.metal, 0, 0.82, 0.015);   // barrel
  M2(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 10), rifleMats.metal, 0, 0.45, 0.06);   // scope
  M2(new THREE.CylinderGeometry(0.025, 0.018, 0.05, 10), rifleMats.metal, 0, 0.6, 0.06);
  M2(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 10), rifleMats.metal, 0, 0.3, 0.06);
  return g;
}
function buildPerson(c) {
  const ch = buildCharacter(kit, LOOKS[c.id]);
  ch.root.userData = { ch, talkT: 0 };
  // rifle slung diagonally across the back, rigged to the upper spine
  const si = ch.skeleton.bones.findIndex((b) => b.name === 'spine_03');
  if (si >= 0) {
    const r = buildRifle(); r.rotation.z = 0.85; r.position.set(0.28, 0.95, -0.16); r.updateMatrix();
    const holder = new THREE.Group(); holder.add(r); holder.applyMatrix4(ch.skeleton.boneInverses[si]); ch.skeleton.bones[si].add(holder);
  }
  return ch.root;
}
function animatePerson(p, speed, dt, crouch = false, talking = false) {
  const ch = p.userData.ch;
  let clip = 'Idle_Loop', rate = 1;
  if (talking) clip = 'Idle_Talking_Loop';
  else if (crouch) { clip = speed > 0.1 ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'; rate = speed > 0.1 ? clamp(speed / 1.3, 0.6, 1.5) : 1; }
  else if (speed > 4.6) clip = 'Sprint_Loop';
  else if (speed > 2.2) { clip = 'Jog_Fwd_Loop'; rate = clamp(speed / 3.4, 0.75, 1.3); }
  else if (speed > 0.1) { clip = 'Walk_Loop'; rate = clamp(speed / 1.35, 0.7, 1.6); }
  ch.play(clip, 0.22, { speed: rate });
  ch.mixer.update(dt);
}

// ---------------------------------------------------------------- vehicles
const vehicles = [];
function addVehicle(name, built, x, z, heading, opts = {}) {
  const mesh = built.group;
  const v = { name, mesh, pos: new THREE.Vector3(x, heightAt(x, z), z), heading, speed: 0, steer: 0, wb: built.wb, half: built.half, top: opts.top || 33, owner: opts.owner, wheels: built.wheels, seats: built.seats, wheelR: built.wheelR, riders: [] };
  scene.add(mesh); vehicles.push(v); placeVehicle(v, 1); return v;
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
function placeVehicle(v, t) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading), lx = Math.cos(v.heading), lz = -Math.sin(v.heading), hl = v.wb / 2;
  const hf = heightAt(v.pos.x + fx * hl, v.pos.z + fz * hl), hb = heightAt(v.pos.x - fx * hl, v.pos.z - fz * hl);
  const hL = heightAt(v.pos.x + lx * v.half, v.pos.z + lz * v.half), hR = heightAt(v.pos.x - lx * v.half, v.pos.z - lz * v.half);
  v.pos.y = (hf + hb + hL + hR) / 4;
  v.pitch = Math.atan2(hf - hb, v.wb);
  _e.set(-v.pitch, v.heading, Math.atan2(hL - hR, v.half * 2));
  _q.setFromEuler(_e); v.mesh.quaternion.slerp(_q, t);
  v.mesh.position.copy(v.pos);
}
const truck = addVehicle('the crew truck', buildPickup(), HQ.x - 12, HQ.z + 14, 1.2 + Math.PI);
const xterra = addVehicle("Slime's Xterra", buildXterra(), HQ.x - 7, HQ.z + 17, 1.2 + Math.PI, { top: 30, owner: 'slime' });

// ---------------------------------------------------------------- wildlife
const animals = [];
const ELK_ZONE = { x0: 2000, x1: 5200, z0: -4600, z1: -1400 }; // upper Bohannon Creek drainage (Eagle Valley area, best guess from public maps)
function spawnPoint(kind, far) {
  for (let t = 0; t < 400; t++) {
    let x, z;
    if (kind === 'elk' && Math.random() < 0.85) { x = rand(ELK_ZONE.x0, ELK_ZONE.x1); z = rand(ELK_ZONE.z0, ELK_ZONE.z1); }
    else { x = rand(-HALF + 150, HALF - 150); z = rand(-HALF + 150, HALF - 150); }
    const h = heightAt(x, z), cls = classify(x, z);
    if (cls === 'urban' || h < 25 || slopeAt(x, z) > 0.75) continue;
    if (far && Math.hypot(x - player.pos.x, z - player.pos.z) < far) continue;
    if (Math.hypot(x - HQ.x, z - HQ.z) < 400) continue;
    return [x, z];
  }
  return [rand(-2000, 2000), rand(-2000, 2000)];
}
function spawnHerd(kind, far = 0) {
  const [cx, cz] = spawnPoint(kind, far), n = kind === 'elk' ? 4 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const male = i === 0 || Math.random() < 0.25, { mesh, points } = buildAnimal(kind, male);
    const a = { kind, male, points, mesh, pos: new THREE.Vector3(cx + rand(-25, 25), 0, cz + rand(-25, 25)), heading: rand(0, 6.28),
      state: 'graze', t: rand(1, 6), speed: 0, target: null, fleeFrom: null, gone: 0 };
    a.pos.y = heightAt(a.pos.x, a.pos.z); mesh.position.copy(a.pos); scene.add(mesh); animals.push(a);
  }
}
const label = (a) => `${a.kind === 'elk' ? (a.male ? 'Bull elk' : 'Cow elk') : (a.male ? 'Mule deer buck' : 'Mule deer doe')}${a.male ? ` (${a.points}x${a.points})` : ''}`;

// ---------------------------------------------------------------- player
const keys = {};
const player = { pos: HQ.clone().add(new THREE.Vector3(-17, 0, 9)), vy: 0, yaw: 1.2 + Math.PI, onGround: true, stamina: 100, exhausted: false, crouch: false, inVehicle: null, crew: null, model: null, speed: 0, uphillT: 0 };
let camYaw = player.yaw + Math.PI, camPitch = 0.25, camIdle = 0, scoping = false;
let tags = store.get('tags', []);
const npcs = [];
const followers = new Set(store.get('followers', ['skin', 'hewitt']));
function homeSpot(i) { const ang = 0.3 + (i - 2) * 0.5, p = HQ.clone().add(new THREE.Vector3(Math.sin(ang) * 9 - 6, 0, Math.cos(ang) * 9 + 8)); p.y = heightAt(p.x, p.z); return p; }
function newNpc(k, model, i) { return { crew: k, model, mode: followers.has(k.id) ? 'follow' : 'idle', home: homeSpot(i), yaw: rand(-1, 1), talkT: 0, vehicle: null, seat: null }; }
function seatModel(m, v, seat) { m.removeFromParent(); v.mesh.add(m); m.position.set(seat.x, seat.y, seat.z); m.rotation.set(0, seat.face || 0, 0); m.visible = true; m.userData.ch.play(seat.pose, 0.15); }
function leaveSeat(n, side = 0) {
  if (n.mode !== 'ride' || !n.vehicle) return;
  const v = n.vehicle, m = n.model, lx = Math.cos(v.heading), lz = -Math.sin(v.heading), fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  m.removeFromParent(); scene.add(m);
  const sx = n.seat.x > 0 ? 1 : -1; m.position.set(v.pos.x + lx * sx * 2.2 - fx * (1 + side * 1.2), 0, v.pos.z + lz * sx * 2.2 - fz * (1 + side * 1.2));
  m.position.y = heightAt(m.position.x, m.position.z); m.rotation.set(0, v.heading, 0);
  n.mode = 'follow'; n.vehicle = null; n.seat = null; v.riders = v.riders.filter((r) => r !== n);
}
function setCrew(id) {
  const c = CREW.find((k) => k.id === id), prev = started && player.crew ? player.crew : null, prevModel = player.model;
  let model; const idx = npcs.findIndex((n) => n.crew.id === id);
  if (idx >= 0) { const n = npcs[idx]; leaveSeat(n); model = n.model; model.removeFromParent(); scene.add(model); npcs.splice(idx, 1); }
  else { model = buildPerson(c); scene.add(model); }
  player.crew = c; player.model = model; model.visible = !player.inVehicle;
  if (prevModel && prevModel !== model) {
    if (prev) { followers.add(prev.id); const n = newNpc(prev, prevModel, npcs.length); n.mode = 'follow'; prevModel.position.copy(player.pos); npcs.push(n); }
    else scene.remove(prevModel);
  }
  followers.delete(id); store.set('followers', [...followers]);
  if (!prev && !npcs.length) CREW.filter((k) => k.id !== id).forEach((k, i) => {
    const m = buildPerson(k), n = newNpc(k, m, i); scene.add(m);
    m.position.copy(n.mode === 'follow' ? player.pos.clone().add(new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4))) : n.home); m.position.y = heightAt(m.position.x, m.position.z);
    npcs.push(n);
  });
  player.stamina = 100; player.exhausted = false;
  $('whoImg').src = `assets/portraits/${c.id}.jpg`; $('whoName').textContent = c.name; $('whoRole').textContent = c.role + ' · ' + c.ability;
  store.set('crew', id); renderCrewBar(); if (prev) ab.cdBy[prev.id] = ab.cd; ab.cd = ab.cdBy[id] || 0; ab.max = AB_CD[id]; $('gadgets').classList.add('hidden');
}
// switch hunters any time, even mid-mission in the truck: the new hunter takes the wheel, the old one takes their seat
function switchTo(id) {
  if (!started || id === player.crew.id) return;
  const v = player.inVehicle, prevId = player.crew.id;
  if (!v) { setCrew(id); bark('select'); return; }
  const n = npcs.find((q) => q.crew.id === id); let seat = null;
  if (n && n.mode === 'ride' && n.vehicle === v) { seat = n.seat; v.riders = v.riders.filter((r) => r !== n); n.mode = 'follow'; n.vehicle = null; n.seat = null; }
  setCrew(id);
  seatModel(player.model, v, v.seats.find((q) => q.driver)); player.model.visible = true;
  const pn = npcs.find((q) => q.crew.id === prevId), free = seat || v.seats.find((q) => !q.driver && !v.riders.some((r) => r.seat === q));
  if (pn && free) { pn.mode = 'ride'; pn.vehicle = v; pn.seat = free; seatModel(pn.model, v, free); v.riders.push(pn); }
  renderCrewBar(); bark('select');
}
function renderCrewBar() {
  const el = $('crewbar'); if (!el) return;
  el.innerHTML = npcs.filter((n) => n.mode !== 'idle').map((n) => `<img src="assets/portraits/${n.crew.id}.jpg" alt="${n.crew.name}" title="Switch to ${n.crew.name}" data-id="${n.crew.id}">`).join('');
  for (const im of el.children) im.onclick = (e) => { e.stopPropagation(); switchTo(im.dataset.id); };
}
const SLOTS = [[-2.4, -0.6], [2.4, -0.6], [-3.6, -2.6], [3.6, -2.6], [-4.8, -0.2]]; // beside the hunter, out of the camera line
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * Math.min(1, t);
function updateNpcs(dt) {
  let si = 0;
  for (const n of npcs) {
    const m = n.model; n.talkT -= dt;
    if (n.mode === 'ride') { m.userData.ch.play(n.seat.pose, 0.3); m.userData.ch.mixer.update(dt); continue; }
    if (n.mode === 'idle') { animatePerson(m, 0, dt, false, n.talkT > 0); continue; }
    if (n.cheerT > 0) { n.cheerT -= dt; m.userData.ch.mixer.update(dt); continue; }
    const [ox, oz] = SLOTS[si++ % SLOTS.length], cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const tx = player.pos.x + ox * cy + oz * sy, tz = player.pos.z - ox * sy + oz * cy;
    const dx = tx - m.position.x, dz = tz - m.position.z, d = Math.hypot(dx, dz);
    if (d > 70) { m.position.set(player.pos.x - sy * 14 + rand(-3, 3), 0, player.pos.z - cy * 14 + rand(-3, 3)); m.position.y = heightAt(m.position.x, m.position.z); continue; }
    let spd = 0;
    if (!scoping && d > 0.8) spd = player.crouch ? 1.25 : d > 10 ? 5.4 : d > 3 ? 3.3 : 1.4;
    if (spd) { const step = Math.min(d, spd * dt); m.position.x += dx / d * step; m.position.z += dz / d * step; n.yaw = angLerp(n.yaw, Math.atan2(dx, dz), dt * 8); }
    else n.yaw = angLerp(n.yaw, player.yaw, dt * 2);
    m.rotation.y = n.yaw; m.position.y = heightAt(m.position.x, m.position.z);
    animatePerson(m, spd, dt, player.crouch || scoping, n.talkT > 0);
  }
}
function crewLine(kind, pred) {
  const pool = npcs.filter((n) => n.mode !== 'idle' && n.crew.lines[kind] && (!pred || pred(n))); if (!pool.length) return null;
  const n = pick(pool); say(n.crew.name, pick(n.crew.lines[kind])); n.talkT = 2.6; return n;
}

// ---------------------------------------------------------------- dialogue & toasts
let subT = 0, toastT = 0, idleBarkT = 40;
const cds = {};
function say(who, text, dur = 3.4) { $('sub').innerHTML = `<b>${who}</b>${text}`; $('sub').style.opacity = 1; subT = dur; }
function bark(kind, cd = 0) {
  const c = player.crew, lines = c.lines[kind]; if (!lines) return false;
  const k = c.id + kind; if (cds[k] > 0) return false; cds[k] = cd; say(c.name, pick(lines)); return true;
}
function toast(big, small, dur = 3.2) { $('toastBig').textContent = big; $('toastSmall').textContent = small; $('toast').style.opacity = 1; toastT = dur; }
function updateTags() { const d = tags.filter((t) => t.kind === 'deer').length, e = tags.length - d; $('trophies').textContent = `Tags: ${d} deer · ${e} elk`; }

// ---------------------------------------------------------------- input
const canvas = renderer.domElement;
let dragging = false, downX = 0, downY = 0, moved = 0;
const locked = () => document.pointerLockElement === canvas;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (e.button === 2) { setScope(true); return; }
  if (e.button === 0) {
    if (locked()) { if (scoping) shoot(); return; }
    dragging = true; downX = e.clientX; downY = e.clientY; moved = 0;
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch {}
  }
});
addEventListener('mouseup', (e) => {
  if (e.button === 2) setScope(false);
  if (e.button === 0 && dragging) { dragging = false; if (scoping && moved < 5) shoot(); }
});
addEventListener('mousemove', (e) => {
  if (!started || !(locked() || dragging)) return;
  moved += Math.abs(e.movementX) + Math.abs(e.movementY);
  const sens = scoping ? 0.0024 * camera.fov / 65 : 0.0024;
  camYaw -= e.movementX * sens; camPitch = clamp(camPitch + e.movementY * sens, -1.2, 1.3); camIdle = 0;
});
addEventListener('keydown', (e) => {
  if (!started) return;
  keys[e.code] = true;
  if (e.code === 'KeyF') toggleVehicle();
  if (e.code === 'KeyR' && player.inVehicle) { const v = player.inVehicle; v.speed = 0; v.pos.y += 2; if (has('hewitt')) { toast('Recovered', 'Hewitt fixed it. Of course he did.', 1.8); say('Hewitt', pick(['I could fix that. …Fixed.', 'Bent tie rod. Got it.'])); } else toast('Recovered', 'Back on four wheels.', 1.5); }
  if (e.code === 'KeyM') $('map').classList.toggle('hidden');
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'KeyQ') setScope(!scoping);
  if (e.code === 'KeyC') player.crouch = !player.crouch;
  if (e.code === 'KeyE') talk();
  if (e.code === 'KeyG') useAbility();
  if (!$('gadgets').classList.contains('hidden') && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) { pickGadget(['range', 'thermal', 'drone'][+e.code.slice(5) - 1]); return; }
  if (e.code === 'KeyP') takePhoto();
  if (e.code === 'KeyN') $('sndBtn').textContent = audio.toggle() ? 'Sound on' : 'Sound off';
  if (e.code === 'KeyZ' && scoping) cycleZoom();
  const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5 }[e.code];
  if (n != null) switchTo(CREW[n].id);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
// ---- phone controls: joystick, swipe to look, buttons
const touchMode = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const stick = { x: 0, y: 0, id: null };
let touchSprint = false;
if (touchMode) {
  document.body.classList.add('touch');
  const el = $('stick'), knob = $('knob');
  const move = (e) => { const r = el.getBoundingClientRect(); let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } stick.x = dx; stick.y = dy; knob.style.transform = `translate(${dx * 38}px,${dy * 38}px)`; };
  el.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; el.setPointerCapture(e.pointerId); move(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) move(e); });
  const up = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  const looks = new Map();
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  canvas.addEventListener('pointermove', (e) => {
    const p = looks.get(e.pointerId); if (!p) return;
    const sens = scoping ? 0.0012 : 0.006;
    camYaw -= (e.clientX - p.x) * sens; camPitch = clamp(camPitch + (e.clientY - p.y) * sens * 0.7, -1.2, 1.3); camIdle = 0; p.x = e.clientX; p.y = e.clientY;
  });
  const lookUp = (e) => looks.delete(e.pointerId);
  canvas.addEventListener('pointerup', lookUp); canvas.addEventListener('pointercancel', lookUp);
  const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); if (started) fn(); });
  tap('tTruck', toggleVehicle); tap('tScope', () => setScope(!scoping)); tap('tShoot', () => (scoping ? shoot() : setScope(true)));
  tap('tCrouch', () => { player.crouch = !player.crouch; $('tCrouch').classList.toggle('on', player.crouch); });
  tap('tTalk', talk); tap('tMap', () => $('map').classList.toggle('hidden'));
  tap('tZoom', () => (scoping ? cycleZoom() : setScope(true))); tap('tPhoto', takePhoto);
  const run = $('tRun');
  run.addEventListener('pointerdown', () => { touchSprint = true; run.classList.add('on'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) run.addEventListener(ev, () => { touchSprint = false; run.classList.remove('on'); });
  $('who').addEventListener('click', () => { if (!started) return; const i = CREW.findIndex((c) => c.id === player.crew.id); switchTo(CREW[(i + 1) % CREW.length].id); });
}
$('map').addEventListener('click', () => $('map').classList.add('hidden'));
$('photoClose').onclick = () => $('photo').classList.add('hidden');
$('sndBtn').onclick = () => { audio.start(); $('sndBtn').textContent = audio.toggle() ? 'Sound on' : 'Sound off'; };
addEventListener('pointerdown', () => audio.start());

function setScope(on) {
  if (on && player.inVehicle) return;
  scoping = on; $('scope').classList.toggle('hidden', !on); $('scopeinfo').classList.toggle('hidden', !on); $('cross').classList.toggle('hidden', on);
  if (on) { camYaw = player.yaw + Math.PI; camPitch = clamp(camPitch, -0.4, 0.4); }
}
function nearestVehicle() { let best = null, bd = 5.5; for (const v of vehicles) { const d = v.pos.distanceTo(player.pos); if (d < bd) { bd = d; best = v; } } return best; }
function boardVehicle(v) {
  player.inVehicle = v; setScope(false); $('speed').classList.remove('hidden');
  seatModel(player.model, v, v.seats.find((x) => x.driver));
  const free = v.seats.filter((x) => !x.driver);
  for (const n of npcs) if (n.mode === 'follow' && n.model.position.distanceTo(v.pos) < 70 && free.length) { const seat = free.shift(); n.mode = 'ride'; n.vehicle = v; n.seat = seat; seatModel(n.model, v, seat); v.riders.push(n); }
  audio.door();
  const ts = tinSpots.find((q) => q.vehicle === v && !taken.has(q.id)); if (ts) { taken.add(ts.id); setTimeout(() => takeTin(ts), 1400); }
}
function unboardVehicle() {
  const v = player.inVehicle; if (!v) return;
  const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
  player.model.removeFromParent(); scene.add(player.model); player.model.rotation.set(0, v.heading, 0);
  player.pos.set(v.pos.x + lx * 2.2, 0, v.pos.z + lz * 2.2); player.pos.y = heightAt(player.pos.x, player.pos.z); player.yaw = v.heading;
  [...v.riders].forEach((n, i) => leaveSeat(n, i));
  player.inVehicle = null; $('speed').classList.add('hidden'); audio.door();
}
function toggleVehicle() {
  if (player.inVehicle) {
    if (Math.abs(player.inVehicle.speed) > 4) { toast('Slow down', 'Stop the truck before jumping out.', 1.5); return; }
    unboardVehicle();
  } else {
    const v = nearestVehicle(); if (!v) return;
    boardVehicle(v);
    if (v.owner === 'slime' && player.crew.id === 'slime') say('Slime', 'Ah. Home.');
    else if (v.owner === 'slime') say(player.crew.name, 'Slime is going to notice the seat moved.');
    else setTimeout(() => crewLine('ride'), 1800);
  }
}
function nearestNpc(r = 4) { let best = null, bd = r; for (const n of npcs) { if (n.mode === 'ride') continue; const d = n.model.position.distanceTo(player.pos); if (d < bd) { bd = d; best = n; } } return best; }
function talk() {
  if (answerKids()) return;
  const best = nearestNpc();
  if (!best) { if (!player.inVehicle && has('slime') && xterra.pos.distanceTo(player.pos) < 6) openLocker(); return; }
  if (best.mode !== 'idle' && !mission && MISSIONS_FOR[best.crew.id] && !offered.has(best.crew.id)) { offered.add(best.crew.id); startMission(MISSIONS_FOR[best.crew.id]); return; }
  const c = best.crew;
  if (best.mode === 'idle') { best.mode = 'follow'; followers.add(c.id); store.set('followers', [...followers]); say(c.name, pick(c.lines.join)); best.talkT = 2.6; renderCrewBar(); return; }
  if (player.pos.distanceTo(HQ) < 45 && best.mode === 'follow' && keys.ShiftLeft) { best.mode = 'idle'; followers.delete(c.id); best.model.position.copy(best.home); say(c.name, 'I\'ll hold down the fort.'); renderCrewBar(); return; }
  let line = pick(c.lines.idle);
  if ((c.id === 'skin' && player.crew.id === 'dawg') || (c.id === 'dawg' && player.crew.id === 'skin')) line = pick(["Here we go again.", "No, you're wrong. Let me tell you why.", "We are NOT stopping at the Amish store."]);
  say(c.name, line); best.model.userData.talkT = 3.2;
  best.model.rotation.y = Math.atan2(player.pos.x - best.model.position.x, player.pos.z - best.model.position.z);
}

const MISSIONS_FOR = { dawg: 'amish', skin: 'shortcut' }, offered = new Set();
// ---------------------------------------------------------------- shooting
const ray = new THREE.Ray(), _v = new THREE.Vector3(), _c = new THREE.Vector3();
function animalUnderCrosshair(maxD = 900) {
  camera.getWorldDirection(_v); ray.set(camera.position, _v);
  let best = null, bd = Infinity;
  for (const a of animals) {
    if (a.state === 'down') continue;
    const s = a.kind === 'elk' ? 1.45 : 1;
    _c.copy(a.pos); _c.y += 1.05 * s;
    const d = _c.distanceTo(camera.position); if (d > maxD) continue;
    const miss = ray.distanceSqToPoint(_c);
    const vital = (0.32 * s) ** 2, body = (0.75 * s) ** 2;
    if (miss < body && d < bd) { bd = d; best = { a, d, vital: miss < vital }; }
  }
  return best;
}
function shoot() {
  if (!scoping || player.inVehicle) return;
  const hit = animalUnderCrosshair(), aim = player.crew.stats.aim, maxRange = 150 + aim * 30 + rangeBonus();
  if (hit && !hit.a.male) {
    if (player.crew.id === 'kyle' && hit.a.kind === 'elk') return kyleWrongElk(hit);
    say(player.crew.name, "That's a " + (hit.a.kind === 'elk' ? 'cow' : 'doe') + '. Hold off, no tag for that.'); return;
  }
  flashShot(); audio.shot();
  for (const a of animals) if (a.state !== 'down' && a.pos.distanceTo(player.pos) < 700) { a.state = 'flee'; a.t = rand(6, 10); a.fleeFrom = player.pos.clone(); }
  if (hit && hit.vital && hit.d <= maxRange) {
    const a = hit.a; a.state = 'down'; a.gone = 90;
    const t = { kind: a.kind, points: a.points, dist: Math.round(hit.d), who: player.crew.name, when: Date.now() }; tags.push(t); store.set('tags', tags); updateTags();
    toast('Tagged!', `${label(a)} · ${t.dist} m · ${player.crew.name}`, 4);
    slowT = 1.6; drawTrophyBoard();
    setTimeout(() => bark('harvest'), 900);
    if (withYou('kyle')) setTimeout(() => { player.stamina = 100; player.exhausted = false; say('Kyle', pick(['I\'ll pack it out. You keep hunting.', 'Got it. I could carry two.'])); }, 7600);
    setTimeout(() => { const n = crewLine('harvest'); for (const f of npcs) if (f.mode === 'follow') { f.talkT = 0; f.model.userData.ch.play('Dance_Loop', 0.2); f.cheerT = 2.5; } }, 2600);
    setTimeout(() => toast('Trophy photo?', touchMode ? 'Tap Photo to snap one for the group text.' : 'Press P to snap one for the group text.', 3), 5200);
  } else {
    if (hit && hit.d > maxRange) toast('Missed', `Too far for ${player.crew.name} (${Math.round(hit.d)} m). Get closer.`, 2.5);
    else if (hit) toast('Missed', 'Just behind the shoulder. It took off.', 2.2);
    setTimeout(() => bark('miss'), 600);
    setTimeout(() => crewLine('roast'), 2300);
  }
}
function kyleWrongElk(hit) { // the legend
  const a = hit.a; flashShot(); audio.shot(); slowT = 1.6;
  for (const b of animals) if (b !== a && b.state !== 'down' && b.pos.distanceTo(player.pos) < 700) { b.state = 'flee'; b.t = rand(6, 10); b.fleeFrom = player.pos.clone(); }
  a.state = 'down'; a.gone = 120;
  tags.push({ kind: 'elk', points: 0, dist: Math.round(hit.d), who: 'Kyle', when: Date.now(), note: 'wrong elk' }); store.set('tags', tags); updateTags(); drawTrophyBoard();
  toast('WRONG ELK', 'Kyle shot a cow. The crew will never let this go.', 5);
  const crewNow = npcs.filter((n) => n.mode !== 'idle' && n.crew.lines.wrongElk);
  let tt = 2200; for (const n of crewNow.slice(0, 3)) { setTimeout(() => { say(n.crew.name, pick(n.crew.lines.wrongElk)); n.talkT = 2.5; }, tt); tt += 2600; }
  setTimeout(() => say('Kyle', pick(CREW.find((c) => c.id === 'kyle').lines.wrongElk)), tt);
}
let slowT = 0;
let flashT = 0; function flashShot() { flashT = 0.12; }
const ZOOMS = [22, 11, 5.5]; let zoomIdx = 1;
function cycleZoom() { zoomIdx = (zoomIdx + 1) % ZOOMS.length; toastOnce('Scope', `${[3, 6, 12][zoomIdx]}x`); }
addEventListener('wheel', (e) => { if (scoping) { zoomIdx = clamp(zoomIdx + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1); } }, { passive: true });

// ---------------------------------------------------------------- map
const mapbox = $('mapbox'), mapDots = {};
function mapDot(id, color, text) { const d = document.createElement('div'); d.className = 'dot'; d.style.background = color; mapbox.appendChild(d); let l = null; if (text) { l = document.createElement('div'); l.className = 'lbl'; l.textContent = text; mapbox.appendChild(l); } mapDots[id] = { d, l }; }
function setDot(id, x, z) { const m = mapDots[id], px = ((x / S) + 0.5) * 100 + '%', pz = ((z / S) + 0.5) * 100 + '%'; m.d.style.left = px; m.d.style.top = pz; if (m.l) { m.l.style.left = px; m.l.style.top = pz; } }
mapDot('hq', '#f08a24', 'Crew HQ'); mapDot('elk', 'transparent', 'Eagle Valley · elk country'); mapDots.elk.d.style.border = 'none';
mapDot('truck', '#8c2a22', 'Truck'); mapDot('xterra', '#f2f2ee', 'Xterra'); mapDot('me', '#3fa9f5', 'You');
setDot('hq', HQ.x, HQ.z); setDot('elk', (ELK_ZONE.x0 + ELK_ZONE.x1) / 2, (ELK_ZONE.z0 + ELK_ZONE.z1) / 2);

// ---------------------------------------------------------------- dust, banter, gate, quick start, fast travel, trophies, photos
const dustTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(200,180,150,0.55)'); gr.addColorStop(1, 'rgba(200,180,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const dust = []; let dustAcc = 0;
for (let i = 0; i < 40; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); dust.push({ sp, life: 0 }); }
function emitDust(v, dt) {
  const sp = Math.abs(v.speed); if (sp < 4 || onPaved(v.pos.x, v.pos.z)) return;
  dustAcc += dt * sp * 0.6; while (dustAcc > 1) { dustAcc -= 1;
    const d = dust.find((q) => q.life <= 0); if (!d) return;
    const back = -Math.sign(v.speed) * 2.8; d.sp.position.set(v.pos.x + Math.sin(v.heading) * back + rand(-0.8, 0.8), v.pos.y + 0.5, v.pos.z + Math.cos(v.heading) * back + rand(-0.8, 0.8));
    d.life = 2.2; d.sp.visible = true; d.sp.scale.setScalar(1.5); }
}
function updateDust(dt) { for (const d of dust) if (d.life > 0) { d.life -= dt; d.sp.material.opacity = Math.max(0, d.life / 2.2) * 0.7; d.sp.scale.multiplyScalar(1 + dt * 0.9); d.sp.position.y += dt * 0.5; if (d.life <= 0) d.sp.visible = false; } }
function updateBanter(dt) {
  banterT -= dt; if (banterT < 0) { banterT = rand(45, 85) * (has('l') ? 0.5 : 1); crewLine(player.inVehicle ? 'ride' : 'idle'); }
  if (player.uphillT > 3 && !(cds.crewUp > 0)) { if (crewLine('uphill', (n) => n.crew.id === 'dawg') || crewLine('tired', (n) => n.crew.id === 'skin')) cds.crewUp = 35; }
  spotT -= dt; if (spotT < 0 && !player.inVehicle) { spotT = 1;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    for (const a of animals) {
      if (a.spotted || !a.male || (a.state !== 'graze' && a.state !== 'walk')) continue;
      const dx = a.pos.x - player.pos.x, dz = a.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d > 110 && d < (withYou('dawg') ? 520 : 330) && (dx * fx + dz * fz) / d > 0.55) { a.spotted = true; if (!(cds.spot > 0)) { (crewLine('spot', (n) => n.crew.id === 'hewitt') || crewLine('spot')); cds.spot = 25; } break; }
    }
  }
  bugleT -= dt; if (bugleT < 0) { bugleT = rand(40, 90);
    let best = 1e9; for (const a of animals) if (a.kind === 'elk' && a.male && a.state !== 'down') best = Math.min(best, a.pos.distanceTo(player.pos));
    if (best < 2600) { audio.bugle(best); if (best < 1600) setTimeout(() => say('', '<i>An elk bugles somewhere up the drainage.</i>', 3), 600); }
  }
}
// Eagle Valley gate on Bohannon Creek Road (fictional game gate at the ranch fields)
const GATE = new THREE.Vector3(1492.7, 0, -1300.4), GATE_HEADING = Math.atan2(1490.8 - 1492.7, -1361.7 - -1300.4); GATE.y = heightAt(GATE.x, GATE.z);
{
  const g = new THREE.Group(); g.position.copy(GATE); g.rotation.y = GATE_HEADING; scene.add(g);
  const pipe = std(0x6f6a62, { metalness: 0.6, roughness: 0.5 }), wood = std(0x5a4632);
  for (const x of [-4.2, 4.2]) g.add(box(0.3, 2.2, 0.3, wood, x, 1.0, 0));
  const leaf = new THREE.Group(); leaf.position.set(4.2, 0, 0); leaf.rotation.y = 1.9; g.add(leaf); // swung open
  for (const y of [0.5, 0.9, 1.3]) leaf.add(box(4.1, 0.07, 0.07, pipe, -2.05, y, 0));
  for (const x of [-0.1, -2.05, -4.0]) leaf.add(box(0.07, 0.95, 0.07, pipe, x, 0.9, 0));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: textSprite('EAGLE VALLEY'), side: THREE.DoubleSide }));
  sign.position.set(0, 2.6, 0); g.add(sign, box(8.7, 0.18, 0.18, wood, 0, 2.2, 0));
}
function spawnHerdAt(kind, cx, cz, n) {
  n = n || (kind === 'elk' ? 5 + Math.floor(Math.random() * 4) : 3);
  for (let i = 0; i < n; i++) {
    const male = i === 0 || Math.random() < 0.25, { mesh, points } = buildAnimal(kind, male);
    const a = { kind, male, points, mesh, pos: new THREE.Vector3(cx + rand(-20, 20), 0, cz + rand(-20, 20)), heading: rand(0, 6.28), state: 'graze', t: rand(2, 8), speed: 0, gone: 0 };
    a.pos.y = heightAt(a.pos.x, a.pos.z); mesh.position.copy(a.pos); scene.add(mesh); animals.push(a);
  }
}
function placeCrewAround(x, z) { for (const n of npcs) if (n.mode === 'follow') { n.model.position.set(x + rand(-4, 4), 0, z + rand(-4, 4)); n.model.position.y = heightAt(n.model.position.x, n.model.position.z); } }
function teleport(x, z, heading, { inTruck = false, speed = 0 } = {}) {
  if (player.inVehicle) unboardVehicle();
  truck.pos.set(x, heightAt(x, z), z); truck.heading = heading; truck.speed = 0; placeVehicle(truck, 1);
  const lx = Math.cos(heading), lz = -Math.sin(heading);
  player.pos.set(x + lx * 2.4, 0, z + lz * 2.4); player.pos.y = heightAt(player.pos.x, player.pos.z); player.yaw = heading;
  placeCrewAround(player.pos.x, player.pos.z);
  if (inTruck) { boardVehicle(truck); truck.speed = speed; }
  camYaw = heading + Math.PI; lastChunk = '';
}
function nearestRoadPoint(x, z, maxR = 600) {
  let best = null, bd = maxR;
  for (const r of vec.roads) for (const p of r.pts) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = { p, r }; } }
  return best;
}
const DESTS = {
  hq: () => {},
  gate: () => { teleport(GATE.x - Math.sin(GATE_HEADING) * 25, GATE.z - Math.cos(GATE_HEADING) * 25, GATE_HEADING, { inTruck: true });
    const skin = player.crew.id === 'skin' ? player.crew : npcs.find((n) => n.crew.id === 'skin' && n.mode !== 'idle');
    setTimeout(() => { if (skin) { say('Skin', 'I know a guy. We\'re good.'); toast('Gate\'s open', 'Skin talked to the owners. Elk country is up the road.', 4); } else toast('Eagle Valley', 'The gate\'s open. Elk country is up the road.', 4); }, 1200); },
  hunt: () => { // drop in on a ridge with a herd below
    const cx = rand(ELK_ZONE.x0 + 400, ELK_ZONE.x1 - 400), cz = rand(ELK_ZONE.z0 + 400, ELK_ZONE.z1 - 400); spawnHerdAt('elk', cx, cz);
    let px = cx + 220, pz = cz, best = -1e9;
    const ty = heightAt(cx, cz) + 1.2;
    for (let k = 0; k < 24; k++) for (const r of [200, 240, 280]) { // a spot that can actually see the herd, a bit above it
      const a = (k / 24) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, ey = heightAt(x, z) + 1.4;
      let clear = true; for (let t = 0.04; t < 0.97; t += 0.03) { if (heightAt(lerp(x, cx, t), lerp(z, cz, t)) > lerp(ey, ty, t) - 0.6) { clear = false; break; } }
      const rise = ey - ty, score = (clear ? 1000 : 0) - Math.abs(rise - 30) - slopeAt(x, z) * 40;
      if (score > best) { best = score; px = x; pz = z; }
    }
    const face = Math.atan2(cx - px, cz - pz);
    teleport(px - Math.sin(face) * 45, pz - Math.cos(face) * 45, face);
    player.pos.set(px, heightAt(px, pz), pz); player.yaw = face; camYaw = face + Math.PI; camPitch = 0.12; player.crouch = true; placeCrewAround(px - Math.sin(face) * 3, pz - Math.cos(face) * 3);
    setTimeout(() => { crewLine('spot', (n) => n.crew.id === 'hewitt') || toast('Elk below', 'Herd about 240 m out. Stay low, scope in.', 4); }, 1500); },
  amish: () => { teleport(HQ.x - 12, HQ.z + 14, 1.2 + Math.PI, { inTruck: true }); setTimeout(() => { offered.add('dawg'); startMission('amish'); }, 900); },
  shortcut: () => { teleport(HQ.x - 12, HQ.z + 14, 1.2 + Math.PI, { inTruck: true }); setTimeout(() => { offered.add('skin'); startMission('shortcut'); }, 900); },
  cruise: () => { teleport(-3353.5, 3743.3, Math.atan2(-3408.3 - -3353.5, 3703.6 - 3743.3), { inTruck: true, speed: 18 }); setTimeout(() => crewLine('ride'), 1500); },
};
mapbox.addEventListener('click', (e) => { // fast travel: tap a spot on the map
  e.stopPropagation(); if (!started) return;
  const r = mapbox.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width - 0.5) * S, z = ((e.clientY - r.top) / r.height - 0.5) * S;
  let hit = nearestRoadPoint(x, z, 800); if (!hit) { toast('No road there', 'Tap closer to a road.', 2); return; }
  let skinDetour = false; if (has('skin') && Math.random() < 0.2) { const alt = nearestRoadPoint(x + rand(-1, 1) * 1800, z + rand(-1, 1) * 1800, 1500); if (alt) { hit = alt; skinDetour = true; } }
  const P = hit.r.pts, k = P.indexOf(hit.p), q = P[Math.min(P.length - 1, k + 3)], p0 = P[Math.max(0, k - 3)];
  teleport(hit.p[0], hit.p[1], Math.atan2(q[0] - p0[0], q[1] - p0[1]), { inTruck: true });
  $('map').classList.add('hidden'); toast('Fast travel', hit.r.name || 'Back road', 2);
  if (skinDetour) { setTimeout(() => say('Skin', 'I know a shortcut.'), 900); setTimeout(() => say(player.crew.id === 'skin' ? 'Dawg' : player.crew.name, 'This is the wrong road, Skin.'), 3800); }
});
// trophy wall at HQ
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 512; boardCanvas.height = 384;
const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace;
function drawTrophyBoard() {
  const g = boardCanvas.getContext('2d'); g.fillStyle = '#2a1d12'; g.fillRect(0, 0, 512, 384); g.strokeStyle = '#f08a24'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 376);
  g.fillStyle = '#f08a24'; g.font = '700 40px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.fillText('TROPHY WALL', 256, 56);
  g.textAlign = 'left'; g.font = '600 24px Inter, sans-serif';
  const top = [...tags].filter((t) => t.kind !== 'bonus').sort((a, b) => (b.points || 0) - (a.points || 0) || b.when - a.when).slice(0, 7);
  if (!top.length) { g.fillStyle = '#c3b69f'; g.fillText('No tags yet. Go get one.', 40, 120); }
  top.forEach((t, i) => { g.fillStyle = t.note ? '#e0573b' : '#f6eedf'; g.fillText(`${t.who}: ${t.note ? 'cow elk (wrong elk!)' : `${t.points}x${t.points} ${t.kind === 'elk' ? 'bull elk' : 'mule deer'}`} · ${t.dist} m`, 34, 106 + i * 39); });
  g.fillStyle = '#c3b69f'; g.font = '600 18px Inter, sans-serif'; g.fillText(`Zyn tins found: ${tinsFound.size}/${TIN_N}  ·  Missions: ${done.size}/2`, 34, 366);
  boardTex.needsUpdate = true; renderTrophyList();
}
{ const b = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide })); const p = HQ.clone().add(new THREE.Vector3(-14, 0, 2)); b.position.set(p.x, heightAt(p.x, p.z) + 1.9, p.z); b.rotation.y = 1.2 + Math.PI / 2; scene.add(b, (() => { const s2 = box(0.15, 1.4, 0.15, std(0x5a4632)); s2.position.set(p.x, heightAt(p.x, p.z) + 0.6, p.z); return s2; })()); }
function renderTrophyList() {
  const el = $('trophyList'); if (!el) return;
  const extra = `<li><b>Zyn tins found</b> ${tinsFound.size}/${TIN_N}</li><li><b>Missions</b> ${done.size ? [...done].map((m) => MISSIONS[m].title).join(', ') : 'none yet'}</li>`;
  el.innerHTML = extra + (tags.length ? [...tags].reverse().map((t) => `<li><b>${t.who}</b> ${t.note ? 'shot the <em>wrong elk</em>' : `${t.points}x${t.points} ${t.kind === 'elk' ? 'bull elk' : 'mule deer buck'}`} · ${t.dist} m</li>`).join('') : '<li>No tags yet.</li>');
}
// photo mode: grab the frame without the HUD, then share or save
function takePhoto() {
  const hud = $('hud'); hud.style.visibility = 'hidden'; renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    hud.style.visibility = ''; if (!blob) return;
    const url = URL.createObjectURL(blob); $('photoImg').src = url; $('photo').classList.remove('hidden');
    const file = new File([blob], 'roadhunter.jpg', { type: blob.type });
    $('photoShare').onclick = async () => { try { if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'RoadHunter' }); else { const a = document.createElement('a'); a.href = url; a.download = 'roadhunter.jpg'; a.click(); } } catch {} };
  }, 'image/jpeg', 0.9);
}

// ---------------------------------------------------------------- special abilities, crew passives, Zyn tins, missions
const fx = { calm: 0, wind: 0, snack: 0, range: 0, thermal: 0, drone: 0, permit: 0, burn: 0 }; // seconds left on each effect
const ab = { cd: 0, max: 1, cdBy: {} }; // cooldown per hunter, so switching can't reset it
const AB_CD = { hewitt: 45, kyle: 60, l: 50, dawg: 60, slime: 40, skin: 60 };
const has = (id) => player.crew.id === id || npcs.some((n) => n.crew.id === id && n.mode !== 'idle'); // in your party
const withYou = (id) => npcs.some((n) => n.crew.id === id && n.mode !== 'idle');
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const dirWord = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
const distWord = (d) => d > 950 ? `${(d / 1609).toFixed(1)} miles` : `${Math.round(d * 1.094)} yards`;

// marker sprites (thermal glow, waypoints)
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 1, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,200,80,.9)'); gr.addColorStop(1, 'rgba(255,80,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const thermalSprites = [];
for (let i = 0; i < 40; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff7a2a, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending })); sp.visible = false; sp.renderOrder = 10; scene.add(sp); thermalSprites.push(sp); }
function updateThermal() {
  const on = fx.thermal > 0 || fx.drone > 0; let k = 0;
  if (on) for (const a of animals) { if (k >= thermalSprites.length) break; if (a.state === 'down') continue; const d = a.pos.distanceTo(player.pos); if (d > 1100) continue;
    const sp = thermalSprites[k++], s = a.kind === 'elk' ? 1.45 : 1; sp.visible = true; sp.position.set(a.pos.x, a.pos.y + 1.1 * s, a.pos.z); sp.scale.setScalar(Math.max(2.2, d * 0.022) * s);
    sp.material.color.setHex(a.male ? 0xffb02a : 0xff5a2a); }
  for (; k < thermalSprites.length; k++) thermalSprites[k].visible = false;
}
// waypoint beam for missions and tips
const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 260, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xf08a24, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
beam.visible = false; scene.add(beam);
let waypoint = null; // {x,z,label}
function setWaypoint(x, z, labelText) {
  waypoint = x == null ? null : { x, z, label: labelText };
  beam.visible = !!waypoint; mapDots.wp.d.style.display = mapDots.wp.l.style.display = waypoint ? '' : 'none';
  if (waypoint) { beam.position.set(x, heightAt(x, z) + 130, z); setDot('wp', x, z); mapDots.wp.l.textContent = labelText; }
}
mapDot('wp', '#ffd34d', 'Target'); mapDot('store', '#5aa0e0', 'Amish store (Baker)');
mapDots.wp.d.style.display = mapDots.wp.l.style.display = 'none';

// ---- the Amish store at Baker (real store location, building is a game stand-in)
const STORE = (() => {
  const hit = nearestRoadPoint(-312, 6285, 300); let x = -312, z = 6285, h = 0;
  if (hit) { const P = hit.r.pts, k = P.indexOf(hit.p), a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)]; h = Math.atan2(b[0] - a[0], b[1] - a[1]); x = hit.p[0] + Math.cos(h) * 20; z = hit.p[1] - Math.sin(h) * 20; }
  const g = new THREE.Group(), y = heightAt(x, z); g.position.set(x, y, z); g.rotation.y = h + Math.PI / 2; scene.add(g);
  const wall = std(0xeee6d4), trim = std(0x3e5a3a), roofM = std(0x5b4433), wood = std(0x7a5a3a);
  g.add(box(14, 4.6, 9, wall, 0, 2.3, 0), box(14.4, 0.25, 9.4, trim, 0, 4.7, 0));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 6.6, 3, 4, 1), roofM); roof.rotation.y = Math.PI / 4; roof.scale.set(1.55, 1, 1.0); roof.position.y = 6.2; roof.castShadow = true; g.add(roof);
  g.add(box(14, 0.2, 3, wood, 0, 0.35, -6), box(1.6, 2.6, 0.1, std(0x4a3626), 0, 1.3, -4.52)); // porch + door
  for (const px of [-6.5, -2, 2, 6.5]) g.add(box(0.18, 3.2, 0.18, wood, px, 1.9, -7.3));
  g.add(box(14, 0.18, 3.2, roofM, 0, 3.55, -6.1));
  for (const wx of [-4.5, 4.5]) g.add(box(2, 1.4, 0.1, std(0x9ec3d6, { roughness: 0.2 }), wx, 2.4, -4.52));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.3), new THREE.MeshBasicMaterial({ map: textSprite('AMISH STORE', 512, 110, '#3e5a3a'), side: THREE.DoubleSide }));
  sign.position.set(0, 4.2, -4.6); sign.rotation.y = Math.PI; g.add(sign);
  for (const bx of [-3.6, -2.4]) g.add(box(0.9, 0.9, 0.9, std(0xd8a04a), bx + 9, 0.45, -6)); // produce crates
  return new THREE.Vector3(x, y, z);
})();
setDot('store', STORE.x, STORE.z);

// ---- Zyn tins (12 hidden around the map; Hewitt gets double time and never burns his lip)
const FLAVORS = {
  wintergreen: { name: 'Wintergreen', color: '#3fb6c8', hex: 0x3fb6c8, desc: 'Steady aim' },
  citrus: { name: 'Citrus', color: '#f2b233', hex: 0xf2b233, desc: 'Stamina never quits' },
  coffee: { name: 'Coffee', color: '#8a5a3a', hex: 0x8a5a3a, desc: 'Move faster' },
};
const FL = Object.keys(FLAVORS);
let zyn = null; // {flavor, t, max}
const tinsFound = new Set(store.get('tins', []));
function tinTex(color) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#f7f7f4'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill(); g.fillStyle = color; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '800 44px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ZYN', 64, 66); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function buildTin(flavor) {
  const f = FLAVORS[flavor], g = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, metalness: 0.2 }), top = new THREE.MeshStandardMaterial({ map: tinTex(f.color), roughness: 0.4, emissive: f.hex, emissiveIntensity: 0.15 });
  const tin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 28), [side, top, side]); tin.rotation.x = Math.PI / 2 - 0.35; tin.castShadow = true; g.add(tin);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: f.hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })); glow.scale.setScalar(1.6); g.add(glow);
  g.userData = { tin, glow }; return g;
}
const tinSpots = (() => {
  const r = mulberry32(2028), spots = [
    { id: 'porch', x: HQ.x - 9, z: HQ.z + 5, hint: 'on the HQ porch' },
    { id: 'gate', x: GATE.x + 3, z: GATE.z + 2, hint: 'by the Eagle Valley gate' },
    { id: 'store', x: STORE.x + 4, z: STORE.z + 3, hint: 'at the Amish store' },
    { id: 'dash', vehicle: truck, hint: 'on the truck dash' },
    { id: 'console', vehicle: xterra, hint: 'in the Xterra console' },
  ];
  const roads = vec.roads.filter((q) => q.pts.length > 4);
  for (let i = 0; spots.length < 9 && i < 400; i++) { // roadside tins
    const q = roads[Math.floor(r() * roads.length)], p = q.pts[Math.floor(r() * q.pts.length)];
    if (Math.abs(p[0]) > HALF - 300 || Math.abs(p[1]) > HALF - 300 || spots.some((s) => s.x != null && Math.hypot(s.x - p[0], s.z - p[1]) < 1200)) continue;
    spots.push({ id: 'road' + spots.length, x: p[0] + 6, z: p[1] + 6, hint: 'along ' + (q.name || 'a back road') });
  }
  for (let i = 0; spots.length < 12 && i < 400; i++) { // ridge tins in elk country
    const x = lerp(ELK_ZONE.x0, ELK_ZONE.x1, r()), z = lerp(ELK_ZONE.z0, ELK_ZONE.z1, r());
    if (heightAt(x, z) < heightAt(x + 60, z) || heightAt(x, z) < heightAt(x, z + 60) || spots.some((s) => s.x != null && Math.hypot(s.x - x, s.z - z) < 700)) continue;
    spots.push({ id: 'ridge' + spots.length, x, z, hint: 'on a ridge in elk country' });
  }
  spots.forEach((s, i) => { s.flavor = FL[i % 3]; if (s.x != null) { s.mesh = buildTin(s.flavor); s.mesh.position.set(s.x, heightAt(s.x, s.z) + 0.9, s.z); scene.add(s.mesh); } });
  return spots;
})();
const TIN_N = tinSpots.length;
const taken = new Set(); // picked up this session (tins come back next session; the found count stays)
function updateTins(dt, t) {
  for (const s of tinSpots) {
    if (!s.mesh || taken.has(s.id)) continue;
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    s.mesh.visible = d < 600; if (!s.mesh.visible) continue;
    s.mesh.userData.tin.rotation.z = t * 1.6; s.mesh.position.y = heightAt(s.x, s.z) + 0.9 + Math.sin(t * 2 + s.x) * 0.12;
    s.mesh.userData.glow.scale.setScalar(1.4 + Math.sin(t * 3) * 0.25 + Math.min(4, d / 60));
    if (d < (player.inVehicle ? 5 : 2.4)) { taken.add(s.id); s.mesh.visible = false; takeTin(s); }
  }
}
function takeTin(s) {
  const first = !tinsFound.has(s.id); tinsFound.add(s.id); store.set('tins', [...tinsFound]);
  const f = FLAVORS[s.flavor], hew = player.crew.id === 'hewitt', dur = hew ? 120 : 60;
  audio.pop(); if (!player.inVehicle) player.model.userData.ch.play('Interact', 0.15, { once: true });
  if (zyn && zyn.t > 0 && !hew) { fx.burn = 6; say(player.crew.name, pick(['Two at once. Bad idea. My lip is on FIRE.', 'Oh. Oh no. Too many.', 'Why does my whole face tingle?'])); }
  else if (zyn && zyn.t > 0 && hew) say('Hewitt', pick(['…Rookie numbers.', 'Doubled up. Locked in.']));
  zyn = { flavor: s.flavor, t: dur, max: dur };
  toast(`Zyn · ${f.name}`, `${f.desc} for ${dur} s${hew ? ' (Hewitt bonus: double time)' : ''} · Tins found ${tinsFound.size}/${TIN_N}${first ? '' : ' (already counted)'}`, 3.6);
  if (hew) setTimeout(() => { say('Hewitt', pick(['…Now we\'re hunting.', 'Ahh. Okay. Thinking clearly now.', 'That\'s the stuff.', '…Yep. That\'s the one.'])); setTimeout(() => crewLine('zynReact'), 2600); }, fx.burn > 0 ? 0 : 900);
  else if (withYou('hewitt')) setTimeout(() => { const n = npcs.find((q) => q.crew.id === 'hewitt'); say('Hewitt', pick(['…You gonna share that?', 'Is that mine?', 'That\'s my flavor.'])); n.talkT = 2.5; }, 1100);
  else setTimeout(() => say(player.crew.name, pick(['Hewitt\'s gonna want one of these.', 'Saving this for Hewitt. Maybe.'])), 1100);
  drawTrophyBoard();
}
const ZYN_REACT = { skin: ['Another one? Really?', 'Those things will rot your gums.'], dawg: ['Can I have one?', 'Is that wintergreen? Gimme.'], l: ['Hewitt\'s locked in now. Don\'t talk to him.', 'I\'m telling everybody.'], kyle: ['Don\'t let my kids see that.'], slime: ['I\'ve got a tin organizer for those in the Xterra.'] };
for (const c of CREW) if (ZYN_REACT[c.id]) c.lines.zynReact = ZYN_REACT[c.id];

// ---- abilities
function useAbility() {
  if (!started) return;
  const c = player.crew;
  if (ab.cd > 0) { toastOnce(c.power, `Ready in ${Math.ceil(ab.cd)} s`); return; }
  let ok = true;
  switch (c.id) {
    case 'hewitt': fx.calm = 8; if (!scoping) setScope(true); say('Hewitt', pick(['…Breathe.', 'Easy.', '…'])); break;
    case 'kyle': fx.wind = 20; player.stamina = 100; player.exhausted = false; say('Kyle', pick(['I could do this ridge twice.', 'Let\'s GO.', 'Kids are asleep. Time to move.'])); break;
    case 'l': ok = smallTalk(); break;
    case 'dawg': snackBreak(); break;
    case 'slime': $('gadgets').classList.remove('hidden'); return; // picks a gadget, cooldown starts then
    case 'skin': ok = iKnowAGuy(); break;
  }
  if (ok) startCd();
}
function startCd() { ab.max = ab.cd = AB_CD[player.crew.id]; audio.power(); }
function smallTalk() {
  if (player.inVehicle) { toastOnce('Small Talk', 'Get out of the truck to chat.'); return false; }
  let best = null, bd = 1e9; for (const a of animals) if (a.male && a.state !== 'down') { const d = a.pos.distanceTo(player.pos); if (d < bd) { bd = d; best = a; } }
  if (!best || bd > 3200) { const cx = clamp(player.pos.x + rand(-1, 1) * 900, ELK_ZONE.x0, ELK_ZONE.x1), cz = clamp(player.pos.z + rand(-1, 1) * 900, ELK_ZONE.z0, ELK_ZONE.z1); spawnHerdAt('elk', cx, cz); best = animals[animals.length - 1]; bd = best.pos.distanceTo(player.pos); }
  const fx2 = Math.sin(player.yaw), fz2 = Math.cos(player.yaw), rp = new THREE.Vector3(player.pos.x + fx2 * 5 + fz2 * 2, 0, player.pos.z + fz2 * 5 - fx2 * 2); rp.y = heightAt(rp.x, rp.z);
  if (!rancher) { const rc = buildCharacter(kit, RANCHER); rancher = rc.root; rancher.userData = { ch: rc, talkT: 0 }; }
  const rch = rancher.userData.ch; rancher.position.copy(rp); rancher.rotation.y = Math.atan2(player.pos.x - rp.x, player.pos.z - rp.z); scene.add(rancher); rancher.visible = true; rch.play('Idle_Talking_Loop', 0.2); rancherT = 11;
  const what = best.kind === 'elk' ? 'bull' : 'buck', dx = best.pos.x - player.pos.x, dz = best.pos.z - player.pos.z;
  say('L', pick(['Hey! How\'s it going? Seen anything?', 'Morning! You\'re Dale, right? I know your cousin.', 'Hey, I know you!']));
  setTimeout(() => say('Rancher Dale', `Saw a ${what} ${distWord(bd)} ${dirWord(dx, dz)} of here. Tell your dad hi.`, 4.2), 2600);
  setTimeout(() => { setWaypoint(best.pos.x, best.pos.z, `Dale's ${what}`); tipFor = best; toast('Tip marked', `The ${what} is on your map and marked with a beam.`, 3); }, 3200);
  return true;
}
let rancher = null, rancherT = 0, tipFor = null;
const RANCHER = { bodyTex: 'T_Body_hewitt.jpg', skinBoost: 1.15, hair: 'parted', hairColor: 0x8a8278, facialHair: 'beard', facialColor: 0x9a9288, browColor: 0x8a8278, shirt: 0x8a3a30, shirtFabric: 'knit', pants: 0x3e5470, shoes: 0x5a3e28, sleeve: 0.95, collar: true, cap: 0xd9cdb0, brim: 0x6a5232, belly: 0.04 };
function snackBreak() {
  fx.snack = 45; player.stamina = 100; player.exhausted = false;
  say('Dawg', pick(['Sandwiches. You\'re welcome.', 'Everybody eat. That\'s an order.', 'I packed extra. Obviously.']));
  if (!player.inVehicle) { player.model.userData.ch.play('Interact', 0.15, { once: true }); }
  for (const n of npcs) if (n.mode === 'follow') { n.model.userData.ch.play('Interact', 0.2, { once: true }); n.cheerT = 1.6; }
  setTimeout(() => crewLine('idle', (n) => n.crew.id !== 'dawg') && null, 1800);
}
function iKnowAGuy() {
  fx.permit = 120;
  if (!player.inVehicle && truck.pos.distanceTo(player.pos) > 30) {
    const fx2 = Math.sin(player.yaw), fz2 = Math.cos(player.yaw), x = player.pos.x + fz2 * 7 + fx2 * 3, z = player.pos.z - fx2 * 7 + fz2 * 3;
    for (const r of truck.riders) leaveSeat(r);
    truck.pos.set(x, heightAt(x, z), z); truck.heading = player.yaw; truck.speed = 0; placeVehicle(truck, 1); for (let i = 0; i < 12; i++) emitDust({ ...truck, speed: 9 }, 0.2);
    say('Skin', pick(['I know a guy. He dropped the truck off.', 'Made a call. Truck\'s right there.']));
    setTimeout(() => toast('I Know a Guy', 'Truck delivered. Eagle Valley elk are calmer for 2 minutes.', 3.4), 1600);
  } else { say('Skin', pick(['Called the owners. Take your time up there.', 'I know a guy. We\'re good.'])); toast('I Know a Guy', 'Eagle Valley elk are calmer for 2 minutes.', 3); }
  return true;
}
function pickGadget(g) {
  $('gadgets').classList.add('hidden'); if (!started || ab.cd > 0) return;
  if (g === 'range') { fx.range = 40; if (!scoping) setScope(true); say('Slime', 'Rangefinder on. Yardage and drop in the scope.'); }
  if (g === 'thermal') { fx.thermal = 18; say('Slime', 'Thermals. Everything warm is glowing.'); }
  if (g === 'drone') { if (player.inVehicle) { toastOnce('Drone', 'Stop and get out to fly it.'); return; } fx.drone = 12; setScope(false); say('Slime', pick(['Drone\'s up. Don\'t tell the game warden.', 'Hold on, it\'s in the Xterra… got it.'])); }
  startCd();
}
for (const b of document.querySelectorAll('#gadgets [data-g]')) b.onclick = (e) => { e.stopPropagation(); pickGadget(b.dataset.g); };
$('gadgets').addEventListener('click', () => $('gadgets').classList.add('hidden'));
$('abil').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); useAbility(); });
let lockerCd = 0;
function openLocker() {
  if (lockerCd > 0) { toastOnce('Gear locker', `Slime is reorganizing. ${Math.ceil(lockerCd)} s.`); return true; }
  lockerCd = 120; ab.cd = 0; audio.door(); say('Slime', pick(['Backup for the backup. Here.', 'Batteries charged. Go.', 'Everything has a labeled bin.']));
  toast('Gear locker', `${player.crew.power} is ready again.`, 2.5); return true;
}

// ---- missions
const done = new Set(store.get('missions', []));
let mission = null; // {id, title, stage, t, target, onArrive}
const MISSIONS = {
  amish: { title: 'Amish Store Run', who: 'dawg', offer: 'Can we hit the Amish store? I\'m serious. Before it gets busy.' },
  shortcut: { title: 'Skin\'s Shortcut', who: 'skin', offer: 'I know a shortcut to Eagle Valley. Let me show you.' },
};
function ensureCrew(id) {
  if (player.crew.id === id) return;
  const n = npcs.find((q) => q.crew.id === id); if (!n) return;
  if (n.mode === 'idle') { n.mode = 'follow'; followers.add(id); store.set('followers', [...followers]); n.model.position.set(player.pos.x + 3, 0, player.pos.z - 2); n.model.position.y = heightAt(n.model.position.x, n.model.position.z); }
  if (player.inVehicle && n.mode !== 'ride') { const v = player.inVehicle, seat = v.seats.find((s) => !s.driver && !v.riders.some((r) => r.seat === s)); if (seat) { n.mode = 'ride'; n.vehicle = v; n.seat = seat; seatModel(n.model, v, seat); v.riders.push(n); } }
  renderCrewBar();
}
function startMission(id) {
  if (mission) return;
  const M = MISSIONS[id]; ensureCrew(M.who); audio.chime();
  if (id === 'amish') {
    mission = { id, title: M.title, t: 300, line: 'Get Dawg to the Amish store in Baker', target: STORE };
    say('Dawg', M.offer); setWaypoint(STORE.x, STORE.z, 'Amish store');
    setTimeout(() => crewLine('idle', (n) => n.crew.id === 'skin') ? null : null, 3000);
  }
  if (id === 'shortcut') {
    const h = Math.atan2(GATE.x - player.pos.x, GATE.z - player.pos.z), d = Math.hypot(GATE.x - player.pos.x, GATE.z - player.pos.z);
    const sx = player.pos.x + Math.sin(h) * d * 0.45 + Math.cos(h) * 900, sz = player.pos.z + Math.cos(h) * d * 0.45 - Math.sin(h) * 900; // way off to the side
    const r = nearestRoadPoint(sx, sz, 2500), p = r ? r.p : [sx, sz];
    mission = { id, title: M.title, t: 420, stage: 0, line: 'Follow Skin\'s shortcut', target: new THREE.Vector3(p[0], 0, p[1]) };
    say('Skin', M.offer); setWaypoint(p[0], p[1], 'Skin\'s shortcut');
  }
  toast(M.title, mission.line, 3.4);
}
function finishMission(win, line) {
  const m = mission; mission = null; setWaypoint(null);
  if (win) { done.add(m.id); store.set('missions', [...done]); audio.chime(); toast('Mission complete', m.title, 4); }
  else { audio.fail(); toast('Mission failed', m.title, 3.5); }
  if (line) say(line[0], line[1], 4); drawTrophyBoard();
}
function updateMission(dt) {
  if (!mission) return;
  mission.t -= dt;
  const m = mission, d = Math.hypot(m.target.x - player.pos.x, m.target.z - player.pos.z), slow = !player.inVehicle || Math.abs(player.inVehicle.speed) < 3;
  if (m.id === 'amish') {
    if (d < 30 && slow) {
      const left = m.t; fx.snack = 90; player.stamina = 100;
      finishMission(true, ['Dawg', pick(['Huckleberry pie. Worth every mile.', 'Cinnamon rolls for the whole truck. You\'re welcome.', 'Okay. NOW I can hunt.'])]);
      setTimeout(() => { crewLine('idle', (n) => n.crew.id === 'skin'); toast('Snack pack', `Everyone recovers stamina fast for 90 s${left > 120 ? ' · Early bird bonus' : ''}`, 3.4); }, 4200);
    } else if (m.t <= 0) finishMission(false, ['Dawg', 'They sold out of pie. I\'m going to be hungry ALL day.']);
  }
  if (m.id === 'shortcut') {
    if (m.stage === 0 && d < 40) { m.stage = 1; m.target = GATE.clone(); m.line = 'Okay. Now get to the Eagle Valley gate'; setWaypoint(GATE.x, GATE.z, 'Eagle Valley gate'); say('Skin', pick(['Huh. This road used to go through.', 'That\'s the wrong road. Wait. No. I\'m telling you, it\'s faster.'])); setTimeout(() => crewLine('roast', (n) => n.crew.id !== 'skin'), 3200); }
    else if (m.stage === 1 && d < 40) finishMission(true, ['Skin', m.t > 0 ? 'See? Told you. Shortcut.' : 'Shortcut. Basically.']);
    if (m.t <= 0 && m.stage === 0) finishMission(false, ['Skin', 'That road was there in 1987.']);
  }
  if (mission) { const mm = Math.max(0, Math.ceil(mission.t)); $('obj').innerHTML = `<b>${mission.title}</b><span>${mission.line}</span><span class="om">${distWord(Math.hypot(mission.target.x - player.pos.x, mission.target.z - player.pos.z))} · ${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}</span>`; }
}
// Kyle's kids call at the worst time (Kyle in the party, scoped in on an animal)
let kidsT = 90, kidsRing = 0;
function updateKids(dt) {
  if (!has('kyle')) return;
  if (kidsRing > 0) { kidsRing -= dt; if (kidsRing <= 0) { // didn't answer
      audio.ring(); for (const a of animals) if (a.state !== 'down' && a.pos.distanceTo(player.pos) < 500) { a.state = 'flee'; a.t = rand(6, 9); a.fleeFrom = player.pos.clone(); }
      say('Kyle', 'Sorry! Sorry. It was the kids.'); toast('Spooked', 'Kyle\'s phone blew the stalk.', 2.6); setTimeout(() => crewLine('roast', (n) => n.crew.id !== 'kyle'), 2400); }
    return; }
  kidsT -= dt;
  if (kidsT < 0 && scoping && animals.some((a) => a.state !== 'down' && a.pos.distanceTo(player.pos) < 450)) {
    kidsT = rand(200, 320); kidsRing = 4.5; audio.tone([1320, 1660], 0.05, 0.005, 'square', 0.04);
    toast('Kyle\'s phone is buzzing!', touchMode ? 'Tap Talk to silence it fast' : 'Press E to silence it fast', 4);
  }
}
function answerKids() { if (kidsRing <= 0) return false; kidsRing = 0; say('Kyle', pick(['Hey bud. Dad\'s hunting. Call you back. Love you.', '*whispering* Not now, buddy. Ask your mom.'])); return true; }

// ---- per-frame: timers, buffs HUD, ability button
function updatePowers(dt, t) {
  for (const k in fx) fx[k] = Math.max(0, fx[k] - dt);
  ab.cd = Math.max(0, ab.cd - dt); lockerCd -= dt;
  if (zyn) { zyn.t -= dt; if (zyn.t <= 0) { zyn = null; toastOnce('Zyn wore off', player.crew.id === 'hewitt' ? 'Hewitt is looking for another tin.' : 'Back to normal.'); } }
  if (rancherT > 0) { rancherT -= dt; rancher.userData.ch.mixer.update(dt); if (rancherT <= 0) rancher.removeFromParent(); }
  if (tipFor && !mission && (tipFor.state === 'down' || tipFor.pos.distanceTo(player.pos) < 60)) { tipFor = null; setWaypoint(null); }
  else if (tipFor && !mission && waypoint) { waypoint.x = tipFor.pos.x; waypoint.z = tipFor.pos.z; beam.position.set(tipFor.pos.x, heightAt(tipFor.pos.x, tipFor.pos.z) + 130, tipFor.pos.z); setDot('wp', waypoint.x, waypoint.z); }
  beam.material.opacity = 0.18 + Math.sin(t * 3) * 0.08;
  updateTins(dt, t); updateThermal(); updateMission(dt); updateKids(dt); drawAdvantage(dt);
  // HUD: ability button + active effects
  const c = player.crew, el = $('abil'), pct = ab.cd > 0 ? (1 - ab.cd / ab.max) * 100 : 100;
  el.style.setProperty('--p', pct + '%'); el.classList.toggle('ready', ab.cd <= 0);
  const lbl = `${c.power}${ab.cd > 0 ? ` · ${Math.ceil(ab.cd)}s` : ''}`; if (el.dataset.l !== lbl) { el.dataset.l = lbl; $('abilName').textContent = lbl; }
  const chips = [];
  if (zyn) chips.push([`Zyn ${FLAVORS[zyn.flavor].name}`, zyn.t / zyn.max, FLAVORS[zyn.flavor].color]);
  const NAMES = { calm: ['Dead Calm', 8], wind: ['Second Wind', 20], snack: ['Snack Break', 90], range: ['Rangefinder', 40], thermal: ['Thermals', 18], drone: ['Drone', 12], permit: ['Owners said OK', 120], burn: ['Lip on fire', 6] };
  for (const k in NAMES) if (fx[k] > 0) chips.push([NAMES[k][0], Math.min(1, fx[k] / NAMES[k][1]), k === 'burn' ? '#e0573b' : '#f08a24']);
  const html = chips.map(([n, f, col]) => `<div class="chip"><span>${n}</span><i style="width:${Math.round(f * 100)}%;background:${col}"></i></div>`).join('');
  if ($('buffs').dataset.h !== html) { $('buffs').dataset.h = html; $('buffs').innerHTML = html; }
  $('obj').classList.toggle('hidden', !mission);
}

// ---- "The Advantage": a mini radar that shows animals around you (heading-up)
const advC = $('adv'), advG = advC.getContext('2d'); let advT = 0;
function drawAdvantage(dt) {
  advT -= dt; if (advT > 0) return; advT = 0.1;
  const W = advC.width, R = W / 2, RANGE = 650, k = R / RANGE, yaw = player.inVehicle ? player.inVehicle.heading : (scoping ? camYaw + Math.PI : player.yaw);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const toMap = (x, z) => { const dx = x - player.pos.x, dz = z - player.pos.z; return [R + (dx * cy - dz * sy) * -k, R - (dx * sy + dz * cy) * k]; };
  advG.clearRect(0, 0, W, W); advG.save(); advG.beginPath(); advG.arc(R, R, R - 2, 0, 7); advG.clip();
  advG.strokeStyle = 'rgba(246,238,223,.14)'; advG.lineWidth = 2; for (const r of [0.33, 0.66]) { advG.beginPath(); advG.arc(R, R, R * r, 0, 7); advG.stroke(); }
  advG.beginPath(); advG.moveTo(R, 0); advG.lineTo(R, W); advG.moveTo(0, R); advG.lineTo(W, R); advG.stroke();
  // roads near you
  advG.strokeStyle = 'rgba(220,200,160,.35)'; advG.lineWidth = 3;
  for (const r of vec.roads) { let on = false; advG.beginPath(); for (let i = 0; i < r.pts.length; i += 2) { const p = r.pts[i]; if (Math.abs(p[0] - player.pos.x) > RANGE * 1.5 || Math.abs(p[1] - player.pos.z) > RANGE * 1.5) { on = false; continue; } const [mx, my] = toMap(p[0], p[1]); on ? advG.lineTo(mx, my) : advG.moveTo(mx, my); on = true; } advG.stroke(); }
  const dot = (x, z, col, rad, ring) => { let [mx, my] = toMap(x, z); const dd = Math.hypot(mx - R, my - R); if (dd > R - rad - 3) { mx = R + (mx - R) / dd * (R - rad - 3); my = R + (my - R) / dd * (R - rad - 3); advG.globalAlpha = 0.55; } advG.fillStyle = col; advG.beginPath(); advG.arc(mx, my, rad, 0, 7); advG.fill(); if (ring) { advG.strokeStyle = '#fff'; advG.lineWidth = 2; advG.stroke(); } advG.globalAlpha = 1; };
  for (const v of vehicles) if (v !== player.inVehicle) dot(v.pos.x, v.pos.z, v === truck ? '#c0473a' : '#f2f2ee', 6, true);
  for (const s of tinSpots) if (s.mesh && !taken.has(s.id) && Math.hypot(s.x - player.pos.x, s.z - player.pos.z) < RANGE) dot(s.x, s.z, FLAVORS[s.flavor].color, 5, false);
  for (const a of animals) { if (a.state === 'down') continue; const d = a.pos.distanceTo(player.pos); if (d > RANGE * 1.6) continue;
    const col = a.kind === 'elk' ? (a.male ? '#ffb02a' : '#d9844a') : (a.male ? '#9fe070' : '#cfe7b8'); dot(a.pos.x, a.pos.z, col, a.male ? 7 : 5, a.male); }
  if (waypoint) dot(waypoint.x, waypoint.z, '#ffd34d', 8, true);
  advG.restore();
  advG.fillStyle = '#3fa9f5'; advG.beginPath(); advG.moveTo(R, R - 13); advG.lineTo(R + 9, R + 9); advG.lineTo(R, R + 4); advG.lineTo(R - 9, R + 9); advG.closePath(); advG.fill(); advG.strokeStyle = '#fff'; advG.lineWidth = 2; advG.stroke();
  // north tick
  const [nx, ny] = (() => { const a = Math.atan2(-sy, -cy); return [R + Math.sin(a) * (R - 14), R - Math.cos(a) * (R - 14)]; })();
  advG.fillStyle = '#f4ecdc'; advG.font = '700 22px Oswald, sans-serif'; advG.textAlign = 'center'; advG.textBaseline = 'middle'; advG.fillText('N', nx, ny);
}

// ---- first-time "how to play" (phone or computer version), reopen with the How to play button
function showHowTo() {
  const c = player.crew, T = touchMode, it = (ic, title, text, or) => `<div class="hi"><span class="ic ${or ? 'or' : ''}">${ic}</span><div><b>${title}</b>${text}</div></div>`;
  $('howRot').textContent = T ? 'Best with your phone turned sideways.' : 'Click the game to look around with the mouse.';
  $('howGrid').innerHTML = [
    T ? it('Move', 'Move and look', 'Left thumb on the joystick to walk. Swipe anywhere with your right thumb to look.') : it('WASD', 'Move and look', 'WASD to walk, Shift to sprint, mouse to look. C crouches so animals don\'t spook.'),
    T ? it('Shoot', 'Hunt', 'Tap Shoot once to open the scope, tap again to fire. Zoom changes power. Crouch to sneak.', 1) : it('RMB', 'Hunt', 'Hold right-click to scope, left-click to fire. Scroll to zoom. Bulls and bucks only.', 1),
    it(T ? 'Power' : 'G', `Special ability: ${c.power}`, `${T ? 'The round button with the ring.' : 'Press G or click the round button.'} It glows when it\'s ready. Every hunter has a different one.`, 1),
    it('Swap', 'Switch hunters', T ? 'Tap a crew face at the top, or your name card. Works anytime, even mid-mission.' : 'Press 1 to 6 or click a crew face. Works anytime, even mid-mission.'),
    it('Radar', 'The Advantage', 'The radar in the corner. Dots are animals; the big ones are bulls and bucks. Yellow is your target.'),
    it('Zyn', 'Zyn tins', '12 glowing tins hidden around the map. Each one is a 60-second boost. Hewitt gets double.'),
    it(T ? 'Talk' : 'E', 'Crew and missions', `${T ? 'Tap Talk' : 'Press E'} near the crew to chat or invite them. When Dawg or Skin "has a request," that starts a mission.`),
    it(T ? 'Truck' : 'F', 'Drive and travel', `${T ? 'Tap Truck' : 'Press F'} near a vehicle; the crew hops in. Open the Map and tap a road to fast travel.`),
  ].join('');
  $('howto').classList.remove('hidden');
}
$('howGo').onclick = () => { $('howto').classList.add('hidden'); store.set('howto', 1); };
$('helpBtn').onclick = (e) => { e.stopPropagation(); if (started) showHowTo(); };
// effect multipliers used by the core loop
const swayMul = () => (fx.calm > 0 ? 0 : 1) * (zyn && zyn.flavor === 'wintergreen' ? (player.crew.id === 'hewitt' ? 0.15 : 0.35) : 1) * (fx.burn > 0 ? 2.5 : 1);
const speedMul = () => (zyn && zyn.flavor === 'coffee' ? 1.3 : 1) * (fx.wind > 0 ? 1.1 : 1);
const noDrain = () => fx.wind > 0 || (zyn && zyn.flavor === 'citrus');
const regenMul = () => (fx.snack > 0 ? 2.5 : 1) * (zyn && zyn.flavor === 'citrus' ? 2 : 1);
const rangeBonus = () => (fx.range > 0 ? 120 : 0);

// ---------------------------------------------------------------- update loop
const clock = new THREE.Clock();
let todT = 0, bugleT = 25, banterT = 30, spotT = 1;
let started = false;
const fwd = new THREE.Vector3();
function updatePlayer(dt) {
  const c = player.crew, st = c.stats;
  if (player.inVehicle) { player.model.userData.ch.play('Driving_Loop', 0.2); player.model.userData.ch.mixer.update(dt); return updateVehicle(player.inVehicle, dt); }
  let ix = stick.x + (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), iz = -stick.y + (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const mag = clamp(Math.hypot(ix, iz), 0, 1); if (mag < 0.12) { ix = 0; iz = 0; }
  if (scoping) { ix *= 0.3; iz *= 0.3; }
  const moving = ix || iz;
  const wantSprint = keys.ShiftLeft || keys.ShiftRight || touchSprint;
  if (player.stamina < 1) player.exhausted = true; if (player.stamina > 35) player.exhausted = false;
  const sprint = wantSprint && moving && !player.exhausted && !player.crouch && !scoping;
  let spd = (2.0 + st.walk * 0.26) * speedMul(); if (sprint) spd *= 1.95; if (player.crouch) spd *= 0.45;
  if (!sprint && mag < 0.7) spd = Math.min(spd, 1.4 + mag);
  const camFwdYaw = camYaw + Math.PI;
  let mx = 0, mz = 0;
  if (moving) {
    const a = Math.atan2(ix, iz); const dir = camFwdYaw - a;
    mx = Math.sin(dir); mz = Math.cos(dir);
    const ahead = heightAt(player.pos.x + mx * 1.5, player.pos.z + mz * 1.5) - heightAt(player.pos.x, player.pos.z);
    const grade = ahead / 1.5;
    if (grade > 0 && !(fx.wind > 0)) spd *= clamp(1 - grade * (1.6 - st.hike * 0.11), 0.3, 1);
    if (grade > 0.12) player.uphillT += dt; else player.uphillT = Math.max(0, player.uphillT - dt);
    if (!noDrain()) player.stamina -= Math.max(0, grade) * (11 - st.hike) * 3 * dt;
    if (!scoping) { let d = dir - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); player.yaw += d * Math.min(1, dt * 10); }
  } else player.uphillT = Math.max(0, player.uphillT - dt);
  if (scoping) player.yaw = camFwdYaw;
  if (sprint) { if (!noDrain()) player.stamina -= (5 + (10 - st.stamina) * 3.2) * dt; }
  else player.stamina += (4 + st.stamina * 1.6) * (moving ? 0.6 : 1) * regenMul() * dt;
  player.stamina = clamp(player.stamina, 0, 100);
  player.pos.x = clamp(player.pos.x + mx * spd * dt, -HALF + 10, HALF - 10);
  player.pos.z = clamp(player.pos.z + mz * spd * dt, -HALF + 10, HALF - 10);
  const g = heightAt(player.pos.x, player.pos.z);
  if (keys.Space && player.onGround) { player.vy = 5.2; player.onGround = false; }
  player.vy -= 18 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= g) { player.pos.y = g; player.vy = 0; player.onGround = true; }
  player.speed = moving ? spd : 0;
  player.model.position.copy(player.pos); player.model.rotation.y = player.yaw;
  animatePerson(player.model, player.speed, dt, player.crouch);
  // personality barks
  if (c.id === 'dawg' && player.uphillT > 2.5) { if (bark('uphill', 22)) player.uphillT = 0; }
  if (player.exhausted) { if (!bark('tired', 18)) { if (!cds[c.id + 'puff']) { cds[c.id + 'puff'] = 15; say(c.name, pick(['*wheeze*', 'Gimme a second.', 'Okay. Okay. Breathing.'])); } } }
  if (c.id === 'slime' && xterra.pos.distanceTo(player.pos) < 6 && !cds.slimeX) { cds.slimeX = 40; say('Slime', pick(['Hang on, it\'s in the Xterra.', 'Got a gadget for that.'])); }
}
function updateVehicle(v, dt) {
  const thr = clamp((keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - stick.y, -1, 1), st = clamp((keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0) - stick.x, -1, 1);
  if (thr > 0.1) v.speed += (v.speed < 0 ? 14 : 8.5) * thr * dt;
  else if (thr < -0.1) v.speed -= (v.speed > 0.5 ? 16 : 5) * -thr * dt;
  else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3.5 * dt);
  if (keys.Space) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 22 * dt);
  v.speed -= Math.sin(v.pitch || 0) * 9.8 * dt * 0.7;               // hills
  v.speed *= 1 - 0.002 * Math.abs(v.speed) * dt * 10;               // drag
  const top = onRoad(v.pos.x, v.pos.z) ? v.top : v.top * (has('hewitt') ? 0.75 : 0.55);
  if (v.speed > top) v.speed = lerp(v.speed, top, Math.min(1, dt * 1.5));
  v.speed = clamp(v.speed, -9, v.top);
  v.steer = lerp(v.steer, st * 0.55 / (1 + Math.abs(v.speed) * 0.06), Math.min(1, dt * 6));
  v.heading += (v.speed * Math.tan(v.steer) / v.wb) * dt;
  const nx = v.pos.x + Math.sin(v.heading) * v.speed * dt, nz = v.pos.z + Math.cos(v.heading) * v.speed * dt;
  const grade = (heightAt(nx, nz) - heightAt(v.pos.x, v.pos.z)) / Math.max(0.01, Math.hypot(nx - v.pos.x, nz - v.pos.z));
  if (grade > 0.85 && v.speed > 0) { v.speed *= 0.5; toastOnce('Too steep', 'Even Slime\'s gadgets can\'t climb that.'); }
  else { v.pos.x = clamp(nx, -HALF + 10, HALF - 10); v.pos.z = clamp(nz, -HALF + 10, HALF - 10); }
  placeVehicle(v, Math.min(1, dt * 8));
  for (const w of v.wheels) { w.spin.rotation.x += v.speed * dt / v.wheelR; if (w.front) w.pivot.rotation.y = v.steer * 0.9; }
  emitDust(v, dt);
  player.pos.copy(v.pos);
  $('speed').innerHTML = `${Math.round(Math.abs(v.speed) * 2.237)}<small>mph</small>`;
}
let toastOnceCd = 0; function toastOnce(a, b) { if (toastOnceCd <= 0) { toast(a, b, 2); toastOnceCd = 6; } }

function updateAnimals(dt) {
  const pp = player.pos, inV = player.inVehicle, vSpeed = inV ? Math.abs(inV.speed) : 0;
  const noise = inV ? (vSpeed > 2 ? 230 : 90) : player.crouch ? 20 : player.speed > 5 ? 110 : player.speed > 0 ? 50 : 30;
  for (let i = animals.length - 1; i >= 0; i--) {
    const a = animals[i], d = a.pos.distanceTo(pp);
    if (a.state === 'down') {
      a.mesh.rotation.z = lerp(a.mesh.rotation.z, Math.PI / 2, dt * 3);
      a.mesh.position.y = lerp(a.mesh.position.y, a.pos.y + 0.3, dt * 3);
      a.gone -= dt;
      if (a.gone < 0 && d > 150) { scene.remove(a.mesh); animals.splice(i, 1); if (!animals.some((b) => b.kind === a.kind && b.state !== 'down' && b !== a)) spawnHerd(a.kind, 700); else if (Math.random() < 0.5) spawnHerd(a.kind, 700); }
      continue;
    }
    if (d > 1600) continue;
    const wary = (a.kind === 'elk' ? 1.25 : 1) * (fx.permit > 0 && a.pos.x > ELK_ZONE.x0 - 500 && a.pos.z < ELK_ZONE.z1 + 500 ? 0.55 : 1);
    a.t -= dt;
    if ((a.state === 'graze' || a.state === 'walk') && d < noise * wary) { a.state = 'alert'; a.t = rand(1.2, 2.5); }
    if (a.state === 'alert') {
      a.speed = 0; const want = Math.atan2(pp.x - a.pos.x, pp.z - a.pos.z); a.heading += Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading)) * dt * 4;
      if (a.t < 0) { if (d < noise * wary * 0.9) { a.state = 'flee'; a.t = rand(6, 10); a.fleeFrom = pp.clone(); } else { a.state = 'graze'; a.t = rand(2, 5); } }
    } else if (a.state === 'flee') {
      const want = Math.atan2(a.pos.x - a.fleeFrom.x, a.pos.z - a.fleeFrom.z) + Math.sin(a.t * 1.3) * 0.4;
      a.heading += Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading)) * dt * 3;
      a.speed = a.kind === 'elk' ? 11 : 13;
      if (a.t < 0) { a.state = 'graze'; a.t = rand(3, 8); }
    } else if (a.state === 'graze') {
      a.speed = 0; if (a.t < 0) { a.state = 'walk'; a.t = rand(3, 9); a.heading += rand(-1.5, 1.5); }
    } else if (a.state === 'walk') {
      a.speed = 1.3; if (a.t < 0) { a.state = 'graze'; a.t = rand(3, 10); }
    }
    if (a.speed > 0) {
      const nx = a.pos.x + Math.sin(a.heading) * a.speed * dt, nz = a.pos.z + Math.cos(a.heading) * a.speed * dt;
      if (Math.abs(nx) > HALF - 40 || Math.abs(nz) > HALF - 40 || classify(nx, nz) === 'urban') a.heading += Math.PI * 0.7 * dt * 4;
      else { a.pos.x = nx; a.pos.z = nz; }
    }
    a.pos.y = heightAt(a.pos.x, a.pos.z);
    a.mesh.position.copy(a.pos); a.mesh.rotation.y = a.heading;
    animateAnimal(a.mesh, a.speed, a.state, dt);
  }
}

const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
function updateCamera(dt) {
  const v = player.inVehicle;
  camIdle += dt;
  if (v && camIdle > 1.2) { const want = v.heading + Math.PI; camYaw += Math.atan2(Math.sin(want - camYaw), Math.cos(want - camYaw)) * Math.min(1, dt * 2); }
  if (scoping) {
    const st = player.crew.stats, t = performance.now() * 0.001;
    const sway = ((11 - st.aim) * 0.0011 + (1 - player.stamina / 100) * 0.005 + (player.speed > 0 ? 0.006 : 0)) * (player.crouch ? 0.5 : 1) * swayMul();
    camera.fov = lerp(camera.fov, ZOOMS[zoomIdx], dt * 10); camera.near = 5; camera.updateProjectionMatrix();
    camera.position.set(player.pos.x, player.pos.y + (player.crouch ? 1.4 : 1.7), player.pos.z);
    const yaw = camYaw + Math.PI + Math.sin(t * 1.3) * sway, pitch = -camPitch * 0.6 + Math.sin(t * 2.1) * sway * 0.7;
    camera.lookAt(camera.position.x + Math.sin(yaw) * Math.cos(pitch), camera.position.y + Math.sin(pitch), camera.position.z + Math.cos(yaw) * Math.cos(pitch));
    player.model.visible = false;
    return;
  }
  player.model.visible = true;
  if (fx.drone > 0) { // Slime's scout drone: high overhead, slowly circling
    const t = performance.now() * 0.00015; camera.fov = lerp(camera.fov, 55, dt * 4); camera.near = 1; camera.updateProjectionMatrix();
    camPos.set(player.pos.x + Math.sin(t) * 90, player.pos.y + 170, player.pos.z + Math.cos(t) * 90); camera.position.lerp(camPos, Math.min(1, dt * 2)); camera.lookAt(player.pos.x - Math.sin(t) * 120, player.pos.y, player.pos.z - Math.cos(t) * 120); return;
  }
  camera.fov = lerp(camera.fov, 65, dt * 8); camera.near = 0.2; camera.updateProjectionMatrix();
  const dist = v ? 11 : 4.6, up = v ? 2.2 : 1.6;
  camTarget.set(player.pos.x, player.pos.y + up, player.pos.z);
  camPos.set(camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * dist, camTarget.y + Math.sin(camPitch) * dist, camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * dist);
  const floor = heightAt(camPos.x, camPos.z) + 0.6; if (camPos.y < floor) camPos.y = floor;
  camera.position.lerp(camPos, Math.min(1, dt * (v ? 8 : 14)));
  camera.lookAt(camTarget);
  if (fx.burn > 0) { camera.rotation.z += Math.sin(performance.now() * 0.05) * 0.012; camera.rotation.x += Math.sin(performance.now() * 0.071) * 0.008; }
}

function updateHud(dt) {
  const s = $('stam'); s.firstChild.style.width = player.stamina + '%'; s.classList.toggle('low', player.exhausted);
  subT -= dt; if (subT <= 0) $('sub').style.opacity = 0;
  toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0;
  toastOnceCd -= dt; for (const k in cds) cds[k] -= dt;
  idleBarkT -= dt; if (idleBarkT < 0) { idleBarkT = rand(40, 70); bark('idle'); }
  let prompt = '';
  if (!player.inVehicle) { const v = nearestVehicle(), n = nearestNpc(); if (v) prompt = `<kbd>F</kbd> drive ${v.name}${v.riders ? '' : ''}`; else if (n) prompt = n.mode === 'idle' ? `<kbd>E</kbd> ask ${n.crew.name} to come` : (!mission && MISSIONS_FOR[n.crew.id] && !offered.has(n.crew.id)) ? `<kbd>E</kbd> ${n.crew.name} has a request` : `<kbd>E</kbd> talk to ${n.crew.name}`; else if (has('slime') && xterra.pos.distanceTo(player.pos) < 6) prompt = '<kbd>E</kbd> open Slime\'s gear locker'; }
  if (kidsRing > 0) prompt = '<kbd>E</kbd> silence Kyle\'s phone!';
  $('prompt').innerHTML = prompt; $('prompt').classList.toggle('hidden', !prompt);
  if (scoping) {
    const h = animalUnderCrosshair();
    const max = 150 + player.crew.stats.aim * 30;
    const max2 = max + rangeBonus();
    if (fx.range > 0 && h) { const yd = Math.round(h.d * 1.094), drop = Math.max(0, Math.round(((h.d * 1.094 - 200) / 100) ** 2 * 3.2)); $('scopeinfo').textContent = `${label(h.a)} · ${yd} yd · drop ${drop}" · hold ${drop > 10 ? 'high' : 'center'}${!h.a.male ? ' · no tag' : h.d > max2 ? ' · out of range' : ''}`; } else
    $('scopeinfo').textContent = h ? `${label(h.a)} · ${Math.round(h.d)} m · ${h.a.state === 'flee' ? 'running' : h.a.state === 'alert' ? 'alert' : 'unaware'}${!h.a.male ? ' · no tag' : h.d > max2 ? ' · out of range' : ''}` : `Effective range for ${player.crew.name}: ${max2} m · Left-click to shoot`;
  }
  const elev = Math.round((player.pos.y + BASE) * 3.281);
  const lon = lerp(meta.nw[0], meta.se[0], player.pos.x / S + 0.5), lat = lerp(meta.nw[1], meta.se[1], player.pos.z / S + 0.5);
  const hh = Math.floor(gameHour), mm = Math.floor((gameHour - hh) * 60);
  $('place').textContent = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} · ${elev.toLocaleString()} ft`;
  $('lock').classList.toggle('hidden', touchMode || locked() || dragging || scoping || !started || subT > 0 || player.inVehicle || moved > 0);
  if (!$('map').classList.contains('hidden')) { setDot('me', player.pos.x, player.pos.z); setDot('truck', truck.pos.x, truck.pos.z); setDot('xterra', xterra.pos.x, xterra.pos.z); }
}

function frame() {
  const rdt = Math.min(clock.getDelta(), 0.05); slowT -= rdt; const dt = slowT > 0 ? rdt * 0.25 : (fx.calm > 0 && scoping) ? rdt * 0.55 : rdt;
  if (started) { updatePowers(rdt, clock.elapsedTime); updatePlayer(dt); updateAnimals(dt); updateHud(rdt); updateBanter(rdt); gameHour = Math.min(19, gameHour + rdt / 240); }
  updateNpcs(dt); updateDust(dt);
  todT -= rdt; if (todT < 0) { todT = 1; applyTimeOfDay(); }
  if (started) {
    const v = player.inVehicle;
    audio.update(rdt, { altitude: player.pos.y, inVehicle: !!v, speed: v ? v.speed : 0, throttle: v ? Math.max(0, (keys.KeyW ? 1 : 0) - stick.y) : 0, onRoadPaved: v ? onPaved(v.pos.x, v.pos.z) : false,
      footSpeed: player.speed, crouch: player.crouch, waterDist: waterDistAt(player.pos.x, player.pos.z), birdChance: (classify(player.pos.x, player.pos.z) === 'tree' ? 0.75 : 0.25) * (gameHour < 10 ? 1 : 0.5) });
  }
  for (const v of vehicles) if (v !== player.inVehicle) placeVehicle(v, 1);
  updateCamera(dt);
  refillNear(player.pos.x, player.pos.z);
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 200); sun.target.position.copy(player.pos);
  fill.position.copy(camera.position).y += 2; fill.target.position.copy(player.pos);
  scene.userData.sky.position.copy(camera.position);
  if (flashT > 0) { flashT -= dt; renderer.toneMappingExposure = 1.6; } else renderer.toneMappingExposure = 0.92;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- menu
let chosen = store.get('crew', 'hewitt');
function renderCards() {
  $('cards').innerHTML = CREW.map((c, i) => `
    <button class="card ${c.id === chosen ? 'sel' : ''}" data-id="${c.id}">
      <img src="assets/portraits/${c.id}.jpg" alt="${c.name}">
      <div class="nm">${i + 1}. ${c.name}</div><div class="rl">${c.role}</div>
      ${c.card.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b><div class="bar"><i class="${v > 10 ? 'over' : ''}" style="width:${Math.min(v, 10) * 10}%"></i></div></div>`).join('')}
      <div class="pw"><b>${c.power}:</b> ${c.powerDesc}<i>With you: ${c.passive}</i></div>
    </button>`).join('');
  for (const b of $('cards').querySelectorAll('.card')) b.onclick = () => { chosen = b.dataset.id; renderCards(); };
}
renderCards();
function renderWhoComes() {
  $('comes').innerHTML = CREW.filter((c) => c.id !== chosen).map((c) => `<button class="pick ${followers.has(c.id) ? 'on' : ''}" data-id="${c.id}"><img src="assets/portraits/${c.id}.jpg" alt=""><span>${c.name}</span></button>`).join('');
  for (const b of $('comes').children) b.onclick = () => { const id = b.dataset.id; followers.has(id) ? followers.delete(id) : followers.add(id); store.set('followers', [...followers]); renderWhoComes(); };
}
$('start').onclick = () => { audio.start(); $('menu').classList.add('hidden'); $('where').classList.remove('hidden'); renderWhoComes(); };
for (const b of document.querySelectorAll('#where .dest')) b.onclick = () => begin(b.dataset.dest);
function begin(dest) {
  $('where').classList.add('hidden'); $('hud').classList.remove('hidden'); audio.start();
  setCrew(chosen); started = true; updateTags(); drawTrophyBoard();
  for (let i = 0; i < 24; i++) spawnHerd('deer');
  for (let i = 0; i < 6; i++) spawnHerd('elk');
  DESTS[dest](); renderCrewBar();
  if (dest === 'hq') { say(player.crew.name, pick(player.crew.lines.select)); setTimeout(() => toast('Welcome to Salmon', touchMode ? 'Walk to the truck, tap Truck, and go find some animals.' : 'Grab the truck (F) and go find some animals.', 4), 2600); }
  idleBarkT = rand(30, 50);
  if (!store.get('howto', 0)) setTimeout(showHowTo, 400);
}
$('trophiesBtn').onclick = () => { renderTrophyList(); $('trophyPanel').classList.toggle('hidden'); };
// idle menu camera
player.crew = CREW[0]; player.model = buildPerson(CREW[0]); player.model.visible = false; scene.add(player.model);
player.pos.y = heightAt(player.pos.x, player.pos.z);
$('loading').classList.add('hidden');
frame();
// test hooks for automated playtesting
window.RH = { player, animals, vehicles, heightAt, classify, setScope, shoot, toggleVehicle, setCrew, keys, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, set camPitch(v) { camPitch = v; }, set camIdle(v) { camIdle = v; }, npcs, truck, begin, switchTo, fx, ab, useAbility, pickGadget, tinSpots, takeTin, startMission, get mission() { return mission; }, STORE, get zyn() { return zyn; } };
