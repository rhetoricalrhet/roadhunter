// Procedural mule deer and elk with jointed legs and a real gait (walk, trot, gallop/stot), head-down grazing and ear flicks.
// Animal space: +z forward, feet on y=0.
import * as THREE from 'three';

const std = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
function m(geo, mat, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; return o; }
function taper(r0, r1, len, seg = 8) { const g = new THREE.CylinderGeometry(r1, r0, len, seg); g.translate(0, -len / 2, 0); return g; } // hangs down from origin
function tube(points, r0, r1, seg = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, seg, 1, 6, false), pos = g.attributes.position, nrm = g.attributes.normal;
  // taper radius along the tube
  for (let i = 0; i < pos.count; i++) {
    const t = Math.floor(i / 7) / seg, r = r0 + (r1 - r0) * t, p = curve.getPointAt(Math.min(1, t));
    pos.setXYZ(i, p.x + nrm.getX(i) * r, p.y + nrm.getY(i) * r, p.z + nrm.getZ(i) * r);
  }
  g.computeVertexNormals(); return g;
}

export function buildAnimal(kind, male) {
  const elk = kind === 'elk', s = elk ? 1.42 : 1;
  const coat = std(elk ? 0x9a7652 : 0x8f8274), dark = std(elk ? 0x4a3020 : 0x6a5e52), pale = std(elk ? 0xdcc79a : 0xebe6dc), black = std(0x1a1614, 0.5), ant = std(0xcdb995, 0.6);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); body.position.y = 1.0 * s;
  // torso: chest + belly + haunch
  const torso = m(new THREE.CapsuleGeometry(0.26 * s, 0.75 * s, 6, 12), coat); torso.rotation.x = Math.PI / 2; torso.scale.set(1, 1, 1.12); body.add(torso);
  const chest = m(new THREE.SphereGeometry(0.3 * s, 14, 10), elk ? dark : coat, 0, 0.03 * s, 0.38 * s); chest.scale.set(0.95, 1.1, 1); body.add(chest);
  const haunch = m(new THREE.SphereGeometry(0.29 * s, 14, 10), coat, 0, 0.04 * s, -0.4 * s); haunch.scale.set(1, 1.08, 1); body.add(haunch);
  body.add(m(new THREE.SphereGeometry(0.2 * s, 12, 8), pale, 0, 0.08 * s, -0.6 * s)); // rump patch
  const tail = m(new THREE.CapsuleGeometry(0.04 * s, (elk ? 0.06 : 0.14) * s, 4, 6), pale, 0, 0.14 * s, -0.68 * s); tail.rotation.x = -0.5; body.add(tail);
  if (!elk) tail.add(m(new THREE.SphereGeometry(0.035, 8, 6), black, 0, -0.1, 0)); // mule deer black-tipped tail
  // neck + head
  const neck = new THREE.Group(); neck.position.set(0, 0.12 * s, 0.5 * s); body.add(neck);
  const neckMesh = m(new THREE.CylinderGeometry(0.1 * s, (elk ? 0.2 : 0.15) * s, 0.62 * s, 10), elk ? dark : coat, 0, 0.26 * s, 0.1 * s); neckMesh.rotation.x = 0.55; neck.add(neckMesh);
  if (elk) { const mane = m(new THREE.CylinderGeometry(0.15 * s, 0.22 * s, 0.5 * s, 10), dark, 0, 0.18 * s, 0.06 * s); mane.rotation.x = 0.55; neck.add(mane); }
  const head = new THREE.Group(); head.position.set(0, 0.55 * s, 0.28 * s); neck.add(head);
  const skull = m(new THREE.SphereGeometry(0.12 * s, 12, 10), elk ? dark : coat); skull.scale.set(0.9, 0.95, 1.1); head.add(skull);
  const snout = m(new THREE.CylinderGeometry(0.055 * s, 0.1 * s, 0.26 * s, 10), elk ? dark : coat, 0, -0.05 * s, 0.17 * s); snout.rotation.x = Math.PI / 2 + 0.35; head.add(snout);
  head.add(m(new THREE.SphereGeometry(0.05 * s, 8, 6), black, 0, -0.1 * s, 0.29 * s)); // nose
  if (!elk) head.add(m(new THREE.SphereGeometry(0.07 * s, 8, 6), pale, 0, -0.1 * s, 0.22 * s)); // white muzzle
  for (const x of [0.075, -0.075]) head.add(m(new THREE.SphereGeometry(0.018 * s, 6, 5), black, x * s, 0.03 * s, 0.09 * s));
  const ears = [];
  for (const sd of [1, -1]) { // mule deer: huge ears
    const ear = new THREE.Group(); ear.position.set(sd * 0.08 * s, 0.07 * s, -0.04 * s); ear.rotation.z = sd * -1.0; ear.rotation.x = -0.2; head.add(ear);
    const e = m(new THREE.ConeGeometry((elk ? 0.045 : 0.075) * s, (elk ? 0.16 : 0.24) * s, 8), coat, 0, (elk ? 0.08 : 0.12) * s, 0); e.scale.z = 0.4; ear.add(e); ears.push(ear);
  }
  let points = 0;
  if (male) {
    points = elk ? 5 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 4);
    for (const sd of [1, -1]) {
      const a = new THREE.Group(); a.position.set(sd * 0.06 * s, 0.1 * s, -0.02 * s); head.add(a);
      if (elk) { // long main beam sweeping back, tines forward
        const beam = [[0, 0, 0], [sd * 0.15, 0.25, -0.1], [sd * 0.3, 0.6, -0.3], [sd * 0.35, 0.95, -0.55], [sd * 0.3, 1.2, -0.75]].map(([x, y, z]) => [x * s * 0.68, y * s * 0.68, z * s * 0.68]);
        a.add(m(tube(beam, 0.032 * s, 0.014 * s, 12), ant));
        for (let k = 0; k < points - 1; k++) {
          const t = (k + 0.6) / points, p = new THREE.CatmullRomCurve3(beam.map((q) => new THREE.Vector3(...q))).getPointAt(t);
          a.add(m(tube([[p.x, p.y, p.z], [p.x + sd * 0.02 * s, p.y + 0.08 * s, p.z + 0.15 * s], [p.x + sd * 0.03 * s, p.y + 0.19 * s, p.z + 0.22 * s]], 0.016 * s, 0.006 * s, 6), ant));
        }
      } else { // mule deer: forked (bifurcated) antlers
        const beam = [[0, 0, 0], [sd * 0.12, 0.12, 0.02], [sd * 0.24, 0.26, 0.06], [sd * 0.3, 0.38, 0.04]];
        a.add(m(tube(beam, 0.022, 0.012, 8), ant));
        const forks = Math.max(1, points - 1);
        for (let k = 0; k < forks; k++) {
          const b = beam[Math.min(beam.length - 1, 1 + k)], up = 0.14 + (k % 2) * 0.06;
          a.add(m(tube([b, [b[0] + sd * 0.02, b[1] + up * 0.6, b[2] + 0.04 * (k % 2 ? -1 : 1)], [b[0] + sd * 0.03, b[1] + up, b[2] + 0.02]], 0.014, 0.006, 5), ant));
        }
        a.add(m(tube([[0.01 * sd, 0.03, 0.01], [0.02 * sd, 0.09, 0.05]], 0.012, 0.005, 3), ant)); // brow tine
      }
    }
  }
  // legs: hip -> thigh -> knee -> shin -> hoof
  const legs = [], legLen = 0.5 * s;
  for (const [x, z, front] of [[0.12, 0.38, true], [-0.12, 0.38, true], [0.12, -0.42, false], [-0.12, -0.42, false]]) {
    const hip = new THREE.Group(); hip.position.set(x * s, -0.12 * s, z * s); body.add(hip);
    hip.add(m(taper(front ? 0.075 * s : 0.1 * s, 0.045 * s, legLen), elk ? dark : coat));
    const knee = new THREE.Group(); knee.position.y = -legLen; hip.add(knee);
    knee.add(m(taper(0.035 * s, 0.025 * s, legLen * 0.86), dark));
    knee.add(m(new THREE.CylinderGeometry(0.028 * s, 0.035 * s, 0.06 * s, 8), black, 0, -legLen * 0.86 - 0.02 * s, 0.01 * s));
    legs.push({ hip, knee, front, side: x > 0 ? 1 : -1 });
  }
  root.userData = { body, neck, head, ears, legs, tail, phase: Math.random() * 10, s, elk, earT: Math.random() * 3 };
  return { mesh: root, points };
}

