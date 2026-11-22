// Detailed procedural vehicles: a crew-cab pickup and Slime's 2nd-gen Nissan Xterra.
// Bodies are extruded from real side profiles (meters), with beveled edges, glass, lights, bumpers and wheels.
// Vehicle space: +z forward, +y up, +x = driver (left) side.
import * as THREE from 'three';

const mats = {};
function M(key, make) { return mats[key] || (mats[key] = make()); }
const paint = (c) => M('paint' + c, () => new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }));
const glass = () => M('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x2a3a46, metalness: 0.1, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.38, depthWrite: false }));
const tint = () => M('tint', () => new THREE.MeshPhysicalMaterial({ color: 0x0d1115, metalness: 0.2, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.72, depthWrite: false }));
const black = () => M('black', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 }));
const plastic = () => M('plastic', () => new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.55 }));
const chrome = () => M('chrome', () => new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 1, roughness: 0.15 }));
const rubber = () => M('rubber', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 }));
const headlight = () => M('head', () => new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff1c4, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 }));
const taillight = () => M('tail', () => new THREE.MeshStandardMaterial({ color: 0xb01010, emissive: 0x600000, emissiveIntensity: 0.6, roughness: 0.2 }));
const amber = () => M('amber', () => new THREE.MeshStandardMaterial({ color: 0xe08a1a, emissive: 0x502800, roughness: 0.2 }));

