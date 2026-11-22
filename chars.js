// RoadHunter character builder.
// Base body + hair: Quaternius "Universal Base Characters" (CC0). Animations: Quaternius "Universal Animation Library" (CC0).
// Clothes are generated at load time from the body's own skinned geometry, so they bend with every animation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const DIR = 'assets/chars/';
const loader = new GLTFLoader();
// Models ship as glTF JSON with the binary buffer base64-embedded. The artifact host blocks fetch() of data: URLs,
// so decode the buffer here and hand GLTFLoader an in-memory .glb instead.
async function gltf(f) {
  const j = await fetch(DIR + f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); });
  const b64 = j.buffers[0].uri.split(',')[1], bin0 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  delete j.buffers[0].uri; j.buffers[0].byteLength = bin0.length;
  const pad4 = (n) => (n + 3) & ~3;
  let json = new TextEncoder().encode(JSON.stringify(j));
  const jsonLen = pad4(json.length), binLen = pad4(bin0.length), total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jsonLen); out.set(json, 20);
  const o = 20 + jsonLen; dv.setUint32(o, binLen, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin0, o + 8);
  return new Promise((res, rej) => loader.parse(out.buffer, DIR, res, rej));
}
const texLoader = new THREE.TextureLoader();
function tex(f) { const t = texLoader.load(DIR + f); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return t; }

export async function loadKit() {
  const [body, buzz, beard, brows, parted, clipJson] = await Promise.all([
    gltf('Superhero_Male_FullBody.json'), gltf('Hair_Buzzed.json'), gltf('Hair_Beard.json'),
    gltf('Eyebrows_Regular.json'), gltf('Hair_SimpleParted.json'), fetch(DIR + 'clips.json').then((r) => r.json()),
  ]);
  const clips = {}; for (const c of clipJson) clips[c.name] = THREE.AnimationClip.parse(c);
  return { body, hair: { buzz, beard, brows, parted }, clips, lightSkin: tex('T_Superhero_Male_Light.jpg') };
}

// ------------------------------------------------------------------ fabric textures (procedural, no downloads)
function fabricTexture(kind, base, opts = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const col = new THREE.Color(base);
  g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256), d = img.data;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const k = (y * 256 + x) * 4; let n = (Math.random() - 0.5) * 14;
    if (kind === 'denim') n += ((x + y) % 4 < 2 ? 10 : -6) + (Math.random() < 0.02 ? 30 : 0);
    if (kind === 'knit') n += (x % 3 === 0 ? -6 : 3) + (y % 4 === 0 ? -4 : 0);
    if (kind === 'camo') {
      const v = Math.sin(x * 0.05 + Math.sin(y * 0.07) * 2) + Math.sin(y * 0.045 + Math.cos(x * 0.06) * 2.2);
      n += v > 0.9 ? -38 : v < -0.8 ? 26 : 0;
    }
    if (kind === 'leather') n += Math.sin(x * 0.3) * Math.sin(y * 0.27) * 6;
    d[k] = Math.max(0, Math.min(255, d[k] + n)); d[k + 1] = Math.max(0, Math.min(255, d[k + 1] + n)); d[k + 2] = Math.max(0, Math.min(255, d[k + 2] + n));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(opts.repeat || 4, opts.repeat || 4); return t;
}