// state: 'graze' | 'walk' | 'alert' | 'flee' | 'down'
export function animateAnimal(root, speed, state, dt) {
  const u = root.userData, s = u.s;
  const gallop = speed > 6, trot = speed > 2.5 && !gallop;
  u.phase += dt * (gallop ? 9 : trot ? 6 : 3.4) * (speed > 0.05 ? 1 : 0);
  const p = u.phase;
  u.legs.forEach((l, i) => {
    let off; // gait phase offsets
    if (gallop) off = l.front ? (l.side > 0 ? 0 : 0.15) : (l.side > 0 ? 0.5 : 0.65);
    else if (trot) off = (i === 0 || i === 3) ? 0 : 0.5;
    else off = [0, 0.5, 0.75, 0.25][i];
    const ph = (p / (Math.PI * 2) + off) * Math.PI * 2, amp = speed > 0.05 ? (gallop ? 0.75 : trot ? 0.5 : 0.32) : 0;
    const swing = Math.sin(ph) * amp, lift = Math.max(0, Math.cos(ph)) * amp;
    l.hip.rotation.x = THREE.MathUtils.lerp(l.hip.rotation.x, swing * (l.front ? 1 : -1) * 0.9, 0.5);
    l.knee.rotation.x = THREE.MathUtils.lerp(l.knee.rotation.x, (l.front ? -1 : 1) * lift * 1.1, 0.5);
  });
  const bob = speed > 0.05 ? Math.abs(Math.sin(p)) * (gallop ? 0.1 : 0.03) * s : 0;
  u.body.position.y = 1.0 * s + bob;
  u.body.rotation.x = gallop ? Math.sin(p) * 0.08 : 0;
  // head: graze down, alert up and still
  const neckTarget = state === 'graze' ? 1.15 : state === 'alert' ? -0.35 : gallop ? 0.15 : 0.05;
  u.neck.rotation.x = THREE.MathUtils.lerp(u.neck.rotation.x, neckTarget, dt * 3);
  u.head.rotation.x = THREE.MathUtils.lerp(u.head.rotation.x, state === 'graze' ? 0.4 : 0, dt * 3);
  // ear flicks + tail
  u.earT -= dt; if (u.earT < 0) { u.earT = 1 + Math.random() * 4; u.ears[Math.random() < 0.5 ? 0 : 1].rotation.x = -0.6; }
  for (const e of u.ears) e.rotation.x = THREE.MathUtils.lerp(e.rotation.x, state === 'alert' ? 0.2 : -0.2, dt * 4);
  u.tail.rotation.x = state === 'flee' ? -1.4 : THREE.MathUtils.lerp(u.tail.rotation.x, -0.5, dt * 2);
}