function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
function rbox(w, h, d, r = 0.03) { // box with softly beveled edges
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2); return g;
}
// side profile [[z,y],...] (front-bottom first, going over the top) with wheel arches cut into the bottom edge
function bodyFromProfile(top, { width, bottom, arches, bevel = 0.07 }) {
  const s = new THREE.Shape(), [zf] = top[0], zr = top[top.length - 1][0];
  s.moveTo(zr, bottom);
  const archList = [...arches].sort((a, b) => a.z - b.z);
  for (const a of archList) { s.lineTo(a.z - a.r, bottom); s.absarc(a.z, a.y, a.r, Math.PI, 0, true); }
  s.lineTo(zf, bottom);
  for (const [z, y] of top) s.lineTo(z, y);
  s.lineTo(zr, bottom);
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 14 });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); // shape x -> vehicle z, extrude axis -> vehicle x
  g.computeVertexNormals(); return g;
}
function sideGlass(poly, x, mat) { // flat window on the body side at |x|
  const s = new THREE.Shape(poly.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ShapeGeometry(s); g.rotateY(-Math.PI / 2);
  const out = new THREE.Group();
  const l = mesh(g, mat, x, 0, 0); out.add(l);
  const r = mesh(g.clone(), mat, -x, 0, 0); r.scale.x = -1; r.material = mat; out.add(r);
  out.traverse((o) => { if (o.isMesh) { o.material = mat; o.material.side = THREE.DoubleSide; } });
  return out;
}
function slopedGlass(z0, y0, z1, y1, width, mat) { // windshield/back glass between two profile points
  const len = Math.hypot(z1 - z0, y1 - y0), g = new THREE.PlaneGeometry(width, len);
  const m = mesh(g, mat, 0, (y0 + y1) / 2, (z0 + z1) / 2); m.rotation.x = -Math.atan2(y1 - y0, z1 - z0) - Math.PI / 2 + Math.PI;
  m.material = mat; mat.side = THREE.DoubleSide; return m;
}
function strut(a, b, mat, x, t = 0.07) { // pillar between two profile points (z,y) at side x
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), m = mesh(new THREE.BoxGeometry(t, len, t * 1.4), mat, x, (a[1] + b[1]) / 2, (a[0] + b[0]) / 2);
  m.rotation.x = Math.atan2(b[0] - a[0], b[1] - a[1]); return m;
}
function cabin(g, { W, belt, roofY, zFront, zRear, aBase, body, pillars = [], seatsZ = [], dashZ }) {
  g.add(mesh(rbox(W - 0.02, 0.07, zFront - zRear, 0.03), body, 0, roofY, (zFront + zRear) / 2));     // roof
  for (const sx of [1, -1]) {
    g.add(strut(aBase, [zFront, roofY], body, sx * (W / 2 - 0.05)));                                 // A pillar
    for (const z of pillars) g.add(strut([z, belt], [z, roofY], body, sx * (W / 2 - 0.05), 0.09));
    g.add(strut([zRear, belt], [zRear, roofY], body, sx * (W / 2 - 0.05), 0.12));
  }
  const seat = M('seat', () => new THREE.MeshStandardMaterial({ color: 0x3a342e, roughness: 0.9 }));
  for (const z of seatsZ) for (const x of [0.42, -0.42]) { g.add(mesh(rbox(0.5, 0.14, 0.5, 0.04), seat, x, belt - 0.32, z)); g.add(mesh(rbox(0.5, 0.62, 0.12, 0.04), seat, x, belt - 0.02, z - 0.3)); }
  g.add(mesh(rbox(W - 0.2, 0.22, 0.4, 0.05), M('dash', () => new THREE.MeshStandardMaterial({ color: 0x1e1c1a, roughness: 0.8 })), 0, belt + 0.02, dashZ));
  const sw = mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 16), black(), 0.42, belt + 0.12, dashZ - 0.28); sw.rotation.x = -0.4; g.add(sw);
}
function wheel(r, w, { rim = chrome(), steel = false } = {}) {
  const g = new THREE.Group();
  const pts = []; const tr = r, ir = r * 0.62, hw = w / 2;
  pts.push(new THREE.Vector2(ir, -hw * 0.92), new THREE.Vector2(tr * 0.93, -hw), new THREE.Vector2(tr, -hw * 0.55), new THREE.Vector2(tr, hw * 0.55), new THREE.Vector2(tr * 0.93, hw), new THREE.Vector2(ir, hw * 0.92));
  const tire = new THREE.LatheGeometry(pts, 28); tire.rotateZ(Math.PI / 2);
  g.add(mesh(tire, rubber()));
  // tread blocks
  const tread = new THREE.BoxGeometry(w * 0.86, 0.035, 0.07);
  for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2, b = mesh(tread, rubber(), 0, Math.cos(a) * tr, Math.sin(a) * tr); b.rotation.x = -a; b.scale.x = i % 2 ? 1 : 0.7; g.add(b); }
  const rimMat = steel ? M('steel', () => new THREE.MeshStandardMaterial({ color: 0x202020, metalness: 0.6, roughness: 0.45 })) : rim;
  const disc = new THREE.CylinderGeometry(ir, ir, w * 0.7, 24); disc.rotateZ(Math.PI / 2);
  g.add(mesh(disc, rimMat));
  const spokes = steel ? 8 : 6;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    if (steel) { const hole = mesh(new THREE.CylinderGeometry(ir * 0.12, ir * 0.12, w * 0.74, 10).rotateZ(Math.PI / 2), black(), 0, Math.cos(a) * ir * 0.62, Math.sin(a) * ir * 0.62); g.add(hole); }
    else { const sp = mesh(new THREE.BoxGeometry(w * 0.74, ir * 0.85, ir * 0.16), M('spoke', () => new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 1, roughness: 0.25 })), 0, 0, 0); sp.rotation.x = a; sp.position.set(0, Math.cos(a) * ir * 0.4, Math.sin(a) * ir * 0.4); g.add(sp); }
  }
  g.add(mesh(new THREE.CylinderGeometry(ir * 0.25, ir * 0.25, w * 0.78, 14).rotateZ(Math.PI / 2), steel ? black() : chrome()));
  return g;
}
function addWheels(root, list, r, w, opts) {
  const out = [];
  for (const [x, z, front] of list) {
    const pivot = new THREE.Group(); pivot.position.set(x, r, z); root.add(pivot);
    const wh = wheel(r, w, opts); wh.scale.x = x > 0 ? 1 : -1; pivot.add(wh);
    out.push({ pivot, spin: wh, front, base: r });
  }
  return out;
}