// ------------------------------------------------------------------ geometry helpers
function boneIndex(skeleton, name) { return skeleton.bones.findIndex((b) => b.name === name); }
function bindPositions(skeleton) { // joint world positions in bind pose
  const out = {}; const m = new THREE.Matrix4();
  skeleton.bones.forEach((b, i) => { m.copy(skeleton.boneInverses[i]).invert(); out[b.name] = new THREE.Vector3().setFromMatrixPosition(m); });
  return out;
}
function weightOn(geo, v, set) {
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight; let w = 0;
  for (let c = 0; c < 4; c++) if (set.has(si.getComponent(v, c))) w += sw.getComponent(v, c);
  return w;
}
// welded adjacency so smoothing works across UV seams
function weldMap(pos) {
  const map = new Map(), id = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`; if (!map.has(k)) map.set(k, map.size); id[i] = map.get(k); }
  return { id, n: map.size };
}
function subsetGeometry(src, triKeep) {
  const idx = src.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) if (triKeep(idx[t], idx[t + 1], idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (src.attributes[name]) g.setAttribute(name, src.attributes[name].clone());
  g.setIndex(keep); return g;
}
// Laplacian smooth (keeps boundary fixed) then inflate along normals, fading in from the edge
function shapeGarment(g, { smooth = 3, inflate = 0.012, bulge = null }) {
  const pos = g.attributes.position, { id, n } = weldMap(pos), idx = g.index.array;
  const nbr = Array.from({ length: n }, () => new Set()), edgeCount = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[idx[t + e]], b = id[idx[t + (e + 1) % 3]]; nbr[a].add(b); nbr[b].add(a);
    const k = a < b ? a + '_' + b : b + '_' + a; edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  }
  const boundary = new Uint8Array(n); for (const [k, c] of edgeCount) if (c === 1) { const [a, b] = k.split('_'); boundary[+a] = boundary[+b] = 1; }
  // distance (in rings) from the boundary
  const ring = new Float32Array(n).fill(99); const q = [];
  for (let i = 0; i < n; i++) if (boundary[i]) { ring[i] = 0; q.push(i); }
  while (q.length) { const a = q.shift(); for (const b of nbr[a]) if (ring[b] > ring[a] + 1) { ring[b] = ring[a] + 1; q.push(b); } }
  const P = new Float32Array(n * 3), cnt = new Uint16Array(n);
  for (let i = 0; i < pos.count; i++) { const w = id[i]; if (!cnt[w]) { P[w * 3] = pos.getX(i); P[w * 3 + 1] = pos.getY(i); P[w * 3 + 2] = pos.getZ(i); } cnt[w]++; }
  for (let it = 0; it < smooth; it++) {
    const Q = P.slice();
    for (let a = 0; a < n; a++) {
      if (boundary[a] || !nbr[a].size) continue;
      let x = 0, y = 0, z = 0; for (const b of nbr[a]) { x += P[b * 3]; y += P[b * 3 + 1]; z += P[b * 3 + 2]; }
      const s = nbr[a].size, t = 0.55; Q[a * 3] = P[a * 3] * (1 - t) + (x / s) * t; Q[a * 3 + 1] = P[a * 3 + 1] * (1 - t) + (y / s) * t; Q[a * 3 + 2] = P[a * 3 + 2] * (1 - t) + (z / s) * t;
    }
    P.set(Q);
  }
  for (let i = 0; i < pos.count; i++) { const w = id[i]; pos.setXYZ(i, P[w * 3], P[w * 3 + 1], P[w * 3 + 2]); }
  g.computeVertexNormals();
  // average normals across welded seams
  const N = new Float32Array(n * 3), nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) { const w = id[i]; N[w * 3] += nor.getX(i); N[w * 3 + 1] += nor.getY(i); N[w * 3 + 2] += nor.getZ(i); }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const w = id[i]; v.set(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]).normalize();
    const fade = Math.min(1, ring[w] / 2.5);
    let off = inflate * fade;
    let px = pos.getX(i) + v.x * off, py = pos.getY(i) + v.y * off, pz = pos.getZ(i) + v.z * off;
    if (bulge) { const b = bulge(pos.getX(i), pos.getY(i), pos.getZ(i), v).multiplyScalar(fade); px += b.x; py += b.y; pz += b.z; }
    pos.setXYZ(i, px, py, pz);
  }
  g.computeVertexNormals();
  for (let i = 0; i < pos.count; i++) { const w = id[i]; N[w * 3] = N[w * 3 + 1] = N[w * 3 + 2] = 0; }
  for (let i = 0; i < pos.count; i++) { const w = id[i]; N[w * 3] += nor.getX(i); N[w * 3 + 1] += nor.getY(i); N[w * 3 + 2] += nor.getZ(i); }
  for (let i = 0; i < pos.count; i++) { const w = id[i]; v.set(N[w * 3], N[w * 3 + 1], N[w * 3 + 2]).normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
// remap an accessory's skin indices onto the body's skeleton (bone order can differ between files)
function attachAccessory(acc, body, keepTri, material) {
  let src; acc.scene.traverse((o) => { if (o.isSkinnedMesh) src = o; });
  const g = subsetGeometry(src.geometry, keepTri ? (a, b, c) => keepTri(src.geometry, a, b, c) : () => true);
  const si = g.attributes.skinIndex, remap = src.skeleton.bones.map((b) => boneIndex(body.skeleton, b.name));
  for (let i = 0; i < si.count; i++) for (let c = 0; c < 4; c++) si.setComponent(i, c, Math.max(0, remap[si.getComponent(i, c)]));
  const m = new THREE.SkinnedMesh(g, material || src.material.clone());
  m.bind(body.skeleton, body.bindMatrix); m.castShadow = true; m.frustumCulled = false; body.parent.add(m); return m;
}

// ------------------------------------------------------------------ build one crew member
export function buildCharacter(kit, spec) {
  const root = SkeletonUtils.clone(kit.body.scene);
  let body, eyes, brows0;
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return; o.castShadow = true; o.frustumCulled = false;
    if (o.name === 'SuperHero_Male') body = o; else if (o.name === 'Eyes') eyes = o; else if (o.name === 'Eyebrows') brows0 = o;
  });
  body.geometry = body.geometry.clone();
  body.material = body.material.clone();
  if (spec.bodyTex) body.material.map = tex(spec.bodyTex);
  else if (spec.skinTone === 'light') body.material.map = kit.lightSkin;
  if (spec.skinTint) body.material.color.set(spec.skinTint);
  if (spec.skinBoost) body.material.color.multiplyScalar(spec.skinBoost);
  brows0.visible = false;
  const sk = body.skeleton, J = bindPositions(sk), geo = body.geometry, pos = geo.attributes.position;
  const set = (names) => new Set(names.map((n) => boneIndex(sk, n)).filter((i) => i >= 0));
  const SHIRT = set(['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r']);
  const PANTS = set(spec.shorts ? ['pelvis', 'thigh_l', 'thigh_r'] : ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r']);
  const SHOES = set(['foot_l', 'foot_r', 'ball_l', 'ball_r']);
  const NECK = set(['neck_01']);
  // where along each arm the sleeve ends (0 = shoulder, 1 = wrist)
  const sleeve = spec.sleeve ?? 0.45;
  const armT = (x, y, z) => {
    const side = x > 0 ? 'l' : 'r', a = J['upperarm_' + side], h = J['hand_' + side];
    const ah = new THREE.Vector3().subVectors(h, a), ap = new THREE.Vector3(x - a.x, y - a.y, z - a.z);
    return ap.dot(ah) / ah.lengthSq();
  };
  if (spec.roundFace) { // softer, rounder face: widen cheeks and jaw a little
    const HEAD = set(['Head']), hy = J.Head.y;
    for (let v = 0; v < pos.count; v++) {
      const w = weightOn(geo, v, HEAD); if (w < 0.2) continue;
      const y = pos.getY(v), f = Math.exp(-(((y - (hy + 0.04)) / 0.06) ** 2)) * w * spec.roundFace;
      pos.setX(v, pos.getX(v) * (1 + f)); pos.setZ(v, pos.getZ(v) + Math.max(0, pos.getZ(v)) * f * 0.3);
    }
    geo.computeVertexNormals();
  }
  const owner = new Int8Array(pos.count).fill(-1); // 0 shirt, 1 pants, 2 shoes
  for (let v = 0; v < pos.count; v++) {
    const ws = weightOn(geo, v, SHIRT), wp = weightOn(geo, v, PANTS), wf = weightOn(geo, v, SHOES), wn = weightOn(geo, v, NECK);
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    if (wf > 0.45) owner[v] = 2;
    else if (ws + wp > 0.45) {
      const onArm = Math.abs(x) > Math.abs(J.clavicle_l.x) + 0.04 && y > J.spine_02.y - 0.05;
      if (onArm) { if (armT(x, y, z) < sleeve) owner[v] = 0; }
      else owner[v] = y > J.pelvis.y + (spec.hem ?? 0.05) ? 0 : 1;
    } else if (wn > 0.3 && spec.collar && y < J.neck_01.y + 0.01) owner[v] = 0;
  }
  // a triangle whose corners are all clothed goes to the majority garment (shirt wins ties), so seams have no skin gaps
  const triOwner = (a, b, c) => {
    const o = [owner[a], owner[b], owner[c]]; if (o.some((k) => k < 0)) return -1;
    if (o[0] === o[1] || o[0] === o[2]) return o[0]; if (o[1] === o[2]) return o[1]; return Math.min(...o);
  };
  const inGarment = (k) => (a, b, c) => triOwner(a, b, c) === k;
  const hidden = (a, b, c) => triOwner(a, b, c) >= 0;
  const mats = {
    shirt: new THREE.MeshStandardMaterial({ map: fabricTexture(spec.shirtFabric || 'knit', spec.shirt), roughness: 0.92 }),
    pants: new THREE.MeshStandardMaterial({ map: fabricTexture(spec.pantsFabric || 'denim', spec.pants), roughness: 0.88 }),
    shoes: new THREE.MeshStandardMaterial({ map: fabricTexture('leather', spec.shoes, { repeat: 2 }), roughness: 0.6 }),
  };
  const belly = spec.belly || 0;
  const garments = [
    ['shirt', 0, { smooth: 4, inflate: 0.016, bulge: belly ? (x, y, z, n) => {
      const f = Math.exp(-(((y - (J.spine_01.y + 0.06)) / 0.14) ** 2)) * Math.exp(-((x / 0.17) ** 2));
      return new THREE.Vector3(n.x * 0.3, 0, Math.max(0, n.z) + 0.25).multiplyScalar(f * belly * (z > -0.02 ? 1 : 0.15));
    } : null }],
    ['pants', 1, { smooth: 3, inflate: 0.012 }],
    ['shoes', 2, { smooth: 2, inflate: 0.008 }],
  ];
  for (const [name, k, opts] of garments) {
    const g = shapeGarment(subsetGeometry(geo, inGarment(k)), opts);
    const m = new THREE.SkinnedMesh(g, mats[name]); m.bind(sk, body.bindMatrix); m.castShadow = true; m.frustumCulled = false; body.parent.add(m);
  }
  { // drop body triangles that are fully under clothing (stops skin poking through)
    const idx = geo.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (!hidden(idx[t], idx[t + 1], idx[t + 2])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep);
  }
  // hair, facial hair, eyebrows
  const hairMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const nrmY = (g, i) => g.attributes.normal.getY(i), py = (g, i) => g.attributes.position.getY(i), pz = (g, i) => g.attributes.position.getZ(i), px = (g, i) => g.attributes.position.getX(i);
  if (spec.hair === 'balding') attachAccessory(kit.hair.buzz, body, (g, a, b, c) => (nrmY(g, a) + nrmY(g, b) + nrmY(g, c)) / 3 < 0.32 && (py(g, a) + py(g, b) + py(g, c)) / 3 < 1.78, hairMat(spec.hairColor));
  else if (spec.hair === 'buzz' || spec.hair === 'parted') { // under a hat, keep only the hair below the hat line
    const hatted = spec.cap || spec.beanie, lim = spec.beanie ? 1.715 : 1.74;
    const keep = hatted ? (g, a, b, c) => (py(g, a) + py(g, b) + py(g, c)) / 3 < lim : null;
    attachAccessory(spec.hair === 'buzz' ? kit.hair.buzz : kit.hair.parted, body, keep, hairMat(spec.hairColor));
  }
  const isMustache = (g, i) => py(g, i) > 1.606 && py(g, i) < 1.64 && pz(g, i) > 0.07 && Math.abs(px(g, i)) < 0.047;
  if (spec.facialHair === 'mustache') attachAccessory(kit.hair.beard, body, (g, a, b, c) => isMustache(g, a) && isMustache(g, b) && isMustache(g, c), hairMat(spec.facialColor || spec.hairColor));
  else if (spec.facialHair === 'goatee') { const ok = (g, i) => isMustache(g, i) || (Math.abs(px(g, i)) < 0.03 && pz(g, i) > 0.05 && py(g, i) < 1.606); attachAccessory(kit.hair.beard, body, (g, a, b, c) => ok(g, a) && ok(g, b) && ok(g, c), hairMat(spec.facialColor || spec.hairColor)); }
  else if (spec.facialHair === 'beard') attachAccessory(kit.hair.beard, body, null, hairMat(spec.facialColor || spec.hairColor));
  attachAccessory(kit.hair.brows, body, null, hairMat(spec.browColor || spec.hairColor));
  // props on the head bone (caps etc.) and chest
  const head = sk.bones[boneIndex(sk, 'Head')];
  if (spec.collarGlasses) {
    const chest = sk.bones[boneIndex(sk, 'spine_03')], gl = new THREE.Group();
    const lens = new THREE.MeshStandardMaterial({ color: 0x2b2722, roughness: 0.2, metalness: 0.4 });
    for (const x of [-0.034, 0.034]) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.024, 18), lens); l.position.set(x, 0, 0); l.scale.y = 0.72; gl.add(l); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.004, 0.004), lens); gl.add(bridge);
    chest.add(gl); gl.userData.attach = true; spec._glasses = gl;
  }
  if (spec.cap || spec.beanie) {
    const hi = boneIndex(sk, 'Head'), grp = new THREE.Group();
    const cm = new THREE.MeshStandardMaterial({ map: fabricTexture(spec.capFabric || 'knit', spec.cap || spec.beanie, { repeat: 2 }), roughness: 0.85 });
    if (spec.beanie) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.104, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), cm); b.scale.set(1, 1.05, 1.12); b.position.set(0, 1.73, -0.012); grp.add(b);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 8, 28), cm); cuff.rotation.x = Math.PI / 2; cuff.scale.set(1, 1.12, 1); cuff.position.set(0, 1.725, -0.012); grp.add(cuff);
    } else {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.102, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), cm); crown.scale.set(1, 0.9, 1.1); crown.position.set(0, 1.738, -0.008); grp.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.012, 24, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: spec.brim ?? spec.cap, roughness: 0.8 }));
      brim.scale.set(1.05, 1, spec.flatBrim ? 1.25 : 1.1); brim.position.set(0, 1.742, 0.085); brim.rotation.x = spec.flatBrim ? 0 : 0.12; grp.add(brim);
      if (spec.patch) { const pt = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.034), new THREE.MeshStandardMaterial({ color: spec.patch, roughness: 0.7 })); pt.position.set(0, 1.79, 0.108); pt.rotation.x = -0.35; grp.add(pt); }
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    grp.applyMatrix4(sk.boneInverses[hi]); sk.bones[hi].add(grp);
  }
  // animation
  const mixer = new THREE.AnimationMixer(root), actions = {};
  const pelvis = sk.bones[boneIndex(sk, 'pelvis')], rest = pelvis.position.clone();
  for (const [name, clip0] of Object.entries(kit.clips)) {
    const clip = clip0.clone();
    for (const t of clip.tracks) if (t.name === 'pelvis.position') { // re-base hip height onto this body
      const ref = kit.clips.Idle_Loop.tracks.find((k) => k.name === 'pelvis.position').values;
      for (let i = 0; i < t.values.length; i += 3) { t.values[i] += rest.x - ref[0]; t.values[i + 1] += rest.y - ref[1]; t.values[i + 2] += rest.z - ref[2]; }
    }
    actions[name] = mixer.clipAction(clip);
  }
  let current = null;
  function play(name, fade = 0.25, { once = false, speed = 1 } = {}) {
    const a = actions[name]; if (!a || a === current) { if (a) a.timeScale = speed; return a; }
    a.reset(); a.timeScale = speed; a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = once;
    a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (current) current.crossFadeTo(a, fade, true);
    current = a; return a;
  }
  const wrap = new THREE.Group(); wrap.add(root); wrap.scale.setScalar(spec.scale || 1);
  return { root: wrap, mixer, actions, play, get current() { return current; }, head, skeleton: sk, spec };
}

// ------------------------------------------------------------------ crew looks (from the photos)
export const LOOKS = {
  hewitt: { bodyTex: 'T_Body_hewitt.jpg', skinBoost: 1.15, hair: 'parted', hairColor: 0x6b4a2b, browColor: 0x5a3e25,
    shirt: 0x6a5a44, shirtFabric: 'camo', pants: 0x3e3b33, pantsFabric: 'knit', shoes: 0x3a3028, sleeve: 0.95, collar: true, cap: 0x1c1c1c, patch: 0xb07a3a },
  kyle: { bodyTex: 'T_Body_kyle.jpg', skinBoost: 1.15, hair: 'parted', hairColor: 0x5a3c22, facialHair: 'mustache', facialColor: 0x6b4a2e, browColor: 0x4e3520,
    shirt: 0x8a8a7c, shirtFabric: 'camo', pants: 0x7d7c6e, pantsFabric: 'camo', shoes: 0x4a4038, sleeve: 0.95, collar: true, beanie: 0x7f857a, capFabric: 'camo' },
  l: { bodyTex: 'T_Body_l.jpg', skinBoost: 1.15, hair: 'buzz', hairColor: 0x2a1d14, browColor: 0x2a1d14,
    shirt: 0x2a2b30, pants: 0x8d8c7a, pantsFabric: 'camo', shoes: 0x9a9a92, sleeve: 0.95, collar: true, cap: 0x3a3029, brim: 0x2a221c, patch: 0xc08850, hem: 0.0 },
  dawg: { bodyTex: 'T_Body_dawg.jpg', skinBoost: 1.12, hair: 'buzz', hairColor: 0x2b1d14, facialHair: 'beard', facialColor: 0x2e1f15, browColor: 0x2b1d14,
    shirt: 0x4a4a4e, pants: 0x1e1e20, pantsFabric: 'knit', shoes: 0x2a2a2a, sleeve: 0.95, collar: true, shorts: true, cap: 0xe8e0cc, brim: 0x1e1e1e, belly: 0.03 },
  slime: { bodyTex: 'T_Body_slime.jpg', skinBoost: 1.1, hair: 'buzz', hairColor: 0x24170e, facialHair: 'goatee', facialColor: 0x24170e, browColor: 0x24170e,
    shirt: 0x7a2e2a, pants: 0x5f84b0, shoes: 0x4a3a2a, sleeve: 0.42, collar: true, cap: 0xa9abad, brim: 0x8e9092, flatBrim: true, patch: 0x3a3a3a },

  skin: {
    bodyTex: 'T_Body_skin.jpg', skinBoost: 1.28, roundFace: 0.09, hair: 'balding', hairColor: 0x9c938a, facialHair: 'mustache', facialColor: 0x8d8379, browColor: 0x9a9289,
    shirt: 0xe9e3d3, pants: 0x5f84b8, shoes: 0x5a4330, sleeve: 0.42, belly: 0.05, collar: true, scale: 0.97,
  },
};
