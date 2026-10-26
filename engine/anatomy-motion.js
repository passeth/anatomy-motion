/*!
 * anatomy-motion v0.1.0 — glass-body 3D anatomy for HyperFrames videos
 * MIT License — https://github.com/passeth/anatomy-motion
 *
 * Load after three.js (UMD, r158) and GSAP, then mount a stage from a scene script:
 *   AnatomyMotion.mount({ id: "stage", story })
 * Everything visible is a pure function of scene time t (seconds), so any frame renders on its own.
 * Units are centimetres. Body space: y up, the person faces +z, +x is the person's LEFT.
 */
(function (global) {
  "use strict";
  const T = global.THREE;
  if (!T) { console.error("anatomy-motion: load three.js before this file"); return; }

  // ------------------------------------------------------------------ utils
  const D2R = Math.PI / 180;
  const V = (x, y, z) => new T.Vector3(x || 0, y || 0, z || 0);
  const lerp = (a, b, u) => a + (b - a) * u;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const sstep = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  const r1 = (v) => Math.round(v * 10) / 10;
  const EZ = {};
  const ez = (n) => EZ[n] || (EZ[n] = global.gsap ? global.gsap.parseEase(n) : (u) => u);
  /** keys: number | [[time, value, easeIntoThisKey?], ...] */
  function track(t, keys, def) {
    if (keys === undefined || keys === null) return def === undefined ? 0 : def;
    if (typeof keys === "number") return keys;
    if (!keys.length) return def === undefined ? 0 : def;
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      if (t < k[0]) {
        const p = keys[i - 1];
        const u = (t - p[0]) / (k[0] - p[0]);
        return p[1] + (k[1] - p[1]) * ez(k[2] || "power2.inOut")(u);
      }
    }
    return keys[keys.length - 1][1];
  }
  function mulberry32(a) {
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const SIDE = { L: 0, R: 1 }; // L = person's left (+x), R = person's right (-x)
  // cervical disc index k sits on chain joint k+1: 0 = C6-C7 ... 4 = C2-C3
  const DISC_LEVEL = { "C6-C7": 0, "C5-C6": 1, "C4-C5": 2, "C3-C4": 3, "C2-C3": 4 };
  const discIndex = (l) => (typeof l === "string" ? DISC_LEVEL[l] : l);
  const SGN = [1, -1];

  // ------------------------------------------------------------------ SDF primitives (JS)
  function sdE(p, c, r) {
    const x = (p.x - c[0]) / r[0], y = (p.y - c[1]) / r[1], z = (p.z - c[2]) / r[2];
    const k0 = Math.sqrt(x * x + y * y + z * z);
    const x1 = x / r[0], y1 = y / r[1], z1 = z / r[2];
    const k1 = Math.sqrt(x1 * x1 + y1 * y1 + z1 * z1) || 1e-6;
    return (k0 * (k0 - 1)) / k1;
  }
  function sdCone(p, a, b, ra, rb) {
    const pax = p.x - a.x, pay = p.y - a.y, paz = p.z - a.z;
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1e-6));
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - lerp(ra, rb, h);
  }
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  function sdBox(p, c, h) {
    const qx = Math.abs(p.x - c[0]) - h[0], qy = Math.abs(p.y - c[1]) - h[1], qz = Math.abs(p.z - c[2]) - h[2];
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  }
  function chainSDF(p, pts, radii, k) {
    let d = 1e9;
    for (let i = 0; i < pts.length - 1; i++) d = smin(d, sdCone(p, pts[i], pts[i + 1], radii[i], radii[i + 1]), k);
    return d;
  }

  // ------------------------------------------------------------------ surface nets (static meshes from an SDF, built once)
  function surfaceNets(f, b0, b1, h) {
    const nx = Math.floor((b1[0] - b0[0]) / h) + 2, ny = Math.floor((b1[1] - b0[1]) / h) + 2, nz = Math.floor((b1[2] - b0[2]) / h) + 2;
    const id = (i, j, k) => i + nx * (j + ny * k);
    const val = new Float32Array(nx * ny * nz);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[id(i, j, k)] = f(b0[0] + i * h, b0[1] + j * h, b0[2] + k * h);
    const cellV = new Int32Array(nx * ny * nz).fill(-1);
    const pos = [];
    const CN = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { cv[c] = val[id(i + CN[c][0], j + CN[c][1], k + CN[c][2])]; if (cv[c] < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const e of ED) {
        const a = cv[e[0]], b = cv[e[1]];
        if ((a < 0) !== (b < 0)) {
          const t = a / (a - b), pa = CN[e[0]], pb = CN[e[1]];
          sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
        }
      }
      cellV[id(i, j, k)] = pos.length / 3;
      pos.push(b0[0] + (i + sx / n) * h, b0[1] + (j + sy / n) * h, b0[2] + (k + sz / n) * h);
    }
    const idx = [];
    const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; idx.push(a, b, c, a, c, d); };
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const v0 = val[id(i, j, k)] < 0;
      if (j > 0 && k > 0 && v0 !== val[id(i + 1, j, k)] < 0) quad(cellV[id(i, j - 1, k - 1)], cellV[id(i, j, k - 1)], cellV[id(i, j, k)], cellV[id(i, j - 1, k)]);
      if (i > 0 && k > 0 && v0 !== val[id(i, j + 1, k)] < 0) quad(cellV[id(i - 1, j, k - 1)], cellV[id(i, j, k - 1)], cellV[id(i, j, k)], cellV[id(i - 1, j, k)]);
      if (i > 0 && j > 0 && v0 !== val[id(i, j, k + 1)] < 0) quad(cellV[id(i - 1, j - 1, k)], cellV[id(i, j - 1, k)], cellV[id(i, j, k)], cellV[id(i - 1, j, k)]);
    }
    return { pos: new Float32Array(pos), idx };
  }
  /** Mesh an SDF once. colorFn(x,y,z) -> [r,g,b] (linear) optional. Normals come from the SDF gradient and every
   *  triangle is turned to face along it (surface nets emits mixed winding). */
  function meshSDF(f, b0, b1, h, colorFn) {
    const net = surfaceNets(f, b0, b1, h);
    const n = net.pos.length / 3;
    const nor = new Float32Array(n * 3);
    const col = colorFn ? new Float32Array(n * 3) : null;
    const e = Math.max(0.02, h * 0.25);
    for (let v = 0; v < n; v++) {
      const x = net.pos[v * 3], y = net.pos[v * 3 + 1], z = net.pos[v * 3 + 2];
      const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      nor[v * 3] = gx / gl; nor[v * 3 + 1] = gy / gl; nor[v * 3 + 2] = gz / gl;
      if (col) { const c = colorFn(x, y, z); col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; }
    }
    const P3 = net.pos, ix = net.idx;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c2 = ix[t + 2] * 3;
      const ux = P3[b] - P3[a], uy = P3[b + 1] - P3[a + 1], uz = P3[b + 2] - P3[a + 2];
      const vx = P3[c2] - P3[a], vy = P3[c2 + 1] - P3[a + 1], vz = P3[c2 + 2] - P3[a + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const nx = nor[a] + nor[b] + nor[c2], ny = nor[a + 1] + nor[b + 1] + nor[c2 + 1], nz = nor[a + 2] + nor[b + 2] + nor[c2 + 2];
      if (cx * nx + cy * ny + cz * nz < 0) { const tmp = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = tmp; }
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(net.pos, 3));
    g.setAttribute("normal", new T.BufferAttribute(nor, 3));
    if (col) g.setAttribute("color", new T.BufferAttribute(col, 3));
    g.setIndex(net.idx);
    return g;
  }

  // ------------------------------------------------------------------ tubes
  class Tube {
    constructor(parent, n, radial, radius, mat) {
      this.n = n; this.m = radial; this.radius = radius;
      this.pos = new Float32Array(n * radial * 3);
      const idx = [];
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
        const a = i * radial + j, b = i * radial + ((j + 1) % radial), c = (i + 1) * radial + j, d = (i + 1) * radial + ((j + 1) % radial);
        idx.push(a, c, b, b, c, d);
      }
      const uv = new Float32Array(n * radial * 2);
      for (let i = 0; i < n; i++) for (let j = 0; j < radial; j++) { uv[(i * radial + j) * 2] = i / (n - 1); uv[(i * radial + j) * 2 + 1] = (j / radial) * 0.35; }
      this.geo = new T.BufferGeometry();
      this.geo.setAttribute("position", new T.BufferAttribute(this.pos, 3));
      this.geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
      this.geo.setIndex(idx);
      this.mesh = new T.Mesh(this.geo, mat);
      this.mesh.frustumCulled = false;
      parent.add(this.mesh);
    }
    update(ctrl, radiusFn) {
      const pts = ctrl.length === this.n ? ctrl : new T.CatmullRomCurve3(ctrl).getPoints(this.n - 1);
      let N = null;
      for (let i = 0; i < this.n; i++) {
        const tg = pts[Math.min(this.n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)]).normalize();
        if (!N) N = Math.abs(tg.y) < 0.9 ? V(0, 1, 0).cross(tg).normalize() : V(1, 0, 0).cross(tg).normalize();
        else N.sub(tg.clone().multiplyScalar(N.dot(tg))).normalize();
        const B = tg.clone().cross(N);
        const r = radiusFn ? radiusFn(i / (this.n - 1)) : this.radius;
        for (let j = 0; j < this.m; j++) {
          const a = (j / this.m) * Math.PI * 2;
          const k = (i * this.m + j) * 3;
          this.pos[k] = pts[i].x + N.x * Math.cos(a) * r + B.x * Math.sin(a) * r;
          this.pos[k + 1] = pts[i].y + N.y * Math.cos(a) * r + B.y * Math.sin(a) * r;
          this.pos[k + 2] = pts[i].z + N.z * Math.cos(a) * r + B.z * Math.sin(a) * r;
        }
      }
      this.geo.attributes.position.needsUpdate = true;
      this.geo.computeVertexNormals();
      return this;
    }
    drawFraction(u) { this.geo.setDrawRange(0, Math.floor(clamp01(u) * (this.n - 1)) * this.m * 6); }
  }

  // ------------------------------------------------------------------ body model (pose -> landmarks)
  const CB = [22, 19, 16, 13, 10, 6, 2];              // resting cervical curve, degrees from vertical per segment
  const CW = [0.45, 0.65, 0.8, 0.9, 0.95, 0.98, 1.0]; // how flexion is shared down the neck
  const YW = [0, 0, 0.06, 0.14, 0.27, 0.46, 0.72, 1.0]; // how axial turn is shared: mostly C1-C2
  const CONDYLE = V(0, 2.4, 0.7);                     // jaw hinge axis (head space)
  const JAW_MAX = 28;                                 // degrees at jawOpen = 1
  function chain(tilt, retract, turn) {
    const pts = [{ p: V(0, 47.2, -3.6), a: CB[0] * D2R }];
    for (let k = 0; k < 7; k++) {
      const a = (CB[k] + tilt * CW[k]) * D2R;
      const dr = retract * 2.6 * (CW[k] - (k ? CW[k - 1] : 0));
      pts.push({ p: pts[k].p.clone().add(V(0, 1.75 * Math.cos(a), 1.75 * Math.sin(a) - dr)), a });
    }
    pts[0].a = pts[1].a;
    for (let i = 0; i < 8; i++) {
      const a = i === 0 ? pts[1].a : i === 7 ? pts[7].a : (pts[i].a + pts[i + 1].a) / 2;
      pts[i].f = V(0, -Math.sin(a), Math.cos(a));
      pts[i].l = V(1, 0, 0);
    }
    if (turn) {
      // turn the neck about the vertical axis through C7
      const base = pts[0].p.clone();
      for (let i = 0; i < 8; i++) {
        const m = new T.Matrix4().makeRotationY(turn * YW[i] * D2R);
        pts[i].p = pts[i].p.clone().sub(base).applyMatrix4(m).add(base);
        pts[i].f.applyMatrix4(m); pts[i].l.applyMatrix4(m);
      }
    }
    return pts;
  }
  function ik(S, Wt, L1, L2, pole) {
    const d = Wt.clone().sub(S);
    const dist = Math.min(d.length(), L1 + L2 - 0.01);
    const dir = d.clone().normalize();
    const a = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
    const pv = pole.clone().sub(S);
    const bend = pv.sub(dir.clone().multiplyScalar(pv.dot(dir))).normalize();
    return S.clone().add(dir.multiplyScalar(L1 * Math.cos(a))).add(bend.multiplyScalar(L1 * Math.sin(a)));
  }
  /** named arm targets: W wrist, pole (relative to the shoulder) bends the elbow, palm faces this way */
  function armTarget(name, s, sk, o, P) {
    switch (name) {
      case "massage": return { W: V(-10.5 * s + 0.7 * Math.sin(P.t * 10.7), 54.0 + 0.4 * Math.cos(P.t * 10.7), -1.2), pole: V(4 * s, -16, 14), palm: V(0, -1, -0.3) }; // rubbing the other side of the neck
      case "head": { const w = sk.hw(-3.6 * s, 14.5, -3.0); return { W: w, pole: V(4 * s, 22, 2), palm: sk.hw(0, 9, 0).sub(w).normalize() }; } // hand over the head, pulling it (stretch)
      case "hip": return { W: V(15.0 * s, 9.5, -8.5), pole: V(8 * s, -6, -14), palm: V(-s, 0, 0.3) };       // hand behind, at the hip
      case "chin": { const w = sk.mw(0.6 * s, -5.2, 10.6); return { W: w, pole: V(6 * s, -18, 6), palm: V(0, 0.2, -1) }; } // fingers on the chin (chin tuck cue)
      case "relaxed": return { W: V(19.2 * s, 7.0, 4.0), pole: V(6 * s, -10, -14), palm: V(-s, 0, 0), hd: V(0.05 * s, -1, 0.15).normalize(), hl: 6, po: 0 };
      default: return { W: V(19.0 * s, 9.0 + o.y, 4.5), pole: V(9 * s, -16, -9), palm: V(-s, 0, 0) };     // "side": hanging, following a shrug
    }
  }
  /** pose keys: a name, or [[time, name], ...] blended with power2.inOut */
  function armBlend(t, keys) {
    if (typeof keys === "string") return { a: keys, b: keys, u: 0 };
    if (t <= keys[0][0]) return { a: keys[0][1], b: keys[0][1], u: 0 };
    for (let i = 1; i < keys.length; i++) if (t < keys[i][0]) return { a: keys[i - 1][1], b: keys[i][1], u: ez(keys[i][2] || "power2.inOut")((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])) };
    const l = keys[keys.length - 1][1];
    return { a: l, b: l, u: 0 };
  }
  function pose(P, arms) {
    const ch = chain(P.tilt, P.retract, P.turn);
    const O = ch[7].p.clone();
    const rot = new T.Matrix4().makeRotationY((P.turn || 0) * D2R).multiply(new T.Matrix4().makeRotationX(P.tilt * D2R));
    const headM = rot.clone().setPosition(O);
    const headInv = headM.clone().invert();
    // mandible-local == head space with the mouth closed; it rotates about the condyle axis
    const jawRel = new T.Matrix4().makeTranslation(CONDYLE.x, CONDYLE.y, CONDYLE.z)
      .multiply(new T.Matrix4().makeRotationX(P.jaw * JAW_MAX * D2R))
      .multiply(new T.Matrix4().makeTranslation(-CONDYLE.x, -CONDYLE.y, -CONDYLE.z));
    const mandM = headM.clone().multiply(jawRel);
    const mandInv = mandM.clone().invert();
    const hw = (x, y, z) => V(x, y, z).applyMatrix4(headM);
    const mw = (x, y, z) => V(x, y, z).applyMatrix4(mandM);
    const f = P.sf;
    const sh = (s) => V(1.8 * f * s, -0.5 * f, 3.2 * f);
    const sk = { ch, O, rot, headM, headInv, mandM, mandInv, jawRel, hw, mw, side: [], arms };
    sk.eye = hw(0, 6.4, 8.0);
    // transverse-process point on side s at cervical level i (lateral, forward offsets in cm)
    sk.tp = (i, s, lat, fw) => ch[i].p.clone().add(ch[i].l.clone().multiplyScalar(lat * s)).add(ch[i].f.clone().multiplyScalar(fw));
    const phone = arms === "phone";
    let target = null;
    const Wph = phone ? [1, -1].map((s) => V(6.0 * s, 27.5, 19.0).lerp(V(4.8 * s, 56.5, 27.5), P.up)) : null;
    if (phone) target = Wph[0].clone().add(Wph[1]).multiplyScalar(0.5).add(V(0, 4.5, 3.0));
    [1, -1].forEach((s, i) => {
      const o = sh(s);
      o.y += 2.6 * ((P.shrug || 0) + (s > 0 ? P.shrugL || 0 : P.shrugR || 0));
      const G = V(17.5 * s, 45, 0.5).add(o);
      let Wi, poleR, palm, hd, bl, ta, tb;
      if (phone) {
        Wi = Wph[i]; poleR = V(9 * s, -22, -8); hd = target.clone().sub(Wi).normalize(); palm = V(0, 1, 0.2).normalize();
      } else {
        const keys = arms && typeof arms === "object" ? arms[s > 0 ? "L" : "R"] || "relaxed" : arms || "relaxed";
        bl = armBlend(P.t || 0, keys);
        ta = armTarget(bl.a, s, sk, o, P); tb = armTarget(bl.b, s, sk, o, P);
        Wi = ta.W.clone().lerp(tb.W, bl.u); poleR = ta.pole.clone().lerp(tb.pole, bl.u); palm = ta.palm.clone().lerp(tb.palm, bl.u).normalize();
      }
      const E = ik(G, Wi, 29, 25, G.clone().add(poleR));
      let hl = 6, po = 0;
      if (!hd) {
        const fore = Wi.clone().sub(E).normalize();
        hd = (ta.hd || fore).clone().lerp(tb.hd || fore, bl.u).normalize();
        hl = lerp(ta.hl || 7.5, tb.hl || 7.5, bl.u); po = lerp(ta.po === undefined ? 1.4 : ta.po, tb.po === undefined ? 1.4 : tb.po, bl.u);
      }
      const sc = o.clone().multiplyScalar(0.8).add(V(2.4 * f * s, 0, 0));
      sk.side.push({
        s, G, E, W: Wi, hd, palm, hand: Wi.clone().add(hd.clone().multiplyScalar(hl)).add(palm.clone().multiplyScalar(po)),
        A: V(16.6 * s, 48.2, -1.2).add(o), C: V(12.0 * s, 45.6, 4.6).add(o), SC: V(2.0 * s, 46.6, 8.6),
        SA: V(8.6 * s, 46.4, -8.6).add(sc), IA: V(9.6 * s, 30.8, -9.0).add(sc), RS: V(8.4 * s, 42.2, -10.0).add(sc),
        GL: V(15.6 * s, 44.4, -2.6).add(o),
        shBlock: V(12.8 * s, 44.2, -1.6).add(o.clone().multiplyScalar(0.7)), slope: V(13.5 * s, 47.2, -1.6).add(o.clone().multiplyScalar(0.6)),
      });
    });
    sk.phone = target || null;
    sk.neck = ch.map((c) => c.p.clone().add(c.f.clone().multiplyScalar(0.8)));
    return sk;
  }

  // ------------------------------------------------------------------ glass skin SDF (JS mirror of the shader's map())
  const HEAD_PARTS = { cr: [[0, 9.6, 0.4], [7.5, 8.9, 9.8]], fa: [[0, 3.9, 4.9], [6.2, 6.4, 5.4]], ja: [[0, -1.4, 5.8], [5.2, 3.9, 4.2]], no: [[0, 5.3, 10.0], [1.15, 2.0, 1.5]] };
  const SLOPE0 = V(0, 50.4, -3.4);
  const tq = V(), tm = V();
  function skinSDF(p, sk, noArms) {
    let d = sdE(p, [0, 35, 0.2], [15.5, 15, 11.0]);
    d = smin(d, sdE(p, [0, 14, 0.3], [14.2, 16, 10.0]), 4);
    d = smin(d, sdE(p, [0, -10, 0.3], [14.8, 17, 10.0]), 4);
    const L = sk.side[0], R = sk.side[1];
    d = smin(d, sdCone(p, R.shBlock, L.shBlock, 7.2, 7.2), 4);
    for (const s of sk.side) {
      d = smin(d, sdE(p, [s.G.x + 1.6 * s.s, s.G.y - 1.0, s.G.z + 0.4], [5.2, 6.2, 5.6]), 4);
      d = smin(d, sdCone(p, SLOPE0, s.slope, 4.4, 4.4), 4);
    }
    const N = sk.neck;
    let n = sdCone(p, N[0], N[3], 6.0, 5.8);
    n = Math.min(n, sdCone(p, N[3], N[5], 5.8, 5.6));
    n = Math.min(n, sdCone(p, N[5], N[7], 5.6, 5.4));
    d = smin(d, n, 4.5);
    tq.copy(p).applyMatrix4(sk.headInv);
    tm.copy(p).applyMatrix4(sk.mandInv);
    let h = sdE(tq, HEAD_PARTS.cr[0], HEAD_PARTS.cr[1]);
    h = smin(h, sdE(tq, HEAD_PARTS.fa[0], HEAD_PARTS.fa[1]), 2.2);
    h = smin(h, sdE(tm, HEAD_PARTS.ja[0], HEAD_PARTS.ja[1]), 2.2);
    h = smin(h, sdE(tq, HEAD_PARTS.no[0], HEAD_PARTS.no[1]), 1.0);
    h = smin(h, sdE(tq, [7.4, 4.9, 0.2], [1.0, 2.9, 1.9]), 1.0);
    h = smin(h, sdE(tq, [-7.4, 4.9, 0.2], [1.0, 2.9, 1.9]), 1.0);
    d = smin(d, h, 3);
    if (noArms) return d;
    for (const s of sk.side) {
      let a = sdCone(p, s.G, s.E, 4.5, 3.5);
      a = smin(a, sdCone(p, s.E, s.W, 3.3, 2.5), 1.5);
      a = smin(a, sdCone(p, s.W, s.hand, 2.4, 2.1), 1.5);
      d = smin(d, a, 2.5);
    }
    return d;
  }
  const GLASS_FRAG = `
    precision highp float;
    varying vec2 vNdc;
    uniform mat4 uInvProj, uCamWorld, uViewProj, uBody, uBodyInv, uHeadInv, uMandInv; uniform vec3 uCamPos;
    uniform vec3 uN[8]; uniform vec3 uG[2], uE[2], uW[2], uH[2], uSB[2], uSL[2]; uniform float uSide[2];
    uniform vec3 uPainP[8]; uniform float uPainR[8]; uniform float uPainI[8]; uniform float uPix; uniform float uAlpha;
    uniform vec3 uPainCol;
    float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
    float sdE(vec3 p, vec3 c, vec3 r){ vec3 q = (p - c) / r; float k0 = length(q); float k1 = length(q / r); return k0 * (k0 - 1.0) / max(k1, 1e-6); }
    float sdC(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h) - mix(ra, rb, h); }
    float map(vec3 p){
      float d = sdE(p, vec3(0., 35., 0.2), vec3(15.5, 15., 11.));
      d = smin(d, sdE(p, vec3(0., 14., 0.3), vec3(14.2, 16., 10.)), 4.);
      d = smin(d, sdE(p, vec3(0., -10., 0.3), vec3(14.8, 17., 10.)), 4.);
      d = smin(d, sdC(p, uSB[1], uSB[0], 7.2, 7.2), 4.);
      for (int i = 0; i < 2; i++){
        d = smin(d, sdE(p, vec3(uG[i].x + 1.6 * uSide[i], uG[i].y - 1.0, uG[i].z + 0.4), vec3(5.2, 6.2, 5.6)), 4.);
        d = smin(d, sdC(p, vec3(0., 50.4, -3.4), uSL[i], 4.4, 4.4), 4.);
      }
      float n = sdC(p, uN[0], uN[3], 6.0, 5.8);
      n = min(n, sdC(p, uN[3], uN[5], 5.8, 5.6));
      n = min(n, sdC(p, uN[5], uN[7], 5.6, 5.4));
      d = smin(d, n, 4.5);
      vec3 q = (uHeadInv * vec4(p, 1.0)).xyz;
      vec3 qm = (uMandInv * vec4(p, 1.0)).xyz;
      float h = sdE(q, vec3(0., 9.6, 0.4), vec3(7.5, 8.9, 9.8));
      h = smin(h, sdE(q, vec3(0., 3.9, 4.9), vec3(6.2, 6.4, 5.4)), 2.2);
      h = smin(h, sdE(qm, vec3(0., -1.4, 5.8), vec3(5.2, 3.9, 4.2)), 2.2);
      h = smin(h, sdE(q, vec3(0., 5.3, 10.), vec3(1.15, 2., 1.5)), 1.0);
      h = smin(h, sdE(q, vec3(7.4, 4.9, 0.2), vec3(1., 2.9, 1.9)), 1.0);
      h = smin(h, sdE(q, vec3(-7.4, 4.9, 0.2), vec3(1., 2.9, 1.9)), 1.0);
      d = smin(d, h, 3.);
      for (int i = 0; i < 2; i++){
        float a = sdC(p, uG[i], uE[i], 4.5, 3.5);
        a = smin(a, sdC(p, uE[i], uW[i], 3.3, 2.5), 1.5);
        a = smin(a, sdC(p, uW[i], uH[i], 2.4, 2.1), 1.5);
        d = smin(d, a, 2.5);
      }
      return d;
    }
    vec3 nrm(vec3 p){ vec2 e = vec2(0.06, -0.06);
      return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx)); }
    float depthOf(vec3 pb){ vec4 c = uViewProj * (uBody * vec4(pb, 1.0)); return clamp((c.z / c.w) * 0.5 + 0.5, 0.0, 1.0); }
    void main(){
      vec4 vv = uInvProj * vec4(vNdc, 1.0, 1.0);
      vec3 rdw = normalize(mat3(uCamWorld) * normalize(vv.xyz / vv.w));
      vec3 ro = (uBodyInv * vec4(uCamPos, 1.0)).xyz;
      vec3 rd = normalize(mat3(uBodyInv) * rdw);
      vec3 bmin = vec3(-36., -32., -28.), bmax = vec3(36., 100., 48.);
      vec3 inv = 1.0 / rd; vec3 t0 = (bmin - ro) * inv, t1 = (bmax - ro) * inv;
      vec3 tmn = min(t0, t1), tmx = max(t0, t1);
      float tN = max(max(tmn.x, tmn.y), tmn.z), tF = min(min(tmx.x, tmx.y), tmx.z);
      if (tF < 0.0 || tN > tF) discard;
      float t = max(tN, 0.0); float minD = 1e9; float minT = t; bool hit = false;
      for (int i = 0; i < 128; i++){
        vec3 p = ro + rd * t; float d = map(p);
        if (d < minD){ minD = d; minT = t; }
        if (d < 0.02){ hit = true; break; }
        t += d * 0.9; if (t > tF) break;
      }
      if (!hit){
        float px = minT * uPix;
        float a = (1.0 - smoothstep(0.0, px * 1.6, minD)) * 0.8 * uAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vec3(a), a);
        gl_FragDepth = depthOf(ro + rd * minT);
        return;
      }
      vec3 p = ro + rd * t; vec3 n = nrm(p);
      float ndv = clamp(dot(n, -rd), 0.0, 1.0);
      float fres = pow(1.0 - ndv, 2.4);
      float th = 0.0; vec3 q = p + rd * 0.5;
      for (int j = 0; j < 26; j++){ float d = map(q); if (d > 0.05) break; float stp = max(-d, 0.6); q += rd * stp; th += stp; }
      float a = (0.08 + 0.12 * clamp(th / 28.0, 0.0, 1.0) + 0.84 * fres) * uAlpha;
      vec3 L = normalize(vec3(-0.45, 0.75, 0.5)); vec3 hh = normalize(L - rd);
      float spec = pow(max(dot(n, hh), 0.0), 60.0) * 0.35 * uAlpha;
      float w = 0.0;
      for (int k = 0; k < 8; k++){ float dd = length(p - uPainP[k]); float r = max(uPainR[k], 0.1); w = max(w, uPainI[k] * exp(-dd * dd / (2.0 * r * r))); }
      vec3 col = mix(vec3(1.0), uPainCol, w);
      a = clamp(max(a, 0.78 * w) + spec, 0.0, 0.93);
      gl_FragColor = vec4(col * a, a);
      gl_FragDepth = depthOf(p);
    }`;

  // ------------------------------------------------------------------ skull, mandible, teeth (head space)
  const SKV = { zA: [V(5.0, 4.7, 4.4), V(-5.0, 4.7, 4.4)], zB: [V(6.1, 4.5, 0.6), V(-6.1, 4.5, 0.6)], mA: [V(1.2, -3.0, 7.4), V(-1.2, -3.0, 7.4)], mB: [V(4.7, -2.4, 1.6), V(-4.7, -2.4, 1.6)], mC: [V(5.1, 2.4, 0.7), V(-5.1, 2.4, 0.7)] };
  const SP = V();
  function craniumSDF(x, y, z, withTeeth) {
    const p = SP.set(x, y, z);
    let d = sdE(p, [0, 10.5, -0.6], [6.7, 7.1, 8.7]);
    d = smin(d, sdE(p, [0, 4.8, -1.2], [6.0, 3.0, 6.6]), 3.0);
    d = smin(d, sdE(p, [0, 7.9, 7.0], [5.4, 1.4, 1.9]), 1.5);
    let mx = sdE(p, [0, 3.0, 6.1], [4.5, 3.2, 3.3]);
    if (withTeeth) mx = smax(mx, 0.95 - y, 0.4); // alveolar ridge: crowns show below it
    d = smin(d, mx, 2.0);
    d = smin(d, sdE(p, [0, 5.7, 8.4], [0.9, 1.4, 0.75]), 0.8);
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      d = smin(d, sdE(p, [4.4 * s, 4.9, 5.4], [1.7, 1.5, 1.9]), 1.2);
      d = smin(d, sdCone(p, SKV.zA[i], SKV.zB[i], 0.65, 0.65), 0.8);
      d = smin(d, sdE(p, [5.0 * s, 0.6, -1.4], [1.0, 1.4, 1.0]), 1.0);
    }
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      d = smax(d, -sdE(p, [2.75 * s, 6.4, 8.4], [1.6, 1.45, 2.2]), 0.7);
      d = smax(d, -sdE(p, [6.1 * s, 4.2, 0.6], [0.9, 0.6, 0.6]), 0.3);
      d = smax(d, -sdE(p, [7.2 * s, 7.4, 1.8], [1.1, 2.4, 3.4]), 1.5);
    }
    d = smax(d, -sdE(p, [0, 4.1, 9.1], [0.85, 1.25, 1.5]), 0.5);
    if (!withTeeth) d = smax(d, -sdBox(p, [0, 0.1, 8.0], [3.0, 0.75, 2.2]), 0.3);
    return d;
  }
  function mandibleSDF(x, y, z, withTeeth) {
    const p = SP.set(x, y, z);
    let m = sdE(p, [0, -2.8, 7.6], [2.3, 1.8, 1.4]);
    for (let i = 0; i < 2; i++) {
      m = smin(m, sdCone(p, SKV.mA[i], SKV.mB[i], 1.05, 1.05), 1.0);
      m = smin(m, sdCone(p, SKV.mB[i], SKV.mC[i], 0.85, 0.85), 1.0);
      const s = i ? -1 : 1;
      m = smin(m, sdCone(p, V(4.7 * s, 0.2, 2.6), V(4.5 * s, 1.9, 3.6), 0.5, 0.35), 0.6); // coronoid process
    }
    if (withTeeth) {
      // alveolar bone along the lower arch so the roots sit in bone and the crowns stand above it
      for (let i = 0; i < LOWER_ARCH.length - 1; i++) for (const s of [1, -1]) {
        const a = LOWER_ARCH[i], b = LOWER_ARCH[i + 1];
        m = smin(m, sdCone(p, V(a[0] * s, -1.9, a[1]), V(b[0] * s, -1.9, b[1]), 0.62, 0.62), 0.8);
      }
      m = smax(m, y + 0.95, 0.35);
    }
    return m;
  }
  // tooth centres along the arch (x lateral, z forward), central incisor -> third molar; widths in cm
  const UPPER_ARCH = [[0.45, 9.0], [1.25, 8.65], [1.95, 8.05], [2.35, 7.25], [2.6, 6.45], [2.85, 5.45], [3.0, 4.4], [3.1, 3.45]];
  const LOWER_ARCH = [[0.32, 8.7], [0.95, 8.45], [1.6, 8.0], [2.1, 7.3], [2.4, 6.55], [2.65, 5.55], [2.85, 4.45], [2.95, 3.4]];
  const UPPER_W = [0.85, 0.68, 0.78, 0.7, 0.68, 1.0, 0.92, 0.85];
  const LOWER_W = [0.55, 0.6, 0.7, 0.7, 0.72, 1.1, 1.0, 0.95];
  const TOOTH_TYPE = ["incisor", "incisor", "canine", "premolar", "premolar", "molar", "molar", "molar"];
  /** tooth-local: occlusal end at y = 0, crown up to y = ch, root beyond; x = mesio-distal, z = bucco-lingual */
  function toothSDF(type, w) {
    const p = V();
    const ch = type === "molar" ? 0.75 : type === "premolar" ? 0.85 : type === "canine" ? 1.0 : 0.95;
    const rl = type === "canine" ? 1.7 : type === "molar" ? 1.3 : 1.4;
    const bl = type === "molar" ? 1.0 : type === "premolar" ? 0.85 : type === "canine" ? 0.75 : 0.65;
    return {
      ch, rl,
      f(x, y, z) {
        p.set(x, y, z);
        let d;
        if (type === "incisor" || type === "canine") {
          const u = clamp01(y / ch);
          let hx = (w / 2) * (type === "canine" ? Math.min(1, 0.25 + u * 2.2) : lerp(0.95, 0.72, u * u));
          const hz = lerp(type === "canine" ? 0.2 : 0.1, bl / 2, Math.min(1, u * 1.3));
          d = sdBox(p, [0, ch / 2, 0], [Math.max(0.05, hx - 0.08), ch / 2 - 0.02, Math.max(0.05, hz - 0.08)]) - 0.08;
        } else {
          d = sdE(p, [0, ch * 0.55, 0], [w / 2, ch * 0.6, bl / 2]);
          d = smax(d, -y + 0.02, 0.15);
          const cusps = type === "molar" ? [[-0.22, 0.24], [0.22, 0.24], [-0.22, -0.24], [0.22, -0.24]] : [[0, 0.2], [0, -0.2]];
          for (const c of cusps) d = smin(d, sdE(p, [c[0] * w, 0.12, c[1] * bl], [0.22 * w + 0.05, 0.16, 0.18 * bl + 0.05]), 0.12);
          d = smax(d, -sdE(p, [0, -0.02, 0], [w * 0.16, 0.08, bl * 0.14]), 0.06);
        }
        const roots = type === "molar" ? [[-0.22 * w, 0.18], [0.22 * w, 0.18], [0, -0.22]] : [[0, 0]];
        const rr = type === "molar" ? 0.2 : type === "premolar" ? 0.24 : 0.27;
        for (const r of roots) d = smin(d, sdCone(p, V(r[0] * 0.6, ch - 0.1, r[1] * 0.6), V(r[0] * 1.1, ch + rl, r[1] * 1.2), rr, 0.05), 0.2);
        return d;
      },
    };
  }

  // ------------------------------------------------------------------ organs (body space, built once)
  const ORG = {};
  (function defineOrgans() {
    const p = V();
    const lung = (s) => (x, y, z) => {
      p.set(x, y, z);
      let d = sdE(p, [5.5 * s, 44.5, -0.5], [3.8, 4.6, 4.4]);
      d = smin(d, sdE(p, [7.3 * s, 36.5, 0.2], [6.2, 9.5, 7.4]), 3);
      d = smin(d, sdE(p, [7.6 * s, 30.0, 0.6], [6.6, 4.5, 7.4]), 3);
      d = smax(d, 28.6 - 0.03 * x * x - 0.035 * (z - 1) * (z - 1) - y, 1.0); // diaphragm dome
      d = smax(d, 1.8 - s * x, 1.2);                                           // mediastinum
      if (s > 0) d = smax(d, -sdE(p, [2.8, 31.8, 4.6], [4.4, 5.2, 4.6]), 1.5);  // cardiac notch
      return d;
    };
    ORG.lungL = { kind: "sdf", f: lung(1), b0: [1.0, 21, -9], b1: [15, 50.5, 9], h: 0.3, color: "#e9a5a8", center: V(7.3, 36, 0.2), rough: 0.55 };
    ORG.lungR = { kind: "sdf", f: lung(-1), b0: [-15, 21, -9], b1: [-1.0, 50.5, 9], h: 0.3, color: "#e9a5a8", center: V(-7.3, 36, 0.2), rough: 0.55 };
    const hb = V(0.0, 35.6, 2.6), ha = V(5.0, 28.8, 6.6);
    ORG.heart = {
      kind: "sdf", h: 0.22, color: "#b8323a", center: V(1.6, 32.6, 4.4), b0: [-5, 25.5, -2.5], b1: [8.5, 40, 10.5],
      f: (x, y, z) => { p.set(x, y, z); let d = sdCone(p, hb, ha, 3.9, 1.2); d = smin(d, sdE(p, [0.3, 35.4, 2.0], [3.8, 2.6, 3.0]), 2.0); return smin(d, sdE(p, [-2.4, 34.2, 3.0], [1.8, 2.2, 2.0]), 1.2); },
    };
    ORG.liver = {
      kind: "sdf", h: 0.32, color: "#8a3a2d", center: V(-4.6, 25.2, 2.6), b0: [-15, 16.5, -7], b1: [9.5, 31.5, 10.5], rough: 0.4,
      f: (x, y, z) => {
        p.set(x, y, z);
        let d = sdE(p, [-5.2, 24.8, 2.0], [8.6, 4.8, 7.2]);
        d = smin(d, sdE(p, [2.4, 26.4, 4.8], [5.6, 2.6, 4.0]), 3);
        d = smax(d, y - (29.6 - 0.02 * x * x), 1.2);
        return smax(d, 18.5 + 0.35 * (x + 10) - y, 1.2);
      },
    };
    const STOM = [V(3.6, 26.8, 1.4), V(6.2, 26.6, 0.6), V(7.4, 23.6, 2.4), V(6.0, 19.2, 4.0), V(2.2, 17.2, 5.0), V(-1.4, 18.4, 4.4)];
    const STOMR = [1.1, 3.3, 4.0, 3.5, 2.5, 1.2];
    ORG.stomach = { kind: "sdf", h: 0.26, color: "#e6a097", center: V(6.0, 22.6, 2.8), b0: [-3.2, 12.5, -4.5], b1: [12.2, 31.2, 10.2], f: (x, y, z) => chainSDF(p.set(x, y, z), STOM, STOMR, 1.5) };
    ORG.gallbladder = { kind: "sdf", h: 0.15, color: "#6e9b3f", center: V(-4.6, 20.6, 5.6), b0: [-6.2, 17.8, 3.9], b1: [-3.0, 23.4, 7.3], f: (x, y, z) => sdE(p.set(x, y, z), [-4.6, 20.6, 5.6], [1.3, 2.3, 1.3]) };
    ORG.spleen = { kind: "sdf", h: 0.2, color: "#7c3048", center: V(9.6, 24.5, -3.6), b0: [7, 20, -7], b1: [12.2, 29, -0.2], f: (x, y, z) => sdE(p.set(x, y, z), [9.6, 24.5, -3.6], [2.2, 4.0, 3.0]) };
    const kidney = (s) => (x, y, z) => { p.set(x, y, z); const yc = s > 0 ? 16.6 : 15.6; return smax(sdE(p, [5.4 * s, yc, -5.0], [2.4, 4.8, 2.0]), -sdE(p, [3.3 * s, yc, -4.4], [1.0, 1.4, 1.4]), 0.6); };
    ORG.kidneyL = { kind: "sdf", h: 0.2, color: "#a83b3d", center: V(5.4, 16.6, -5.0), b0: [2.5, 11.3, -7.4], b1: [8.2, 22, -2.6], f: kidney(1) };
    ORG.kidneyR = { kind: "sdf", h: 0.2, color: "#a83b3d", center: V(-5.4, 15.6, -5.0), b0: [-8.2, 10.3, -7.4], b1: [-2.5, 21, -2.6], f: kidney(-1) };
    ORG.aorta = { kind: "tube", color: "#cf3a3c", pts: [V(0.6, 36.8, 3.0), V(0.6, 40.5, 2.4), V(0.4, 42.0, 0.5), V(1.0, 41.2, -2.2), V(1.6, 38, -3.4), V(1.6, 30, -3.6), V(1.3, 20, -3.0), V(1.0, 10, -2.2)], radius: (u) => lerp(1.25, 0.95, u), segs: 90 };
    ORG.trachea = { kind: "tube", color: "#ead9cf", pts: [V(0, 57, 3.4), V(0, 50, 2.4), V(0, 44, 1.6), V(0, 41, 1.0)], radius: () => 1.0, segs: 40 };
    ORG.bronchusR = { kind: "tube", color: "#ead9cf", pts: [V(0, 41.4, 1.0), V(-1.8, 40.0, 0.8), V(-3.6, 38.6, 0.4)], radius: () => 0.66, segs: 16 };
    ORG.bronchusL = { kind: "tube", color: "#ead9cf", pts: [V(0, 41.4, 1.0), V(2.0, 40.4, 0.7), V(3.8, 39.2, 0.2)], radius: () => 0.6, segs: 16 };
    ORG.esophagus = { kind: "tube", color: "#df9b92", pts: [V(0, 56, 0.6), V(0, 50, -0.4), V(0, 45, -1.6), V(0.4, 40, -2.0), V(1.0, 35, -1.6), V(1.8, 30.5, -0.6), V(2.8, 27.8, 0.6), V(3.6, 26.8, 1.4)], radius: () => 0.85, segs: 80 };
    ORG.duodenum = { kind: "tube", color: "#e8a59a", pts: [V(-1.4, 18.4, 4.4), V(-3.6, 18.0, 3.0), V(-4.6, 15.5, 2.0), V(-4.0, 12.8, 1.6), V(-1.0, 11.8, 1.4), V(2.2, 12.6, 1.2), V(3.4, 14.4, 0.8)], radius: () => 1.05, segs: 60 };
    const si = [V(3.4, 14.4, 0.8)];
    const rnd = mulberry32(11);
    for (let r = 0; r < 6; r++) {
      const y = 11.8 - r * 1.9, dir = r % 2 ? 1 : -1;
      for (let k = 0; k <= 6; k++) {
        const x = dir * (-6.4 + (12.8 * k) / 6);
        si.push(V(x + (rnd() - 0.5) * 0.8, y + (rnd() - 0.5) * 0.9, 3.6 + 1.6 * Math.sin(k * 1.3 + r) + (rnd() - 0.5) * 0.6));
      }
    }
    si.push(V(-6.6, 1.6, 3.4), V(-7.4, 4.0, 3.2));
    ORG.smallIntestine = { kind: "tube", color: "#eca69c", pts: si, radius: () => 1.15, segs: 360 };
    ORG.colon = { kind: "tube", color: "#e2ae9c", pts: [V(-7.6, 3.6, 3.2), V(-8.3, 9.0, 2.8), V(-8.2, 15.0, 2.6), V(-6.5, 17.2, 4.6), V(-2.0, 15.8, 6.6), V(2.0, 15.6, 6.6), V(6.0, 17.4, 4.4), V(7.8, 18.4, 3.0), V(8.4, 13.0, 2.0), V(8.4, 8.0, 1.6), V(7.0, 3.0, 2.6), V(4.4, 1.0, 3.8), V(1.6, 0.0, 1.2), V(0.4, -3.0, -1.4)], radius: (u) => 1.9 * (1 + 0.1 * Math.sin(u * Math.PI * 2 * 28)), segs: 300 };
    ORG.upperGI = { kind: "path", pts: [V(0, 58.5, 1.4), ...ORG.esophagus.pts.slice(1), V(6.0, 26.0, 0.9), V(7.1, 23.0, 2.6), V(5.6, 19.2, 4.0), V(2.2, 17.2, 5.0), ...ORG.duodenum.pts] };
  })();
  const ORGAN_ALIASES = { lungs: ["lungL", "lungR"], kidneys: ["kidneyL", "kidneyR"], airway: ["trachea", "bronchusL", "bronchusR"], bowel: ["smallIntestine", "colon"] };
  const expandOrgans = (list) => (list || []).flatMap((n) => ORGAN_ALIASES[n] || [n]);

  // ------------------------------------------------------------------ muscles
  function catmull(keys, v) {
    const n = keys.length - 1, x = clamp01(v) * n;
    const i = Math.min(n - 1, Math.floor(x)), u = x - i;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n, i + 2)];
    const u2 = u * u, u3 = u2 * u;
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    return V(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
  }
  /** Built-in muscles. kind "sheet": point(u,v) between key curves, fibres run along u. kind "tube": a fusiform belly. */
  const MUSCLES = {
    trapezius: {
      kind: "sheet", nu: 14, nv: 40, surface: "skin", depth: 0.55, tendon: true, heatV: [0, 0.42], weakV: [0.42, 1],
      keys(sk, side) {
        const s = side.s, ch = sk.ch, hw = sk.hw;
        const back = (i, d) => ch[i].p.clone().add(ch[i].f.clone().multiplyScalar(-d));
        const o = side.A.clone().sub(V(16.6 * s, 48.2, -1.2));
        return {
          M: [hw(0, 3.2, -8.0), back(6, 5.6), back(3, 6.0), back(0, 5.2), V(0, 44, -9.8), V(0, 39, -10.6), V(0, 31, -11), V(0, 23.5, -10.6), V(0, 17.5, -10)],
          B: [hw(3.8 * s, 3.6, -7.2), back(5, 2.5).add(ch[5].l.clone().multiplyScalar(5.0 * s)), V(11 * s, 48.6, 3.0).add(o), V(16.6 * s, 48.2, -1.2).add(o),
            V(14 * s, 46.6, -5.5).add(o.clone().multiplyScalar(0.9)), V(11 * s, 44.6, -8.6).add(o.clone().multiplyScalar(0.85)),
            side.RS.clone(), side.RS.clone().add(V(-0.4 * s, -0.7, -0.2)), side.RS.clone().add(V(-0.8 * s, -1.4, -0.3))],
        };
      },
    },
    pectoralisMinor: {
      kind: "sheet", nu: 7, nv: 6, surface: "none",
      point(sk, side, u, v) {
        const s = side.s;
        const R = [V(7.5 * s, 39.5, 9.6), V(8.6 * s, 37.0, 9.4), V(9.6 * s, 34.5, 9.0)];
        const rp = v < 0.5 ? R[0].clone().lerp(R[1], v * 2) : R[1].clone().lerp(R[2], (v - 0.5) * 2);
        return side.C.clone().add(V(0, (v - 0.5) * 0.8, 0)).lerp(rp, u).add(V(0, 0, 0.7 * Math.sin(Math.PI * u)));
      },
    },
    masseter: {
      kind: "sheet", nu: 9, nv: 10, surface: "none",
      point(sk, side, u, v, P) {
        const s = side.s;
        const top = V(lerp(4.5, 6.0, v) * s, lerp(4.0, 4.0, v), lerp(4.7, 0.9, v));                                       // zygomatic arch (head)
        const bot = V(lerp(4.2, 4.95, v) * s, lerp(-2.95, -2.6, v), lerp(4.7, 1.3, v)).applyMatrix4(sk.jawRel);           // ramus and angle (mandible)
        const q = top.lerp(bot, u);
        q.x += s * (0.45 + 0.75 * (P.bulge || 0)) * Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + 0.7 * v));
        return q.applyMatrix4(sk.headM);
      },
    },
    temporalis: {
      kind: "sheet", nu: 10, nv: 12, surface: "skull", depth: -0.3,
      point(sk, side, u, v) {
        const s = side.s;
        const top = catmull([V(5.5 * s, 10.0, 5.6), V(6.4 * s, 11.8, 2.0), V(6.5 * s, 11.6, -2.0), V(6.0 * s, 9.6, -4.6)], v); // temporal line
        const bot = V(lerp(4.6, 4.9, v) * s, lerp(2.4, 2.2, v), lerp(4.2, 2.6, v)).applyMatrix4(sk.jawRel);
        return top.lerp(bot, u * 0.92).applyMatrix4(sk.headM);
      },
    },
    levatorScapulae: {
      // fusiform belly from the transverse processes of C1-C4 to the superior angle of the scapula, plus two upper slips
      kind: "tube", segs: 28, color: "#c4535b",
      radius: (u) => 0.55 + 0.8 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), 0.7),
      pts: (sk, side) => { const s = side.s; return [sk.tp(7, s, 2.9, 0.2), sk.tp(6, s, 3.0, -0.3), sk.tp(4, s, 3.3, -1.1), sk.tp(2, s, 4.0, -2.2), sk.tp(0, s, 5.6, -3.6), side.SA.clone().add(V(0, 0.9, 0.3))]; },
      slips: (sk, side) => { const s = side.s; return [
        { pts: [sk.tp(5, s, 3.2, 0.1), sk.tp(4, s, 3.4, -0.6), sk.tp(3, s, 3.7, -1.5)], radius: (u) => 0.32 + 0.3 * Math.sin(Math.PI * u) },
        { pts: [sk.tp(4, s, 3.3, 0.1), sk.tp(3, s, 3.6, -0.7), sk.tp(2, s, 4.0, -1.9)], radius: (u) => 0.32 + 0.3 * Math.sin(Math.PI * u) }]; },
    },
    sternocleidomastoid: {
      kind: "tube", radius: (u) => 1.25 - 0.35 * u, color: "#cc5a60",
      pts: (sk, side) => { const s = side.s; return [sk.hw(5.0 * s, 0.4, -1.2), sk.tp(4, s, 4.4, 2.6), sk.tp(1, s, 2.8, 6.0), V(1.8 * s, 46.6, 8.6)]; },
    },
  };

  // ------------------------------------------------------------------ stage
  class Stage {
    constructor(opts) {
      const story = (this.story = opts.story);
      this.id = opts.id;
      this.duration = story.duration;
      const show = (this.show = Object.assign({ skeleton: true, glass: true, spineDetail: false, teeth: true, pelvis: false, muscles: [], organs: [] }, story.show || {}));
      this.arms = story.arms || "relaxed";
      this.canvas = document.getElementById(opts.canvas || "am-canvas");
      this.svg = document.getElementById(opts.svg || "am-svg");
      const renderer = (this.renderer = new T.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true }));
      renderer.setPixelRatio(1);
      renderer.setSize(opts.width || 1080, opts.height || 1920, false);
      renderer.setClearColor(0x000000, 0);
      this.W = opts.width || 1080; this.H = opts.height || 1920;
      const scene = (this.scene = new T.Scene());
      this.camera = new T.PerspectiveCamera(32, this.W / this.H, 1, 3000);
      scene.add(new T.HemisphereLight(0xffffff, 0x9fd38a, 1.05));
      const L = (c, i, x, y, z) => { const l = new T.DirectionalLight(c, i); l.position.set(x, y, z); scene.add(l); };
      L(0xfff3e4, 1.6, -60, 110, 80); L(0xe6f4ff, 1.0, 50, 60, -110); L(0xfff6ea, 0.7, -60, 80, -100); L(0xffffff, 0.45, 90, 20, 40);
      this.root = new T.Group();
      scene.add(this.root);
      this.mat = {
        bone: new T.MeshStandardMaterial({ color: "#f5efe2", emissive: new T.Color("#1d1a14"), roughness: 0.6 }),
        boneV: new T.MeshStandardMaterial({ vertexColors: true, emissive: new T.Color("#1d1a14"), roughness: 0.6 }),
        cart: new T.MeshStandardMaterial({ color: "#e4d9c6", roughness: 0.7 }),
        disc: new T.MeshStandardMaterial({ color: "#d3e6ef", roughness: 0.45 }),
        cord: new T.MeshStandardMaterial({ color: "#f3c64a", emissive: new T.Color("#5a3d00"), roughness: 0.45 }),
        path: new T.MeshBasicMaterial({ color: story.pathColor || "#ffd84a" }),
        knot: new T.MeshStandardMaterial({ color: "#8a101b", emissive: new T.Color("#ff1e2e"), emissiveIntensity: 0, roughness: 0.35 }),
        phone: new T.MeshStandardMaterial({ color: "#17201b", roughness: 0.4, metalness: 0.2, transparent: true }),
        screen: new T.MeshBasicMaterial({ color: "#dff3ff", transparent: true }),
        tooth: new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
        gum: new T.MeshStandardMaterial({ color: "#e48f93", roughness: 0.45 }),
      };
      this.boneMats = [this.mat.bone, this.mat.boneV, this.mat.cart];
      this.muscleTex = this._fiberTexture();
      this.state = { cache: {} };
      this.U = { cyl: new T.CylinderGeometry(1, 1, 1, 12, 1), box: new T.BoxGeometry(1, 1, 1), sph: new T.SphereGeometry(1, 24, 16) };
      if (show.skeleton) this._buildSkeleton();
      if (show.spineDetail) this._buildSpineDetail();
      this._buildMuscles();
      this._buildOrgans();
      this._buildPainAndPaths();
      if (show.glass) this._buildGlass();
      this._buildOverlays();
      renderer.compile(scene, this.camera);
    }

    // ---------------- helpers
    _fiberTexture() {
      const tc = document.createElement("canvas");
      tc.width = 512; tc.height = 1024;
      const tx = tc.getContext("2d");
      tx.fillStyle = "#ffffff"; tx.fillRect(0, 0, 512, 1024);
      const rnd = mulberry32(7);
      for (let y = 0; y < 1024; y += 9) {
        tx.strokeStyle = `rgba(120,120,120,${0.35 + 0.25 * rnd()})`;
        tx.lineWidth = 2 + 2 * rnd();
        tx.beginPath(); tx.moveTo(0, y + rnd() * 3); tx.lineTo(512, y + rnd() * 3); tx.stroke();
      }
      const tex = new T.CanvasTexture(tc);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    }
    _mesh(geo, mat, parent) { const m = new T.Mesh(geo, mat); (parent || this.root).add(m); return m; }
    _sph(r, mat, parent) { const m = this._mesh(this.U.sph, mat || this.mat.bone, parent); m.scale.setScalar(r); return m; }
    _cyl(mat, parent) { return this._mesh(this.U.cyl, mat || this.mat.bone, parent); }
    static placeCyl(mesh, a, b, r) {
      const d = b.clone().sub(a);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
      mesh.scale.set(r, Math.max(0.001, d.length()), r);
    }
    static orient(g, pos, up, fwd) {
      const x = up.clone().cross(fwd).normalize();
      const z = x.clone().cross(up).normalize();
      g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, up.clone().normalize(), z));
      g.position.copy(pos);
    }
    _vert(rb, h, lsp, spAng, ltp) {
      const g = new T.Group();
      const add = (sx, sy, sz, px, py, pz, rx) => { const m = new T.Mesh(this.U.box, this.mat.bone); m.scale.set(sx, sy, sz); m.position.set(px, py, pz); if (rx) m.rotation.x = rx; g.add(m); };
      const body = new T.Mesh(this.U.cyl, this.mat.bone); body.scale.set(rb, h, rb * 0.85); g.add(body);
      [1, -1].forEach((s) => add(0.5, h * 0.6, 1.2, s * rb * 0.62, 0, -rb - 0.35)); // pedicles leave room for the cord
      add(rb * 1.7, h * 0.6, 0.6, 0, 0, -rb - 1.25);                                  // lamina
      add(0.55, 0.8, lsp, 0, -Math.sin(spAng) * lsp * 0.5, -rb - 1.2 - Math.cos(spAng) * lsp * 0.5, -spAng);
      [1, -1].forEach((s) => add(ltp, 0.55, 0.65, s * (rb * 0.75 + ltp / 2), 0, -rb - 0.3));
      this.root.add(g);
      return g;
    }

    // ---------------- skeleton
    _buildSkeleton() {
      const teeth = this.show.teeth;
      const head = (this.head = new T.Group());
      this.root.add(head);
      const bone = new T.Color("#f5efe2"), dark = new T.Color("#3a4636");
      const ek = (x, y, z, c, r) => Math.hypot((x - c[0]) / r[0], (y - c[1]) / r[1], (z - c[2]) / r[2]);
      const shade = (x, y, z) => {
        let dk = 0;
        for (const s of [1, -1]) {
          dk = Math.max(dk, 1 - sstep(0.8, 1.12, ek(x, y, z, [2.75 * s, 6.4, 7.9], [1.6, 1.45, 1.6])));
          dk = Math.max(dk, 1 - sstep(0.7, 1.1, ek(x, y, z, [6.0 * s, 4.2, 0.6], [0.8, 0.6, 0.6])));
        }
        dk = Math.max(dk, 1 - sstep(0.8, 1.12, ek(x, y, z, [0, 4.1, 8.7], [0.85, 1.25, 1.0])));
        const c = bone.clone().lerp(dark, 0.92 * dk);
        return [c.r, c.g, c.b];
      };
      head.add(new T.Mesh(meshSDF((x, y, z) => craniumSDF(x, y, z, teeth), [-7.8, -1.5, -10.4], [7.8, 18.4, 10.8], 0.22, shade), this.mat.boneV));
      this.jaw = new T.Group();
      head.add(this.jaw);
      this.jaw.add(new T.Mesh(meshSDF((x, y, z) => mandibleSDF(x, y, z, teeth), [-6.4, -5.2, -0.6], [6.4, 3.6, 9.8], 0.18, () => [bone.r, bone.g, bone.b]), this.mat.boneV));
      if (teeth) this._buildTeeth();
      else {
        for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) {
          const a = -1.0 + (2.0 * i) / 9, rr = row ? 2.7 : 2.9;
          const th = new T.Mesh(this.U.box, this.mat.tooth.clone());
          th.material.vertexColors = false; th.material.color.set("#fbf8f0");
          th.scale.set(0.6, 0.95, 0.55);
          th.position.set(rr * Math.sin(a), row ? -0.4 : 0.6, (row ? 6.1 : 6.2) + rr * Math.cos(a));
          th.rotation.y = a;
          (row ? this.jaw : head).add(th);
        }
      }
      // the jaw group sits on the condyle axis so it can swing open; its children were authored in head space
      this.jaw.position.copy(CONDYLE);
      this.jaw.children.forEach((c) => c.position.sub(CONDYLE));
      // spine
      this.cverts = [];
      for (let k = 0; k < 7; k++) this.cverts.push(this._vert(1.05, 0.95, 1.6, 0.35, 1.5));
      const spine = (this.spineCurve = new T.CatmullRomCurve3([V(0, 45.0, -4.4), V(0, 38.6, -5.8), V(0, 31.6, -6.3), V(0, 24.5, -5.6), V(0, 19.6, -4.6), V(0, 13.6, -3.0), V(0, 7.0, -2.2), V(0, 1.0, -3.2)]));
      this.staticVerts = [];
      for (let i = 0; i < 17; i++) {
        const u = i < 12 ? (i / 11) * 0.6 : 0.62 + ((i - 12) / 4) * 0.36;
        const p = spine.getPoint(u), tg = spine.getTangent(u).negate();
        const lumbar = i >= 12;
        const rb = lumbar ? 2.1 : 1.35 + i * 0.04, h = lumbar ? 2.3 : 1.65 + i * 0.03;
        const g = lumbar ? this._vert(rb, h, 2.4, 0.15, 2.0) : this._vert(rb, h, 2.0, 0.95, 2.4);
        Stage.orient(g, p, tg, V(0, 0, 1));
        this.staticVerts.push({ p, tg, rb, h, u });
      }
      const zSpine = (y) => { let best = spine.getPoint(0); for (let i = 0; i <= 60; i++) { const q = spine.getPoint(i / 60); if (Math.abs(q.y - y) < Math.abs(best.y - y)) best = q; } return best.z; };
      // ribs: leave the vertebra, run back to the rib angle, sweep round and forward
      const RA = [6.5, 9, 11, 12.5, 13.3, 13.8, 14, 13.9, 13.5, 12.8, 11.5, 9.5];
      const RB = [6.4, 7.6, 8.4, 9.0, 9.3, 9.4, 9.4, 9.2, 8.8, 8.3, 7.3, 6.0];
      const RD = [3, 7, 8.5, 9.5, 10, 10, 10, 9.5, 9, 8, 6, 4];
      const RPHI = [0.92, 0.92, 0.9, 0.88, 0.86, 0.84, 0.8, 0.75, 0.7, 0.66, 0.6, 0.55];
      for (let i = 0; i < 12; i++) {
        const yv = 45.8 - i * 2.45, zs = zSpine(yv);
        const xa = Math.min(6.5, 0.6 * RA[i]), p1 = Math.asin(Math.min(0.85, xa / RA[i])), zc = zs - 3.0 + RB[i] * Math.cos(p1);
        [1, -1].forEach((s) => {
          const pts = [V(s * 1.6, yv, zs - 0.8), V(s * (xa * 0.55 + 0.6), yv - 0.3, zs - 2.6)];
          for (let k = 0; k <= 14; k++) {
            const ph = p1 + ((RPHI[i] * Math.PI - p1) * k) / 14;
            pts.push(V(s * RA[i] * Math.sin(ph), yv - 0.6 - (RD[i] * (Math.cos(p1) - Math.cos(ph))) / 2, zc - RB[i] * Math.cos(ph)));
          }
          this._mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.5, 6), this.mat.bone);
          if (i < 10) {
            const e = pts[pts.length - 1];
            const st = i < 7 ? V(s * 1.8, 45.2 - i * 2.4, 9.6 + i * 0.1) : V(s * (4.5 + (i - 7) * 1.5), e.y + 4.5, e.z + 0.4);
            this._mesh(new T.TubeGeometry(new T.CatmullRomCurve3([e, e.clone().lerp(st, 0.5).add(V(0, 0.6, 0.6)), st]), 12, 0.45, 6), this.mat.cart);
          }
        });
      }
      const stern = this._mesh(this.U.box, this.mat.bone); stern.scale.set(3.2, 17, 0.9); stern.position.set(0, 36.8, 10.0); stern.rotation.x = -0.12;
      const manu = this._mesh(this.U.box, this.mat.bone); manu.scale.set(5.0, 4.4, 1.0); manu.position.set(0, 45.2, 9.3); manu.rotation.x = -0.18;
      // pelvis rim (simplified, opt-in with show.pelvis): iliac crests as a lower-torso landmark
      if (this.show.pelvis) [1, -1].forEach((s) => this._mesh(new T.TubeGeometry(new T.CatmullRomCurve3([V(2.2 * s, 2.0, -5.6), V(9.0 * s, 4.8, -4.6), V(12.6 * s, 3.4, 0.0), V(10.6 * s, 0.0, 4.4), V(6.2 * s, -4.0, 6.0)]), 30, 0.75, 8), this.mat.bone));
      // shoulder girdle and arms
      this.parts = [0, 1].map(() => {
        const o = {};
        o.clav = new Tube(this.root, 16, 8, 0.65, this.mat.bone);
        o.spineScap = new Tube(this.root, 10, 8, 0.6, this.mat.bone);
        o.acro = this._sph(1.2); o.acro.scale.set(1.6, 0.8, 1.3);
        o.cora = new Tube(this.root, 6, 6, 0.45, this.mat.bone);
        o.scapN = 10;
        const nv = ((o.scapN + 1) * (o.scapN + 2)) / 2;
        o.scapPos = new Float32Array(nv * 3);
        o.scapGeo = new T.BufferGeometry();
        o.scapGeo.setAttribute("position", new T.BufferAttribute(o.scapPos, 3));
        const idx = [], id = (i, j) => (i * (2 * o.scapN + 3 - i)) / 2 + j;
        for (let i = 0; i < o.scapN; i++) for (let j = 0; j < o.scapN - i; j++) {
          idx.push(id(i, j), id(i + 1, j), id(i, j + 1));
          if (j < o.scapN - i - 1) idx.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
        }
        o.scapGeo.setIndex(idx);
        o.scap = this._mesh(o.scapGeo, new T.MeshStandardMaterial({ color: "#efe8da", roughness: 0.65, side: T.DoubleSide }));
        this.boneMats.push(o.scap.material);
        o.scap.frustumCulled = false;
        o.humHead = this._sph(2.3); o.hum = this._cyl(); o.elb = this._sph(1.5); o.rad = this._cyl(); o.uln = this._cyl(); o.wr = this._sph(0.9);
        o.meta = [0, 1, 2, 3].map(() => this._cyl());
        o.phal = [0, 1, 2, 3].map(() => [this._cyl(), this._cyl()]);
        o.thumb = [this._cyl(), this._cyl()];
        return o;
      });
      if (this.arms === "phone") {
        const phone = (this.phone = new T.Group());
        const pb = new T.Mesh(this.U.box, this.mat.phone); pb.scale.set(7.2, 15, 0.8); phone.add(pb);
        const ps = new T.Mesh(new T.PlaneGeometry(6.6, 14.2), this.mat.screen); ps.position.z = 0.42; phone.add(ps);
        this.root.add(phone);
      }
    }
    _buildTeeth() {
      const enamel = new T.Color("#f8f6ee"), root = new T.Color("#e7d9bd");
      const build = (arch, widths, lower) => {
        arch.forEach((a, i) => {
          const type = TOOTH_TYPE[i];
          const td = toothSDF(type, widths[i]);
          const geo = meshSDF(td.f, [-widths[i], -0.15, -0.9], [widths[i], td.ch + td.rl + 0.2, 0.9], 0.05, (x, y) => { const c = enamel.clone().lerp(root, sstep(td.ch - 0.12, td.ch + 0.12, y)); return [c.r, c.g, c.b]; });
          [1, -1].forEach((s) => {
            const m = new T.Mesh(geo, this.mat.tooth);
            const nxt = arch[Math.min(arch.length - 1, i + 1)], prv = arch[Math.max(0, i - 1)];
            const tang = V((nxt[0] - prv[0]) * s, 0, nxt[1] - prv[1]).normalize();
            const yaw = Math.atan2(-tang.z, tang.x);
            m.position.set(a[0] * s, lower ? 0.0 : 0.02, a[1]);
            m.rotation.set(0, yaw, lower ? Math.PI : 0);
            if (!lower && i < 2) m.rotation.x = -0.18; // upper incisors lean forward a little
            if (lower && i < 2) m.rotation.x = 0.12;
            m.userData = { side: s > 0 ? "L" : "R", index: i, lower };
            (lower ? this.jaw : this.head).add(m);
          });
        });
        const gumPts = [];
        for (let i = arch.length - 1; i >= 0; i--) gumPts.push(V(arch[i][0], lower ? -0.92 : 0.95, arch[i][1] - 0.05));
        for (let i = 0; i < arch.length; i++) gumPts.push(V(-arch[i][0], lower ? -0.92 : 0.95, arch[i][1] - 0.05));
        const g = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(gumPts), 80, 0.4, 8), this.mat.gum);
        (lower ? this.jaw : this.head).add(g);
      };
      build(UPPER_ARCH, UPPER_W, false);
      build(LOWER_ARCH, LOWER_W, true);
    }
    _buildSpineDetail() {
      this.discs = [];
      for (let k = 0; k < 7; k++) this.discs.push(this._cyl(this.mat.disc));
      const sv = this.staticVerts;
      if (sv) for (let i = 0; i < sv.length - 1; i++) {
        const a = sv[i], b = sv[i + 1];
        const m = this._cyl(this.mat.disc);
        const d = a.p.distanceTo(b.p), gap = Math.max(0.3, d - (a.h + b.h) / 2);
        const c = a.p.clone().lerp(b.p, 0.5), dir = b.p.clone().sub(a.p).normalize();
        m.position.copy(c); m.quaternion.setFromUnitVectors(V(0, 1, 0), dir); m.scale.set((a.rb + b.rb) * 0.47, gap * 0.92, (a.rb + b.rb) * 0.42);
      }
      this.cord = new Tube(this.root, 70, 10, 0.55, this.mat.cord);
      this.roots = [];
      for (let k = 0; k < 6; k++) for (const s of [1, -1]) {
        const mat = this.mat.cord.clone();
        this.roots.push({ k, s, tube: new Tube(this.root, 8, 6, 0.32, mat), mat });
      }
      this.bulges = (this.story.herniation || []).map(() => this._sph(1, this.mat.disc.clone()));
    }

    // ---------------- muscles
    _buildMuscles() {
      this.muscles = {};
      for (const name of this.show.muscles || []) {
        const def = MUSCLES[name];
        if (!def) { console.warn("anatomy-motion: unknown muscle", name); continue; }
        const m = { def, sides: [] };
        for (let si = 0; si < 2; si++) {
          if (def.kind === "tube") {
            const mat = new T.MeshStandardMaterial({ color: def.color, roughness: 0.48, map: this.muscleTex });
            const slips = def.slips ? def.slips(pose({ tilt: 0, retract: 0, sf: 0, up: 0, jaw: 0, t: 0 }, "relaxed"), { s: 1, SA: V() }).map(() => new Tube(this.root, 12, 8, 0.5, mat)) : [];
            m.sides.push({ tube: new Tube(this.root, def.segs || 18, 14, 1, mat), mat, slips });
          } else {
            const nu = def.nu, nv = def.nv;
            const geo = new T.BufferGeometry();
            const pos = new Float32Array(nu * nv * 3), col = new Float32Array(nu * nv * 3), uv = new Float32Array(nu * nv * 2), idx = [];
            for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
              uv[(j * nu + i) * 2] = i / (nu - 1); uv[(j * nu + i) * 2 + 1] = (j / (nv - 1)) * 3;
              if (i < nu - 1 && j < nv - 1) { const a = j * nu + i; idx.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu); }
            }
            geo.setAttribute("position", new T.BufferAttribute(pos, 3));
            geo.setAttribute("color", new T.BufferAttribute(col, 3));
            geo.setAttribute("uv", new T.BufferAttribute(uv, 2));
            geo.setIndex(idx);
            const mesh = this._mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, map: this.muscleTex, roughness: 0.48, side: T.DoubleSide }));
            mesh.frustumCulled = false;
            m.sides.push({ geo, pos, col, nu, nv, mesh });
          }
        }
        this.muscles[name] = m;
      }
      this.knots = (this.story.knots || []).flatMap((k) => (k.side === "both" ? ["L", "R"].map((sd) => Object.assign({}, k, { side: sd, id: k.id + sd })) : [k]));
      this.knots.forEach((k) => { k.mesh = this._sph(1, this.mat.knot); });
    }
    _musclePoint(name, sk, si, u, v, P) {
      const m = this.muscles[name], def = MUSCLES[name];
      const side = sk.side[si];
      if (def.kind === "tube") return new T.CatmullRomCurve3(def.pts(sk, side)).getPoint(clamp01(u));
      let q;
      if (def.keys) {
        const ck = `${name}${si}`;
        const K = (sk._keys = sk._keys || {})[ck] || (sk._keys[ck] = def.keys(sk, side));
        q = catmull(K.M, v).lerp(catmull(K.B, v), u);
      } else q = def.point(sk, side, u, v, P || {});
      if (def.surface === "skin") q = this.projectSkin(q, sk, def.depth);
      else if (def.surface === "skull") q = this.projectSkull(q, sk, def.depth);
      return q;
    }
    _updateMuscles(sk, P, t) {
      const cCool = new T.Color("#d9676c"), cHot = new T.Color("#e3242e"), cWeak = new T.Color("#a8a09d"), cTendon = new T.Color("#efd9d2");
      const c = new T.Color();
      for (const name in this.muscles) {
        const m = this.muscles[name], def = m.def;
        const cfg = (this.story.muscles || {})[name] || {};
        const heat = track(t, cfg.heat, 0), weak = track(t, cfg.weak, 0), bulge = track(t, cfg.bulge, 0), op = track(t, cfg.opacity, 1);
        const sig = [P.tilt, P.retract, P.sf, P.jaw, bulge, P.turn, P.shrug, P.shrugL, P.shrugR].map((v) => (v || 0).toFixed(3)).join("|");
        const dirty = this.state.cache[name] !== sig;
        this.state.cache[name] = sig;
        const heatV = cfg.heatV || def.heatV || [0, 1], weakV = cfg.weakV || def.weakV || [0, 1];
        m.sides.forEach((S, si) => {
          if (def.kind === "tube") {
            if (dirty) {
              S.tube.update(def.pts(sk, sk.side[si]), (u) => def.radius(u) * (1 + 0.4 * bulge));
              if (def.slips) def.slips(sk, sk.side[si]).forEach((sl, k) => S.slips[k] && S.slips[k].update(sl.pts, sl.radius));
            }
            S.mat.color.copy(new T.Color(def.color)).lerp(cHot, heat).lerp(cWeak, weak);
            S.mat.emissive = S.mat.emissive || new T.Color(); S.mat.emissive.copy(cHot).multiplyScalar(0.18 * heat);
            S.mat.transparent = op < 0.999; S.mat.opacity = op; S.mat.depthWrite = op > 0.6;
            S.tube.mesh.visible = op > 0.01; S.slips.forEach((t2) => (t2.mesh.visible = op > 0.01));
            return;
          }
          if (dirty) {
            for (let j = 0; j < S.nv; j++) for (let i = 0; i < S.nu; i++) {
              const q = this._musclePoint(name, sk, si, i / (S.nu - 1), j / (S.nv - 1), Object.assign({}, P, { bulge }));
              const k = (j * S.nu + i) * 3;
              S.pos[k] = q.x; S.pos[k + 1] = q.y; S.pos[k + 2] = q.z;
            }
            S.geo.attributes.position.needsUpdate = true;
            S.geo.computeVertexNormals();
          }
          const sideKnots = this.knots.filter((k) => k.on === name && SIDE[k.side] === si);
          for (let j = 0; j < S.nv; j++) for (let i = 0; i < S.nu; i++) {
            const u = i / (S.nu - 1), v = j / (S.nv - 1);
            const inHeat = sstep(heatV[0] - 0.06, heatV[0] + 0.02, v) * (1 - sstep(heatV[1] - 0.04, heatV[1] + 0.08, v));
            const inWeak = sstep(weakV[0], weakV[0] + 0.14, v) * (1 - sstep(weakV[1] - 0.02, weakV[1] + 0.1, v));
            let kh = 0;
            for (const kn of sideKnots) kh += track(t, kn.show, 0) * Math.exp(-((u - kn.u) ** 2 + (v - kn.v) ** 2) / (2 * 0.12 * 0.12)) * 0.8;
            c.copy(cCool).lerp(cHot, Math.min(1, heat * inHeat + kh));
            c.lerp(cWeak, weak * inWeak);
            if (def.tendon) {
              const ten = v > 0.32 && v < 0.56 ? 0.07 * (1 - Math.abs(v - 0.44) / 0.12) : 0;
              if (u < ten) c.lerp(cTendon, 0.45);
              if (v < 0.03) c.lerp(cTendon, 0.4);
            }
            const k = (j * S.nu + i) * 3;
            S.col[k] = c.r; S.col[k + 1] = c.g; S.col[k + 2] = c.b;
          }
          S.geo.attributes.color.needsUpdate = true;
          S.mesh.material.transparent = op < 0.999; S.mesh.material.opacity = op; S.mesh.material.depthWrite = op > 0.98; S.mesh.visible = op > 0.01;
        });
      }
      let throbMax = 0;
      for (const kn of this.knots) {
        const si = SIDE[kn.side];
        const show = track(t, kn.show, 0), throb = track(t, kn.throb, 0);
        throbMax = Math.max(throbMax, throb * (show > 0.01 ? 1 : 0));
        if (!this.muscles[kn.on]) { kn.mesh.visible = false; continue; }
        let kp = this._musclePoint(kn.on, sk, si, kn.u, kn.v, P);
        const n = this.skinNormal(kp, sk);
        if (MUSCLES[kn.on].kind === "tube") kp = kp.add(n.clone().multiplyScalar(MUSCLES[kn.on].radius(kn.u) * (1 + 0.4 * track(t, ((this.story.muscles || {})[kn.on] || {}).bulge, 0))));
        kn.pos = kp; kn.normal = n;
        kn.mesh.position.copy(kp).add(n.clone().multiplyScalar(0.35));
        kn.mesh.quaternion.setFromUnitVectors(V(0, 0, 1), n);
        const ks = show * (1 + 0.12 * throb);
        kn.mesh.scale.set(1.9 * ks * (kn.scale || 1), 1.35 * ks * (kn.scale || 1), 0.9 * ks + 0.001);
        kn.mesh.visible = show > 0.01;
      }
      this.mat.knot.emissiveIntensity = 0.25 + 0.75 * throbMax;
    }

    // ---------------- organs
    _buildOrgans() {
      this.organs = {};
      for (const name of expandOrgans(this.show.organs)) {
        const def = ORG[name];
        if (!def || def.kind === "path") { if (!def) console.warn("anatomy-motion: unknown organ", name); continue; }
        const mat = new T.MeshPhysicalMaterial({ color: def.color, roughness: def.rough || 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3, emissive: new T.Color("#ff2020"), emissiveIntensity: 0 });
        let mesh;
        if (def.kind === "sdf") mesh = this._mesh(meshSDF(def.f, def.b0, def.b1, def.h), mat);
        else {
          const tube = new Tube(this.root, def.segs, 12, 1, mat).update(new T.CatmullRomCurve3(def.pts).getPoints(def.segs - 1), def.radius);
          mesh = tube.mesh;
        }
        this.organs[name] = { def, mat, mesh, base: new T.Color(def.color) };
      }
      this.curves = {};
      const curveOf = (name) => this.curves[name] || (this.curves[name] = new T.CatmullRomCurve3((ORG[name] && ORG[name].pts) || []));
      this.curveOf = curveOf;
      this.bolus = (this.story.bolus || []).map((b) => { const m = this._sph(1, new T.MeshPhysicalMaterial({ color: b.color || "#d9a066", roughness: 0.5, clearcoat: 0.3 })); return Object.assign({ mesh: m }, b); });
      this.flows = (this.story.flows || []).map((f) => {
        const mat = new T.MeshStandardMaterial({ color: f.color || "#c9dc4c", emissive: new T.Color(f.color || "#c9dc4c"), emissiveIntensity: 0.45, transparent: true, opacity: 0.9, roughness: 0.3 });
        const curve = curveOf(f.along);
        const n = 60, pts = [];
        for (let i = 0; i < n; i++) pts.push(curve.getPointAt(lerp(f.from, f.to, i / (n - 1))));
        const tube = new Tube(this.root, n, 10, f.radius || 0.98, mat).update(pts, () => f.radius || 0.98);
        return Object.assign({ tube, mat }, f);
      });
    }
    _updateOrgans(t) {
      const hot = new T.Color("#ff3b30");
      for (const name in this.organs) {
        const o = this.organs[name];
        const cfg = (this.story.organs || {})[name] || {};
        const heat = track(t, cfg.heat, 0), op = track(t, cfg.opacity, 1);
        o.mat.color.copy(o.base).lerp(hot, heat * 0.55);
        o.mat.emissiveIntensity = heat * 0.45;
        o.mat.transparent = op < 0.999; o.mat.opacity = op; o.mat.depthWrite = op > 0.6;
        o.mesh.visible = op > 0.01;
      }
      for (const b of this.bolus) {
        const show = track(t, b.show, 1), u = clamp01(track(t, b.u, 0));
        b.mesh.visible = show > 0.01;
        if (!b.mesh.visible) continue;
        const c = this.curveOf(b.along);
        const p = c.getPointAt(u), tg = c.getTangentAt(u);
        b.mesh.position.copy(p);
        b.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), tg);
        const s = (b.scale || 1) * show;
        b.mesh.scale.set(1.0 * s, 1.5 * s, 1.0 * s);
      }
      for (const f of this.flows) {
        const pr = track(t, f.progress, 0), op = track(t, f.opacity, 1);
        f.tube.drawFraction(pr);
        f.mat.opacity = 0.9 * op;
        f.tube.mesh.visible = pr > 0.01 && op > 0.01;
      }
    }

    // ---------------- pain zones, referral paths
    _buildPainAndPaths() {
      this.paths = (this.story.paths || []).map((p) => Object.assign({ tube: new Tube(this.root, 60, 8, p.radius || 0.42, p.color ? new T.MeshBasicMaterial({ color: p.color }) : this.mat.path) }, p));
    }

    // ---------------- glass
    _buildGlass() {
      const v3 = (n) => Array.from({ length: n }, () => V());
      this.glassMat = new T.ShaderMaterial({
        transparent: true, depthTest: true, depthWrite: false, premultipliedAlpha: true,
        uniforms: {
          uInvProj: { value: new T.Matrix4() }, uCamWorld: { value: new T.Matrix4() }, uViewProj: { value: new T.Matrix4() }, uCamPos: { value: V() },
          uBody: { value: new T.Matrix4() }, uBodyInv: { value: new T.Matrix4() }, uHeadInv: { value: new T.Matrix4() }, uMandInv: { value: new T.Matrix4() },
          uN: { value: v3(8) }, uG: { value: v3(2) }, uE: { value: v3(2) }, uW: { value: v3(2) }, uH: { value: v3(2) }, uSB: { value: v3(2) }, uSL: { value: v3(2) }, uSide: { value: [1, -1] },
          uPainP: { value: v3(8) }, uPainR: { value: new Array(8).fill(4) }, uPainI: { value: new Array(8).fill(0) }, uPix: { value: 0.0003 }, uAlpha: { value: 1 },
          uPainCol: { value: new T.Color(1.0, 0.1, 0.08) },
        },
        vertexShader: "varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: GLASS_FRAG,
      });
      const glass = new T.Mesh(new T.PlaneGeometry(2, 2), this.glassMat);
      glass.frustumCulled = false; glass.renderOrder = 999;
      this.scene.add(glass);
    }

    // ---------------- SDF queries in body space
    // muscles, paths and landmarks project onto the trunk-neck-head skin only, so a raised arm never captures them
    projectSkin(p, sk, depth) {
      const q = p.clone();
      for (let i = 0; i < 5; i++) {
        const d = skinSDF(q, sk, true);
        if (Math.abs(d + depth) < 0.03) break;
        q.sub(this.skinNormal(q, sk).multiplyScalar(d + depth));
      }
      return q;
    }
    skinNormal(p, sk) {
      const e = 0.08, d0 = skinSDF(p, sk, true), g = V();
      const dx = skinSDF(g.set(p.x + e, p.y, p.z), sk, true) - d0, dy = skinSDF(g.set(p.x, p.y + e, p.z), sk, true) - d0, dz = skinSDF(g.set(p.x, p.y, p.z + e), sk, true) - d0;
      return V(dx, dy, dz).normalize();
    }
    projectSkull(p, sk, depth) {
      // p in body space -> head space, push onto the cranium surface, back to body space
      const q = p.clone().applyMatrix4(sk.headInv);
      const f = (v) => craniumSDF(v.x, v.y, v.z, this.show.teeth);
      for (let i = 0; i < 5; i++) {
        const d = f(q), e = 0.06;
        if (Math.abs(d + depth) < 0.02) break;
        const n = V(f(V(q.x + e, q.y, q.z)) - d, f(V(q.x, q.y + e, q.z)) - d, f(V(q.x, q.y, q.z + e)) - d).normalize();
        q.sub(n.multiplyScalar(d + depth));
      }
      return q.applyMatrix4(sk.headM);
    }

    // ---------------- anchors: strings resolve to body-space points
    resolve(a, sk) {
      if (!a) return V();
      if (Array.isArray(a)) return V(a[0], a[1], a[2]);
      if (a.isVector3) return a.clone();
      if (a.startsWith("skin:")) return this.projectSkin(this.resolve(a.slice(5), sk), sk, 0);
      const parts = a.split(":");
      const nums = (s) => s.split(",").map(Number);
      switch (parts[0]) {
        case "body": case "world": { const n = nums(parts[1]); return V(n[0], n[1], n[2]); }
        case "head": { const n = nums(parts[1]); return sk.hw(n[0], n[1], n[2]); }
        case "mand": { const n = nums(parts[1]); return sk.mw(n[0], n[1], n[2]); }
        case "neck": { const i = Number(parts[1]); const n = parts[2] ? nums(parts[2]) : [0, 0, 0]; return sk.ch[i].p.clone().add(V(n[0], n[1], n[2])); }
        case "muscle": { const uv = nums(parts[3]); return this._musclePoint(parts[1], sk, SIDE[parts[2]], uv[0], uv[1], sk._P || {}); }
        case "knot": { const k = this.knots.find((x) => x.id === parts[1]); return k && k.pos ? k.pos.clone() : V(); }
        case "disc": {
          // disc:<level>[:L|R] -> the disc centre, or its posterolateral edge on that side (where a herniation presses the root)
          const k = discIndex(isNaN(Number(parts[1])) ? parts[1] : Number(parts[1])), b = sk.ch[k + 1];
          const s = parts[2] === "L" ? 1 : parts[2] === "R" ? -1 : 0;
          return b.p.clone().add(b.f.clone().multiplyScalar(s ? -1.1 : 0)).add(V(1.0 * s, 0, 0));
        }
        case "organ": {
          const def = ORG[parts[1]];
          if (!def) return V();
          if (parts[2] !== undefined && def.pts) return this.curveOf(parts[1]).getPointAt(clamp01(Number(parts[2])));
          return def.center ? def.center.clone() : new T.CatmullRomCurve3(def.pts).getPointAt(0.5);
        }
        default: {
          const L = LANDMARKS[parts[0]];
          if (L) return L(sk, this);
          console.warn("anatomy-motion: unknown anchor", a);
          return V();
        }
      }
    }
    toWorld(pBody) { return pBody.clone().applyMatrix4(this.root.matrixWorld); }
    toScreen(pBody) {
      const v = this.toWorld(pBody).project(this.camera);
      return { x: ((v.x + 1) / 2) * this.W, y: ((1 - v.y) / 2) * this.H, ok: v.z < 1 };
    }

    // ---------------- camera
    _camSpec(k, sk) {
      const tgt = typeof k.target === "string" || Array.isArray(k.target) ? this.resolve(k.target, sk) : V(0, 50, 0);
      let az = k.az, el = k.el;
      if (az === "normal" || el === "normal") {
        const n = this.skinNormal(tgt, sk).transformDirection(this.root.matrixWorld);
        if (az === "normal") az = Math.atan2(n.x, n.z) / D2R;
        if (el === "normal") el = Math.asin(Math.max(-1, Math.min(1, n.y))) / D2R;
      }
      return { az, el, dist: k.dist, tgt: this.toWorld(tgt), fov: k.fov || 32 };
    }
    _camAt(t, sk) {
      const K = this.story.camera || [{ t: 0, az: -90, el: 3, dist: 200, target: "body:0,56,5" }];
      let i = 0;
      while (i < K.length - 1 && t >= K[i + 1].t) i++;
      const a = this._camSpec(K[i], sk);
      if (i === K.length - 1 || t <= K[i].t) return a;
      const bk = K[i + 1], b = this._camSpec(bk, sk);
      const u = ez(bk.ease || "power2.inOut")((t - K[i].t) / (bk.t - K[i].t));
      return { az: lerp(a.az, b.az, u), el: lerp(a.el, b.el, u), dist: lerp(a.dist, b.dist, u), tgt: a.tgt.clone().lerp(b.tgt, u), fov: lerp(a.fov, b.fov, u) };
    }

    // ---------------- overlays (screen-space SVG)
    _buildOverlays() {
      const NS = "http://www.w3.org/2000/svg";
      const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || this.svg).appendChild(e); return e; };
      this._mk = mk;
      const ov = this.story.overlays || {};
      const g0 = mk("g", { id: this.id + "-overlays" });
      this.svg.insertBefore(g0, this.svg.firstChild);
      if (ov.protractor) {
        const g = (this.prot = mk("g", { opacity: 0, fill: "none", stroke: "#ffffff", "stroke-linecap": "round" }, g0));
        this.protV = mk("path", { "stroke-width": 4, "stroke-dasharray": "14 12" }, g);
        this.protA = mk("path", { "stroke-width": 5, "stroke-dasharray": "14 12" }, g);
        this.protArc = mk("path", { "stroke-width": 6 }, g);
        const lab = mk("g", { class: "lab", id: this.id + "-lab-deg", opacity: 0 });
        mk("rect", { class: "box", rx: 12 }, lab);
        const tx = mk("text", { class: "txt", "font-size": 44, "text-anchor": "middle" }, lab);
        tx.textContent = "60°";
        this.degText = tx;
      }
      if (ov.load) {
        const g = (this.load = mk("g", { opacity: 0 }, g0));
        this.loadShaft = mk("path", { fill: "none", stroke: "#ffffff", "stroke-width": 9, "stroke-linecap": "round" }, g);
        this.loadHead = mk("path", { fill: "#ffffff" }, g);
      }
      this.stretches = (ov.stretch || []).map((a) => {
        const g = mk("g", { opacity: 0, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, g0);
        const o1 = mk("path", { stroke: "#1b3d1c", "stroke-opacity": 0.55, "stroke-width": 15 }, g), o2 = mk("path", { stroke: "#1b3d1c", "stroke-opacity": 0.55, "stroke-width": 16 }, g);
        const l1 = mk("path", { stroke: "#ffffff", "stroke-width": 8 }, g), l2 = mk("path", { stroke: "#ffffff", "stroke-width": 9 }, g);
        return Object.assign({ g, lines: [o1, l1], heads: [o2, l2] }, a);
      });
      this.arrows = (ov.arrows || []).map((a) => {
        const g = mk("g", { opacity: 0 }, g0);
        return Object.assign({ g, shaft: mk("path", { fill: "none", stroke: a.color || "#ffffff", "stroke-width": a.width || 10, "stroke-linecap": "round" }, g), head: mk("path", { fill: a.color || "#ffffff" }, g) }, a);
      });
      this.labs = {};
      this.svg.querySelectorAll(".lab").forEach((g) => {
        const tx = g.querySelector(".txt");
        const fs = parseFloat(tx.getAttribute("font-size"));
        let w = 0;
        try { w = tx.getComputedTextLength(); } catch (e) { w = 0; }
        if (!w) w = tx.textContent.length * fs * 0.85;
        this.labs[g.id] = { g, tx, fs, w, lead: g.querySelector(".lead"), dot: g.querySelector(".dot"), box: g.querySelector(".box"), center: tx.getAttribute("text-anchor") === "middle" };
      });
    }
    placeLabel(id, sp, dx, dy, side, op) {
      const L = this.labs[id];
      if (!L) return;
      const o = sp && sp.ok ? op : 0;
      L.g.setAttribute("opacity", Math.round(o * 100) / 100);
      if (o <= 0.001) return;
      const safe = this.story.safe || { x0: 60, x1: 940, y0: 200, y1: 1300 };
      const ax = sp.x, ay = sp.y, padX = 20, hgt = L.fs * 1.5, bw = L.w + padX * 2;
      let bx = side > 0 ? ax + dx : side < 0 ? ax + dx - bw : ax + dx - bw / 2;
      bx = Math.max(safe.x0, Math.min(safe.x1 - bw, bx));
      const by = Math.max(safe.y0, Math.min(safe.y1 - hgt, ay + dy - hgt / 2));
      L.box.setAttribute("x", r1(bx)); L.box.setAttribute("y", r1(by)); L.box.setAttribute("width", r1(bw)); L.box.setAttribute("height", r1(hgt));
      L.tx.setAttribute("x", r1(L.center ? bx + bw / 2 : bx + padX));
      L.tx.setAttribute("y", r1(by + hgt / 2 + L.fs * 0.36));
      if (L.lead) {
        const ex = Math.max(bx, Math.min(bx + bw, ax)), ey = by + hgt / 2;
        L.lead.setAttribute("d", `M${r1(ax)},${r1(ay)} L${r1(ex)},${r1(ey)}`);
        L.dot.setAttribute("cx", r1(ax)); L.dot.setAttribute("cy", r1(ay));
      }
    }
    static arrowPath(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
      return {
        shaft: `M${r1(a.x)},${r1(a.y)} L${r1(b.x - ux * 14)},${r1(b.y - uy * 14)}`,
        head: `M${r1(b.x - ux * 30 - uy * 24)},${r1(b.y - uy * 30 + ux * 24)} L${r1(b.x - ux * 30 + uy * 24)},${r1(b.y - uy * 30 - ux * 24)} L${r1(b.x)},${r1(b.y)} Z`,
      };
    }

    // ---------------- per-frame updates
    _updateSkeleton(sk, P) {
      if (!this.head) return;
      this.head.position.copy(sk.O);
      this.head.quaternion.setFromRotationMatrix(sk.rot);
      this.jaw.quaternion.setFromAxisAngle(V(1, 0, 0), P.jaw * JAW_MAX * D2R);
      this.cverts.forEach((g, k) => Stage.orient(g, sk.ch[k].p.clone().lerp(sk.ch[k + 1].p, 0.5), sk.ch[k + 1].p.clone().sub(sk.ch[k].p).normalize(), sk.ch[k + 1].f.clone()));
      sk.side.forEach((sd, i) => {
        const o = this.parts[i], s = sd.s;
        o.clav.update([sd.SC, V(8.5 * s, 47.6, 7.2).add(sd.A.clone().sub(V(16.6 * s, 48.2, -1.2)).multiplyScalar(0.4)), sd.A.clone().add(V(0, 0.2, 1.4))]);
        o.spineScap.update([sd.RS.clone().add(V(0, 0, -0.5)), sd.RS.clone().lerp(sd.A, 0.5).add(V(0, 0.8, -1.2)), sd.A.clone()]);
        o.acro.position.copy(sd.A);
        o.cora.update([sd.GL.clone().add(V(-0.5 * s, 1.0, 1.6)), sd.C.clone()]);
        let k = 0;
        for (let a = 0; a <= o.scapN; a++) for (let b = 0; b <= o.scapN - a; b++) {
          const wa = a / o.scapN, wb = b / o.scapN, wc = 1 - wa - wb;
          const q = sd.SA.clone().multiplyScalar(wc).add(sd.IA.clone().multiplyScalar(wa)).add(sd.GL.clone().multiplyScalar(wb));
          q.z -= 0.9 * Math.sin(Math.PI * Math.min(1, wa + wb * 0.5));
          o.scapPos[k++] = q.x; o.scapPos[k++] = q.y; o.scapPos[k++] = q.z;
        }
        o.scapGeo.attributes.position.needsUpdate = true;
        o.scapGeo.computeVertexNormals();
        o.humHead.position.copy(sd.G);
        Stage.placeCyl(o.hum, sd.G, sd.E, 1.15);
        o.elb.position.copy(sd.E);
        const fa = sd.W.clone().sub(sd.E).normalize();
        const side2 = fa.clone().cross(V(0, 1, 0)).normalize().multiplyScalar(0.7);
        Stage.placeCyl(o.rad, sd.E.clone().add(side2), sd.W.clone().add(side2), 0.62);
        Stage.placeCyl(o.uln, sd.E.clone().sub(side2), sd.W.clone().sub(side2), 0.55);
        o.wr.position.copy(sd.W);
        o.meta.forEach((m, j) => {
          const off = side2.clone().multiplyScalar((j - 1.5) * 0.9);
          const k0 = sd.W.clone().add(sd.hd.clone().multiplyScalar(5.0)).add(off);
          Stage.placeCyl(m, sd.W.clone().add(off.clone().multiplyScalar(0.5)), k0, 0.32);
          // two phalanges per finger curl toward the palm
          const d1 = sd.hd.clone().multiplyScalar(0.8).add(sd.palm.clone().multiplyScalar(0.6)).normalize();
          const k1 = k0.clone().add(d1.multiplyScalar(2.6 - Math.abs(j - 1.5) * 0.3));
          const d2 = sd.hd.clone().multiplyScalar(0.3).add(sd.palm.clone().multiplyScalar(1.0)).normalize();
          Stage.placeCyl(o.phal[j][0], k0, k1, 0.28);
          Stage.placeCyl(o.phal[j][1], k1, k1.clone().add(d2.multiplyScalar(2.0 - Math.abs(j - 1.5) * 0.25)), 0.25);
        });
        const tb0 = sd.W.clone().add(side2.clone().multiplyScalar(-1.6)).add(sd.palm.clone().multiplyScalar(0.8));
        const tb1 = tb0.clone().add(sd.hd.clone().multiplyScalar(3.2)).add(side2.clone().multiplyScalar(-1.2)).add(sd.palm.clone().multiplyScalar(1.0));
        Stage.placeCyl(o.thumb[0], tb0, tb1, 0.33);
        Stage.placeCyl(o.thumb[1], tb1, tb1.clone().add(sd.hd.clone().multiplyScalar(1.6)).add(sd.palm.clone().multiplyScalar(1.4)), 0.28);
      });
      if (this.phone && sk.phone) { this.phone.position.copy(sk.phone); this.phone.lookAt(this.toWorld(sk.eye)); }
    }
    _updateSpineDetail(sk, t) {
      if (!this.discs) return;
      this.discs.forEach((m, k) => {
        if (k < 6) {
          const a = sk.ch[k], b = sk.ch[k + 1], c = sk.ch[k + 2];
          const m0 = a.p.clone().lerp(b.p, 0.5), m1 = b.p.clone().lerp(c.p, 0.5);
          m.position.copy(b.p); m.quaternion.setFromUnitVectors(V(0, 1, 0), m1.clone().sub(m0).normalize()); m.scale.set(1.0, 0.7, 0.85);
        } else {
          m.position.copy(sk.ch[0].p.clone().lerp(V(0, 45.0, -4.4), 0.45)); m.quaternion.identity(); m.scale.set(1.15, 1.1, 0.95);
        }
      });
      const back = (i, d) => sk.ch[i].p.clone().add(sk.ch[i].f.clone().multiplyScalar(-d));
      const pts = [sk.hw(0, 0.6, -1.4)];
      for (let i = 7; i >= 0; i--) pts.push(back(i, 1.45));
      for (const v of this.staticVerts || []) if (v.p.y > 15) pts.push(v.p.clone().add(V(0, 0, -v.rb - 0.65)));
      this.cord.update(pts);
      const hern = this.story.herniation || [];
      this.roots.forEach((r) => {
        const k = r.k + 1, base = back(k, 1.45);
        const out = base.clone().add(sk.ch[k].l.clone().multiplyScalar(3.6 * r.s)).add(V(0, -0.9, 0)).add(sk.ch[k].f.clone().multiplyScalar(1.6));
        r.tube.update([base, base.clone().lerp(out, 0.5).add(V(0, -0.2, 0.2)), out], (u) => 0.34 - 0.08 * u);
        let heat = 0;
        hern.forEach((h) => { if (discIndex(h.level) === r.k && (h.side === "both" || SGN[SIDE[h.side]] === r.s)) heat = Math.max(heat, track(t, h.amount, 0)); });
        r.mat.color.set("#f3c64a").lerp(new T.Color("#ff3b30"), heat);
        r.mat.emissiveIntensity = 0.2 + 1.2 * heat;
      });
      hern.forEach((h, i) => {
        const m = this.bulges[i], amt = track(t, h.amount, 0), k = discIndex(h.level);
        const b = sk.ch[k + 1];
        const s = h.side === "L" ? 1 : h.side === "R" ? -1 : 0;
        const p = b.p.clone().add(b.f.clone().multiplyScalar(-1.1)).add(V(1.0 * s, 0, 0));
        h.pos = p;
        m.position.copy(p); m.scale.setScalar(0.25 + 0.75 * amt); m.visible = amt > 0.01;
        m.material.color.set("#d3e6ef").lerp(new T.Color("#ff6b5a"), amt * 0.6);
      });
    }
    _updatePaths(sk, t) {
      for (const p of this.paths) {
        const draw = track(t, p.draw, 1), op = track(t, p.opacity, 1);
        p.tube.mesh.visible = draw > 0.01 && op > 0.01;
        if (!p.tube.mesh.visible) continue;
        const pts = p.points.map((a, i) => {
          const q = this.resolve(a, sk);
          if (i === 0 && a.startsWith("knot:")) { const k = this.knots.find((x) => x.id === a.slice(5)); return k && k.normal ? q.add(k.normal.clone().multiplyScalar(1.2)) : q; }
          return p.onSkin === false ? q : this.projectSkin(q, sk, -0.45);
        });
        p.tube.update(pts);
        p.tube.drawFraction(draw);
      }
    }

    poseAt(t) {
      const k = this.story.tracks || {};
      return {
        t, tilt: track(t, k.tilt, 0), retract: track(t, k.retract, 0), sf: track(t, k.shoulderFwd, 0), up: track(t, k.phoneUp, 0),
        turn: track(t, k.turn, 0), shrug: track(t, k.shrug, 0), shrugL: track(t, k.shrugL, 0), shrugR: track(t, k.shrugR, 0),
        jaw: track(t, k.jawOpen, 0), pitch: track(t, k.bodyPitch, 0), roll: track(t, k.bodyRoll, 0), bones: track(t, k.boneOpacity, 1), glass: track(t, k.glassOpacity, 1),
      };
    }

    renderAt(t) {
      for (const r of this.story.skip || []) if (t > r[0] && t < r[1]) return;
      const P = this.poseAt(t);
      const sk = pose(P, this.arms);
      sk._P = P;
      this.root.rotation.set(P.pitch * D2R, 0, P.roll * D2R);
      this.root.updateMatrixWorld(true);
      for (const m of this.boneMats) { m.transparent = P.bones < 0.999; m.opacity = P.bones; m.depthWrite = P.bones > 0.6; }
      this._updateSkeleton(sk, P);
      this._updateSpineDetail(sk, t);
      this._updateMuscles(sk, P, t);
      this._updateOrgans(t);
      this._updatePaths(sk, t);
      const c = this._camAt(t, sk);
      const cam = this.camera, az = c.az * D2R, el = c.el * D2R;
      cam.position.set(c.tgt.x + c.dist * Math.sin(az) * Math.cos(el), c.tgt.y + c.dist * Math.sin(el), c.tgt.z + c.dist * Math.cos(az) * Math.cos(el));
      cam.up.set(0, 1, 0); cam.fov = c.fov; cam.updateProjectionMatrix(); cam.lookAt(c.tgt); cam.updateMatrixWorld();
      if (this.phone) {
        // the phone is in front of the chest; from behind it would float through the glass, so it fades out
        const camB = cam.position.clone().applyMatrix4(this.root.matrixWorld.clone().invert());
        const bodyAz = Math.atan2(camB.x, camB.z) / D2R;
        const pv = 1 - sstep(105, 125, Math.abs(bodyAz));
        this.mat.phone.opacity = pv; this.mat.screen.opacity = pv; this.phone.visible = pv > 0.01;
      }
      if (this.glassMat) {
        const U = this.glassMat.uniforms;
        U.uInvProj.value.copy(cam.projectionMatrixInverse);
        U.uCamWorld.value.copy(cam.matrixWorld);
        U.uViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        U.uCamPos.value.copy(cam.position);
        U.uBody.value.copy(this.root.matrixWorld);
        U.uBodyInv.value.copy(this.root.matrixWorld).invert();
        U.uHeadInv.value.copy(sk.headInv);
        U.uMandInv.value.copy(sk.mandInv);
        sk.neck.forEach((q, i) => U.uN.value[i].copy(q));
        sk.side.forEach((sd, i) => {
          U.uG.value[i].copy(sd.G); U.uE.value[i].copy(sd.E); U.uW.value[i].copy(sd.W); U.uH.value[i].copy(sd.hand);
          U.uSB.value[i].copy(sd.shBlock); U.uSL.value[i].copy(sd.slope);
        });
        const zones = this.story.painZones || [];
        for (let i = 0; i < 8; i++) {
          const z = zones[i];
          if (!z) { U.uPainI.value[i] = 0; U.uPainP.value[i].set(0, -999, 0); continue; }
          U.uPainP.value[i].copy(this.resolve(z.anchor, sk));
          U.uPainR.value[i] = z.radius || 4.2;
          U.uPainI.value[i] = track(t, z.intensity, 0);
        }
        U.uPix.value = (c.fov * D2R) / this.H;
        U.uAlpha.value = P.glass;
      }
      this.renderer.render(this.scene, cam);
      this._updateOverlays(sk, P, t);
    }
    _updateOverlays(sk, P, t) {
      const ov = this.story.overlays || {};
      if (this.prot) {
        const op = track(t, ov.protractor, 0);
        this.prot.setAttribute("opacity", Math.round(op * 100) / 100);
        if (op > 0.001) {
          const O = sk.O, os = this.toScreen(O), vs = this.toScreen(O.clone().add(V(0, 24, 0))), as = this.toScreen(sk.hw(0, 24, 0));
          this.protV.setAttribute("d", `M${r1(os.x)},${r1(os.y)} L${r1(vs.x)},${r1(vs.y)}`);
          this.protA.setAttribute("d", `M${r1(os.x)},${r1(os.y)} L${r1(as.x)},${r1(as.y)}`);
          const a0 = Math.atan2(vs.y - os.y, vs.x - os.x), a1 = Math.atan2(as.y - os.y, as.x - os.x), R0 = 120;
          this.protArc.setAttribute("d", P.tilt > 0.5 ? `M${r1(os.x + R0 * Math.cos(a0))},${r1(os.y + R0 * Math.sin(a0))} A${R0},${R0} 0 0,1 ${r1(os.x + R0 * Math.cos(a1))},${r1(os.y + R0 * Math.sin(a1))}` : "M0,0");
          this.degText.textContent = Math.round(P.tilt) + "°";
          const am = (a0 + a1) / 2;
          this.placeLabel(this.id + "-lab-deg", { x: os.x + 175 * Math.cos(am), y: os.y + 175 * Math.sin(am), ok: true }, 0, 0, 0, op);
        } else this.placeLabel(this.id + "-lab-deg", null, 0, 0, 0, 0);
      }
      if (this.load) {
        const cfg = ov.load, op = track(t, cfg.show, 0);
        this.load.setAttribute("opacity", Math.round(op * 100) / 100);
        if (op > 0.001) {
          const tbl = (cfg.table || [[0, 5], [15, 12], [30, 18], [45, 22], [60, 27]]).map((k) => [k[0], k[1], "none"]);
          const hs = this.toScreen(sk.hw(0, 9, 1.5)), Lg = 50 + track(P.tilt, tbl, 5) * (cfg.pxPerKg || 9);
          this.loadShaft.setAttribute("d", `M${r1(hs.x)},${r1(hs.y)} L${r1(hs.x)},${r1(hs.y + Lg - 18)}`);
          this.loadHead.setAttribute("d", `M${r1(hs.x - 22)},${r1(hs.y + Lg - 26)} L${r1(hs.x + 22)},${r1(hs.y + Lg - 26)} L${r1(hs.x)},${r1(hs.y + Lg)} Z`);
        }
      }
      for (const a of this.stretches) {
        // a double arrow beside a muscle, as long as the muscle: "this gets longer"
        const op = track(t, a.show, 0);
        a.g.setAttribute("opacity", Math.round(op * 100) / 100);
        if (op <= 0.001) continue;
        const A = this.toScreen(this.resolve(a.from, sk)), B = this.toScreen(this.resolve(a.to, sk));
        let nx = -(B.y - A.y), ny = B.x - A.x; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if ((a.side || 1) * nx < 0) { nx = -nx; ny = -ny; }
        const off = a.offset === undefined ? 95 : a.offset;
        const ax = A.x + nx * off, ay = A.y + ny * off, bx = B.x + nx * off, by = B.y + ny * off;
        const L2 = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L2, uy = (by - ay) / L2;
        const head = (x, y, dx, dy) => `M${r1(x + dx * 34 - dy * 24)},${r1(y + dy * 34 + dx * 24)} L${r1(x)},${r1(y)} L${r1(x + dx * 34 + dy * 24)},${r1(y + dy * 34 - dx * 24)}`;
        a.lines.forEach((e) => e.setAttribute("d", `M${r1(ax)},${r1(ay)} L${r1(bx)},${r1(by)}`));
        a.heads.forEach((e) => e.setAttribute("d", head(ax, ay, ux, uy) + " " + head(bx, by, -ux, -uy)));
      }
      for (const a of this.arrows) {
        const op = track(t, a.show, 0);
        a.g.setAttribute("opacity", Math.round(op * 100) / 100);
        if (op <= 0.001) continue;
        const p = Stage.arrowPath(this.toScreen(this.resolve(a.from, sk)), this.toScreen(this.resolve(a.to, sk)));
        a.shaft.setAttribute("d", p.shaft); a.head.setAttribute("d", p.head);
      }
      for (const L of this.story.labels || []) {
        const op = track(t, L.show, 0);
        this.placeLabel(L.id, op > 0.001 ? this.toScreen(this.resolve(L.anchor, sk)) : null, L.dx || 0, L.dy || 0, L.side === undefined ? -1 : L.side, op);
      }
    }
  }

  // ------------------------------------------------------------------ named landmarks (body space)
  const side = (sk, s) => sk.side[s === "L" ? 0 : 1];
  const LANDMARKS = {
    C7: (sk) => sk.ch[0].p.clone(), occiput: (sk) => sk.hw(0, 3.2, -8.0), eyes: (sk) => sk.eye.clone(),
    chin: (sk) => sk.mw(0, -4.5, 8.6), throat: (sk) => sk.ch[4].p.clone().add(V(0, 0, 6.5)),
    templeL: (sk) => sk.hw(6.6, 9.6, 4.2), templeR: (sk) => sk.hw(-6.6, 9.6, 4.2),
    mastoidL: (sk) => sk.hw(5.9, 1.2, -2.6), mastoidR: (sk) => sk.hw(-5.9, 1.2, -2.6),
    earL: (sk) => sk.hw(7.4, 4.9, 0.2), earR: (sk) => sk.hw(-7.4, 4.9, 0.2),
    tmjL: (sk) => sk.hw(6.0, 2.8, 1.6), tmjR: (sk) => sk.hw(-6.0, 2.8, 1.6),
    cheekL: (sk) => sk.hw(5.8, 1.0, 3.6), cheekR: (sk) => sk.hw(-5.8, 1.0, 3.6),
    neckBackL: (sk, st) => st.projectSkin(sk.tp(4, 1, 4.2, -3.0), sk, 0),
    neckBackR: (sk, st) => st.projectSkin(sk.tp(4, -1, 4.2, -3.0), sk, 0),
    neckBaseL: (sk, st) => st.projectSkin(sk.tp(0, 1, 4.8, -3.4).add(V(0, 1.2, 0)), sk, 0),
    neckBaseR: (sk, st) => st.projectSkin(sk.tp(0, -1, 4.8, -3.4).add(V(0, 1.2, 0)), sk, 0),
    scapulaMedialL: (sk, st) => st.projectSkin(V(8.0, 39.5, -10.6).add(V(0, sk.side[0].SA.y - 46.4, 0)), sk, 0),
    scapulaMedialR: (sk, st) => st.projectSkin(V(-8.0, 39.5, -10.6).add(V(0, sk.side[1].SA.y - 46.4, 0)), sk, 0),
    levatorOriginL: (sk) => sk.tp(5, 1, 3.2, 0.1), levatorOriginR: (sk) => sk.tp(5, -1, 3.2, 0.1),
    superiorAngleL: (sk) => sk.side[0].SA.clone().add(V(0, 0.9, 0.3)), superiorAngleR: (sk) => sk.side[1].SA.clone().add(V(0, 0.9, 0.3)),
    acromionL: (sk) => side(sk, "L").A.clone(), acromionR: (sk) => side(sk, "R").A.clone(),
    scapulaL: (sk) => side(sk, "L").SA.clone().lerp(side(sk, "L").IA, 0.5), scapulaR: (sk) => side(sk, "R").SA.clone().lerp(side(sk, "R").IA, 0.5),
    pecL: (sk) => side(sk, "L").C.clone().lerp(V(8.6, 37, 9.4), 0.5), pecR: (sk) => side(sk, "R").C.clone().lerp(V(-8.6, 37, 9.4), 0.5),
    elbowL: (sk) => side(sk, "L").E.clone(), elbowR: (sk) => side(sk, "R").E.clone(),
    handL: (sk) => side(sk, "L").W.clone(), handR: (sk) => side(sk, "R").W.clone(),
    sternum: () => V(0, 38, 10.6), heartburn: () => V(0, 35.5, 10.4), epigastrium: () => V(0, 26, 10.6),
    navel: () => V(0, 12, 10.2), lowerBack: () => V(0, 12, -9.8), les: () => V(2.9, 27.6, 0.8), pylorus: () => V(-1.4, 18.4, 4.4),
  };

  // ------------------------------------------------------------------ mount
  function mount(opts) {
    const fontLoads = document.fonts && document.fonts.load ? Promise.all((opts.fonts || ['800 40px "KRSans"']).map((f) => document.fonts.load(f).catch(() => null))) : Promise.resolve();
    return fontLoads.then(() => {
      const st = new Stage(opts);
      const proxy = { t: 0 };
      const tl = global.gsap.timeline({ paused: true });
      tl.fromTo(proxy, { t: 0 }, { t: st.duration, duration: st.duration, ease: "none", onUpdate: () => st.renderAt(proxy.t) }, 0);
      st.renderAt(0);
      global.__timelines[opts.id] = tl;
      return st;
    });
  }

  global.AnatomyMotion = { version: "0.1.0", mount, track, Stage, MUSCLES, ORGANS: ORG, LANDMARKS, ORGAN_ALIASES };
})(window);