// ------------------------------------------------------------------ crew-cab pickup
export function buildPickup(color = 0x8c2a22) {
  const g = new THREE.Group(), W = 2.0, body = paint(color);
  const WB = 3.6, R = 0.44, front = WB / 2, rear = -WB / 2;
  const prof = [[2.95, 0.98], [2.9, 1.14], [2.75, 1.2], [1.35, 1.32], [-1.15, 1.32], [-1.15, 1.08], [-3.0, 1.08], [-3.05, 0.98]];
  g.add(mesh(bodyFromProfile(prof, { width: W, bottom: 0.52, arches: [{ z: front, y: R, r: 0.56 }, { z: rear, y: R, r: 0.56 }] }), body));
  // bed: liner floor, side rails, tailgate
  g.add(mesh(new THREE.BoxGeometry(W - 0.18, 0.05, 1.82), black(), 0, 1.09, -2.07));
  for (const x of [W / 2 - 0.06, -W / 2 + 0.06]) g.add(mesh(rbox(0.12, 0.42, 1.95, 0.03), body, x, 1.29, -2.07));
  g.add(mesh(rbox(W, 0.44, 0.1, 0.03), body, 0, 1.28, -3.0));
  g.add(mesh(rbox(W, 0.42, 0.08, 0.02), body, 0, 1.29, -1.15));
  for (const x of [W / 2 - 0.06, -W / 2 + 0.06]) g.add(mesh(new THREE.BoxGeometry(0.13, 0.03, 1.95), plastic(), x, 1.51, -2.07)); // rail caps
  cabin(g, { W, belt: 1.32, roofY: 1.95, zFront: 0.55, zRear: -1.13, aBase: [1.35, 1.32], body, pillars: [-0.08], seatsZ: [0.05, -0.68], dashZ: 0.95 });
  // glass
  g.add(slopedGlass(1.33, 1.34, 0.58, 1.92, W - 0.22, glass()));
  g.add(slopedGlass(-1.13, 1.32, -1.11, 1.9, W - 0.26, glass()));
  g.add(sideGlass([[0.5, 1.34], [-0.05, 1.34], [-0.05, 1.88], [0.48, 1.88], [0.98, 1.38]], W / 2 + 0.005, glass()));
  g.add(sideGlass([[-0.12, 1.34], [-1.0, 1.34], [-1.0, 1.88], [-0.12, 1.88]], W / 2 + 0.005, glass()));
  // pillars + door seams + handles
  for (const z of [-0.085, 0.95]) g.add(mesh(new THREE.BoxGeometry(W + 0.02, 0.012, 0.012), black(), 0, 0.85, z));
  for (const [z] of [[0.15], [-0.65]]) for (const x of [W / 2 + 0.01, -W / 2 - 0.01]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.18), chrome(), x, 1.24, z));
  // front: grille, lights, bumper
  g.add(mesh(rbox(1.46, 0.42, 0.08, 0.03), chrome(), 0, 0.98, 2.98));
  g.add(mesh(new THREE.BoxGeometry(1.3, 0.32, 0.06), black(), 0, 0.98, 3.0));
  for (let i = 0; i < 4; i++) g.add(mesh(new THREE.BoxGeometry(1.3, 0.02, 0.02), chrome(), 0, 0.86 + i * 0.08, 3.03));
  for (const x of [0.78, -0.78]) { g.add(mesh(rbox(0.32, 0.2, 0.06, 0.02), headlight(), x, 1.06, 2.97)); g.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.04), amber(), x * 1.13, 0.9, 2.97)); }
  g.add(mesh(rbox(2.04, 0.24, 0.24, 0.05), chrome(), 0, 0.66, 3.0));
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.06, 0.1), black(), 0, 0.56, 3.05));
  // rear: taillights, bumper, hitch
  for (const x of [W / 2 - 0.08, -W / 2 + 0.08]) g.add(mesh(rbox(0.12, 0.42, 0.05, 0.02), taillight(), x, 1.25, -3.06));
  g.add(mesh(rbox(2.04, 0.22, 0.22, 0.05), chrome(), 0, 0.66, -3.12));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.25), black(), 0, 0.56, -3.28));
  // mirrors, running boards, flares
  for (const s of [1, -1]) {
    g.add(mesh(rbox(0.1, 0.2, 0.28, 0.03), black(), s * (W / 2 + 0.14), 1.45, 0.55));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.05, 0.06), black(), s * (W / 2 + 0.07), 1.42, 0.62));
    g.add(mesh(rbox(0.16, 0.06, 1.95, 0.02), black(), s * (W / 2 + 0.06), 0.55, -0.27));
  }
  const wheels = addWheels(g, [[0.88, front, true], [-0.88, front, true], [0.88, rear, false], [-0.88, rear, false]], R, 0.3);
  const seats = [
    { x: 0.42, y: 0.5, z: 0.1, pose: 'Driving_Loop', driver: true }, { x: -0.42, y: 0.5, z: 0.1, pose: 'Sitting_Idle_Loop' },
    { x: 0.42, y: 0.5, z: -0.62, pose: 'Sitting_Idle_Loop' }, { x: -0.42, y: 0.5, z: -0.62, pose: 'Sitting_Idle_Loop' },
    { x: 0.55, y: 0.72, z: -2.1, pose: 'Sitting_Idle_Loop', bed: true, face: -Math.PI / 2 }, { x: -0.55, y: 0.72, z: -2.1, pose: 'Sitting_Idle_Loop', bed: true, face: Math.PI / 2 },
  ];
  return { group: g, wheels, seats, wb: WB, half: 0.95, wheelR: R };
}

// ------------------------------------------------------------------ Slime's 2nd-gen Xterra (white, rack, jerry can, swing-out spare)
export function buildXterra() {
  const g = new THREE.Group(), W = 1.86, body = paint(0xf0f0ec);
  const WB = 2.7, R = 0.42, front = 1.38, rear = front - WB;
  const prof = [[2.27, 0.95], [2.22, 1.14], [2.05, 1.2], [1.12, 1.29], [-2.27, 1.29], [-2.3, 0.95]];
  g.add(mesh(bodyFromProfile(prof, { width: W, bottom: 0.55, arches: [{ z: front, y: R, r: 0.55 }, { z: rear, y: R, r: 0.55 }] }), body));
  // black lower cladding + fender flares
  g.add(mesh(rbox(W + 0.03, 0.2, 4.5, 0.04), plastic(), 0, 0.64, 0));
  for (const z of [front, rear]) for (const s of [1, -1]) { const f = mesh(new THREE.TorusGeometry(0.58, 0.05, 6, 16, Math.PI), plastic(), s * (W / 2 + 0.02), R, z); f.rotation.y = Math.PI / 2; g.add(f); }
  cabin(g, { W, belt: 1.29, roofY: 1.86, zFront: 0.45, zRear: -2.24, aBase: [1.12, 1.29], body, pillars: [-0.4, -1.32], seatsZ: [-0.05, -0.95], dashZ: 0.75 });
  // glass
  g.add(slopedGlass(1.13, 1.29, 0.45, 1.78, W - 0.2, glass()));
  g.add(sideGlass([[0.36, 1.3], [-0.35, 1.3], [-0.35, 1.76], [0.36, 1.76], [0.86, 1.33]], W / 2 + 0.005, glass()));
  g.add(sideGlass([[-0.45, 1.3], [-1.25, 1.3], [-1.25, 1.78], [-0.45, 1.78]], W / 2 + 0.005, tint()));
  g.add(sideGlass([[-1.38, 1.36], [-2.1, 1.36], [-2.1, 1.82], [-1.6, 1.86], [-1.38, 1.86]], W / 2 + 0.005, tint()));
  g.add(mesh(new THREE.BoxGeometry(W - 0.3, 0.45, 0.02), tint(), 0, 1.6, -2.31));
  // signature rear-door bump + roof rack with basket
  g.add(mesh(rbox(W - 0.2, 0.12, 1.1, 0.05), body, 0, 1.98, -1.55));
  for (const x of [0.72, -0.72]) g.add(mesh(rbox(0.06, 0.06, 2.6, 0.02), black(), x, 2.03, -0.85));
  for (const z of [0.25, -0.5, -1.25, -2.0]) g.add(mesh(new THREE.BoxGeometry(1.5, 0.04, 0.05), black(), 0, 2.07, z));
  const basket = new THREE.Group(); basket.position.set(0, 2.14, -0.55); g.add(basket);
  for (const x of [0.68, -0.68]) basket.add(mesh(new THREE.BoxGeometry(0.03, 0.03, 1.5), black(), x, 0.06, 0));
  for (const z of [0.75, -0.75]) basket.add(mesh(new THREE.BoxGeometry(1.36, 0.03, 0.03), black(), 0, 0.06, z));
  basket.add(mesh(rbox(1.1, 0.24, 0.42, 0.04), black(), 0, 0.12, 0.2));   // cargo box
  basket.add(mesh(rbox(0.36, 0.32, 0.18, 0.03), M('jerry', () => new THREE.MeshStandardMaterial({ color: 0xc8261d, roughness: 0.5 })), 0.42, 0.16, -0.5)); // red jerry can
  basket.add(mesh(rbox(0.36, 0.32, 0.18, 0.03), M('wcan', () => new THREE.MeshStandardMaterial({ color: 0xe0e0d8, roughness: 0.5 })), 0.0, 0.16, -0.5));
  // front: grille, lights, bumper, skid plate
  g.add(mesh(rbox(1.2, 0.3, 0.06, 0.03), black(), 0, 1.03, 2.29));
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(1.1, 0.025, 0.02), M('grey', () => new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.4 })), 0, 0.95 + i * 0.08, 2.32));
  for (const x of [0.72, -0.72]) g.add(mesh(rbox(0.28, 0.22, 0.06, 0.03), headlight(), x, 1.07, 2.27));
  g.add(mesh(rbox(1.95, 0.26, 0.26, 0.05), black(), 0, 0.72, 2.32));
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.04, 0.5), M('grey'), 0, 0.5, 2.1));
  // rear: aftermarket bumper w/ lights, swing-out spare, taillights, hitch, antenna
  g.add(mesh(rbox(1.98, 0.28, 0.3, 0.04), black(), 0, 0.72, -2.42));
  for (const x of [0.7, 0.45]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.06, 0.03), amber(), x, 0.72, -2.58));
  for (const x of [W / 2 - 0.07, -W / 2 + 0.07]) g.add(mesh(rbox(0.1, 0.5, 0.05, 0.02), taillight(), x, 1.45, -2.32));
  const arm = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), black(), -0.2, 1.05, -2.62); g.add(arm);
  const spare = wheel(0.42, 0.28, { steel: true }); spare.rotation.y = Math.PI / 2; spare.position.set(-0.45, 1.25, -2.72); g.add(spare);
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.08, 0.22), black(), 0, 0.58, -2.62));
  g.add(mesh(new THREE.CylinderGeometry(0.006, 0.01, 1.2, 5), black(), 0.82, 2.5, -1.7));
  // mirrors, handles, rock sliders
  for (const s of [1, -1]) {
    g.add(mesh(rbox(0.1, 0.18, 0.24, 0.03), black(), s * (W / 2 + 0.13), 1.4, 0.38));
    for (const z of [0.0, -0.85]) g.add(mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), black(), s * (W / 2 + 0.01), 1.2, z));
    g.add(mesh(rbox(0.1, 0.08, 1.4, 0.02), black(), s * (W / 2 + 0.03), 0.55, -0.32));
  }
  const wheels = addWheels(g, [[0.84, front, true], [-0.84, front, true], [0.84, rear, false], [-0.84, rear, false]], R, 0.32, { steel: true });
  const seats = [
    { x: 0.4, y: 0.52, z: -0.05, pose: 'Driving_Loop', driver: true }, { x: -0.4, y: 0.52, z: -0.05, pose: 'Sitting_Idle_Loop' },
    { x: 0.4, y: 0.52, z: -0.95, pose: 'Sitting_Idle_Loop' }, { x: -0.4, y: 0.52, z: -0.95, pose: 'Sitting_Idle_Loop' },
  ];
  return { group: g, wheels, seats, wb: WB, half: 0.92, wheelR: R };
}
